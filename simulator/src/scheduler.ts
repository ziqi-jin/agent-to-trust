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
import { Rng } from './rng';
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

    // OFFER：每个候选报价（85%–115% 预算）+ 时延
    const offers = market.offerAll(task, candidates);
    for (const o of offers) {
      events.push({ type: 'OFFER', round, taskId: task.id, agentId: o.agentId, data: { price: o.price } });
    }

    // ACCEPT：buyer 按策略选 offer，形成 contract
    const contract = market.accept(task, buyer.id, offers, 'lowest-price', new Date(BASE_TIME + round * 60_000));
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

    // REVIEW：产生 4 条 evidence；capability 基于「实测质量」而非自报技能
    const ts = new Date(BASE_TIME + round * 60_000);
    const capResult: EvidenceResult =
      verification.measuredQuality >= task.complexity
        ? 'success'
        : verification.measuredQuality >= 0.7 * task.complexity
          ? 'partial'
          : 'failure';
    evidence.push(
      { agentId: provider.id, transactionId: tx.id, dimension: 'capability', source: 'simulation', result: capResult, value: verification.measuredQuality, timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'reliability', source: 'simulation', result: outcome.onTime ? 'success' : 'failure', timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'delivery', source: 'simulation', result: verification.result, timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'integrity', source: 'simulation', result: outcome.cheated ? 'failure' : 'success', timestamp: ts },
    );
    events.push({
      type: 'REVIEW',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { evidenceCount: 4 },
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
