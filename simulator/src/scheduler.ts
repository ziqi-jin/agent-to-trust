/**
 * @acl/simulator — 调度器（核心）。
 *
 * 推进 N 轮仿真，每轮：生成任务 → buyer 发布 → 有能力者 DISCOVER →
 * OFFER 报价 → buyer ACCEPT → EXECUTE（按行为参数决定成败）→ SETTLE 结算 →
 * REVIEW 产生 evidence（source=simulation）。
 *
 * 事件链：DISCOVER → OFFER → ACCEPT → EXECUTE → SETTLE → REVIEW。
 */
import type { EvidenceResult } from '@acl/core';
import { Rng, round2 } from './rng';
import { generateAgents } from './agents';
import { generateTask } from './tasks';
import { Wallet } from './wallet';
import { MarketEngine } from './market';
import { ExecutionEngine } from './execution';
import type {
  Contract,
  SimAgent,
  SimEvent,
  SimEvidence,
  SimTask,
  SimTransaction,
  SimulationConfig,
  SimulationResult,
  SimulationStats,
} from './types';

const BASE_TIME = new Date('2026-08-23T12:00:00Z').getTime();

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function pickBuyer(agents: SimAgent[], wallet: Wallet, budget: number, rng: Rng): SimAgent | null {
  const buyers = agents.filter((a) => wallet.canPay(a.id, budget));
  if (buyers.length === 0) return null;
  return rng.pick(buyers);
}

