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

/** 决定一笔交易的执行结果（基于 provider 行为参数 + 任务复杂度，确定性由 rng 保证）。 */
function executeOutcome(
  provider: SimAgent,
  complexity: number,
  rng: Rng,
): { onTime: boolean; delivered: boolean; cheated: boolean; result: EvidenceResult } {
  const onTime = rng.chance(provider.reliability);
  const delivered =
    provider.skill >= complexity ? true : rng.chance(provider.skill / Math.max(complexity, 0.01));
  const cheated = rng.chance(1 - provider.honesty);

  let result: EvidenceResult;
  if (cheated) result = 'failure';
  else if (delivered && onTime) result = 'success';
  else if (delivered && !onTime) result = 'partial';
  else result = 'failure';

  return { onTime, delivered, cheated, result };
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

    // EXECUTE
    const outcome = executeOutcome(provider, task.complexity, rng);
    events.push({
      type: 'EXECUTE',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { onTime: outcome.onTime, delivered: outcome.delivered, cheated: outcome.cheated, result: outcome.result },
    });

    // SETTLE：success 全款 / partial 半款 / failure 0
    let amount = 0;
    if (outcome.result === 'success') amount = contract.price;
    else if (outcome.result === 'partial') amount = Math.round(contract.price / 2);
    if (amount > 0) wallet.transfer(buyer.id, provider.id, amount);

    stats.totalValue += amount;
    if (outcome.result === 'success') stats.settled++;
    else if (outcome.result === 'partial') stats.partial++;
    else stats.failed++;

    const tx: SimTransaction = {
      id: `tx-${String(++txSeq).padStart(5, '0')}`,
      taskId: task.id,
      buyerId: buyer.id,
      providerId: provider.id,
      amount,
      result: outcome.result,
      round,
    };
    transactions.push(tx);
    stats.transactions++;
    events.push({
      type: 'SETTLE',
      round,
      taskId: task.id,
      agentId: provider.id,
      data: { amount, result: outcome.result },
    });

    // REVIEW：产生 4 条 evidence（覆盖 capability/reliability/delivery/integrity）
    const ts = new Date(BASE_TIME + round * 60_000);
    const capResult: EvidenceResult =
      provider.skill >= task.complexity ? 'success' : outcome.delivered ? 'partial' : 'failure';
    evidence.push(
      { agentId: provider.id, transactionId: tx.id, dimension: 'capability', source: 'simulation', result: capResult, timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'reliability', source: 'simulation', result: outcome.onTime ? 'success' : 'failure', timestamp: ts },
      { agentId: provider.id, transactionId: tx.id, dimension: 'delivery', source: 'simulation', result: outcome.result, timestamp: ts },
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