export function runSimulation(config: SimulationConfig): SimulationResult {
  const agentCount = Math.max(0, Math.floor(config.agentCount));
  const rounds = Math.max(0, Math.floor(config.rounds));
  const initialWallet = config.initialWallet ?? 1000;
  const rng = new Rng(config.seed);

  const agents = generateAgents(agentCount, rng, initialWallet);
  const wallet = new Wallet(agents);

  const tasks: SimTask[] = [];
  const contracts: Contract[] = [];
  const transactions: SimTransaction[] = [];
  const events: SimEvent[] = [];
  const evidence: SimEvidence[] = [];
  const market = new MarketEngine(rng);
  const execution = new ExecutionEngine(rng);

  const stats: SimulationStats = {
    agentCount,
    rounds,
    tasksCreated: 0,
    contractsCreated: 0,
    transactions: 0,
    settled: 0,
    failed: 0,
    partial: 0,
    totalValue: 0,
    totalFees: 0,
  };

  let txSeq = 0;

  for (let round = 0; round < rounds; round++) {
    const task = generateTask(round, rng);
    tasks.push(task);
    stats.tasksCreated++;
    events.push({ type: 'DISCOVER', round, taskId: task.id });

    const buyer = pickBuyer(agents, wallet, task.budget, rng);
    if (!buyer) continue;

    const candidates = market.discover(task, agents, buyer.id);
    if (candidates.length === 0) {
      events.push({ type: 'DISCOVER', round, taskId: task.id, data: { matched: 0 } });
      continue;
    }

    // OFFER：每个候选报价（按报价策略定价）+ 时延
    const allOffers = market.offerAll(task, candidates);
    // 买方预算约束：只考虑不超过任务预算的报价（高溢价/超预算报价被拒）
    const offers = allOffers.filter((o) => o.price <= task.budget);
    for (const o of offers) {
      events.push({ type: 'OFFER', round, taskId: task.id, agentId: o.agentId, data: { price: o.price } });
    }

    // ACCEPT：buyer 按自己的接单策略选 offer，形成 contract
    const contract = market.accept(task, buyer.id, offers, buyer.acceptStrategy ?? 'lowest-price', new Date(BASE_TIME + round * 60_000));
    if (!contract) continue;
    const provider = agents.find((a) => a.id === contract.providerId);
    if (!provider) continue;
    contracts.push(contract);
    stats.contractsCreated++;
    events.push({
      type: 'ACCEPT',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { price: contract.price, buyer: buyer.id },
    });

    // EXECUTE → DELIVER → VERIFY → SETTLE（Execution Engine 状态机）
    const outcome = execution.execute(contract, provider);
    contract.status = 'executed';
    events.push({
      type: 'EXECUTE',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { actualQuality: outcome.actualQuality, onTime: outcome.onTime, cheated: outcome.cheated },
    });

    const deliverable = execution.deliver(contract, outcome);
    events.push({
      type: 'DELIVER',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { claimedQuality: deliverable.claimedQuality, cheated: deliverable.cheated },
    });

    const verification = execution.verify(contract, outcome, deliverable, task);
    events.push({
      type: 'VERIFY',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: {
        measuredQuality: verification.measuredQuality,
        caughtCheating: verification.caughtCheating,
        result: verification.result,
      },
    });

    const settlement = execution.settle(contract, verification);
    contract.status = 'settled';
    const amount = settlement.amount;
    if (amount > 0) wallet.transfer(buyer.id, provider.id, amount);

    stats.totalValue += amount;
    if (verification.result === 'success') stats.settled++;
    else if (verification.result === 'partial') stats.partial++;
    else stats.failed++;

    const tx: SimTransaction = {
      id: `tx-${String(++txSeq).padStart(5, '0')}`,
      taskId: task.id,
      buyerId: buyer.id,
      providerId: provider.id,
      amount,
      result: verification.result,
      round,
    };
    transactions.push(tx);
    stats.transactions++;
    events.push({
      type: 'SETTLE',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { amount, result: verification.result },
    });

    // REVIEW：产生 6 条 evidence；capability 基于「实测质量」而非自报技能
    const ts = new Date(BASE_TIME + round * 60_000);
    const capResult: EvidenceResult =
      verification.measuredQuality >= task.complexity
        ? 'success'
        : verification.measuredQuality >= 0.7 * task.complexity
          ? 'partial'
          : 'failure';

    // 成交价相对任务预算的比值（provider 报价 ÷ buyer 预算）。
    // 买方预算约束已保证 price <= budget，故 priceRatio <= 1；
    // 报价策略下探到 0.55（undercut），故 priceRatio ∈ [0.55, 1]。
    const priceRatio = task.budget > 0 ? contract.price / task.budget : 1;

    // economic：性价比（买家视角，钱花得值不值）——实测质量 ÷ 价位。
    // 高质低价 = 高性价比；低质高价 = 低性价比。除以 max(priceRatio, 0.4)
    // 是为了避免压价过狠时把性价比夸大到失真（封顶分母 0.4）。
    const econValue = round2(clamp01(verification.measuredQuality / Math.max(priceRatio, 0.4)));
    const econResult: EvidenceResult =
      econValue >= 0.9 ? 'success' : econValue >= 0.6 ? 'partial' : 'failure';

    // negotiation：议价（卖家视角，价位拿捏）——成交价越接近预算越不吃亏。
    // 越接近 1 说明把价谈到了预算上限，undercut 压价则是让利过多。
    const negotValue = round2(clamp01(priceRatio));
    const negotResult: EvidenceResult =
      negotValue >= 0.85 ? 'success' : negotValue >= 0.7 ? 'partial' : 'failure';

    evidence.push(
      { agentId: provider.id, transactionId: tx.id, dimension: 'capability', source: 'simulation', result: capResult, value: verification.measuredQuality, timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'reliability', source: 'simulation', result: outcome.onTime ? 'success' : 'failure', timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'delivery', source: 'simulation', result: verification.result, timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'economic', source: 'simulation', result: econResult, value: econValue, timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'negotiation', source: 'simulation', result: negotResult, value: negotValue, timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'integrity', source: 'simulation', result: outcome.cheated ? 'failure' : 'success', timestamp: ts },
    );
    events.push({
      type: 'REVIEW',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { evidenceCount: 6 },
    });
  }

  const finalAgents = agents.map((a) => ({ ...a, wallet: wallet.get(a.id) }));

  return {
    config: { ...config, agentCount, rounds, initialWallet },
    agents: finalAgents,
    tasks,
    contracts,
    transactions,
    events,
    evidence,
    stats,
  };
}
