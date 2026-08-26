import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng';
import { priceFor, selectOffer } from '../src/market';
import { generateAgents, OFFER_STRATEGIES, ACCEPT_STRATEGIES } from '../src/agents';
import { runSimulation } from '../src/scheduler';
import type { Offer } from '../src/types';

const OFFERS: Offer[] = [
  { taskId: 't', agentId: 'a1', price: 120, latency: 2 },
  { taskId: 't', agentId: 'a2', price: 90, latency: 6 },
  { taskId: 't', agentId: 'a3', price: 105, latency: 1 },
];

describe('[正确性] 报价策略 priceFor', () => {
  it('undercut 价格低于预算（55%–85%）', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 100; i++) {
      const p = priceFor('undercut', 100, rng);
      expect(p).toBeGreaterThanOrEqual(55);
      expect(p).toBeLessThanOrEqual(85);
    }
  });

  it('market 价格在 85%–115%', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 100; i++) {
      const p = priceFor('market', 100, rng);
      expect(p).toBeGreaterThanOrEqual(85);
      expect(p).toBeLessThanOrEqual(115);
    }
  });

  it('premium 价格高于预算（115%–145%）', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 100; i++) {
      const p = priceFor('premium', 100, rng);
      expect(p).toBeGreaterThanOrEqual(115);
      expect(p).toBeLessThanOrEqual(145);
    }
  });
});

describe('[正确性] 接单策略 selectOffer', () => {
  it('lowest-latency 返回时延最低的 offer', () => {
    const o = selectOffer(OFFERS, 'lowest-latency', new Rng(1));
    expect(o?.agentId).toBe('a3'); // latency 1
  });

  it('lowest-price 返回价格最低的 offer', () => {
    const o = selectOffer(OFFERS, 'lowest-price', new Rng(1));
    expect(o?.agentId).toBe('a2'); // price 90
  });
});

describe('[数据完整性] Agent 决策风格', () => {
  it('每个 agent 都分配了报价策略与接单策略', () => {
    const agents = generateAgents(100, new Rng(42), 1000);
    for (const a of agents) {
      expect(OFFER_STRATEGIES).toContain(a.offerStrategy);
      expect(ACCEPT_STRATEGIES).toContain(a.acceptStrategy);
    }
  });

  it('三种报价策略都有出现（样本足够大时）', () => {
    const agents = generateAgents(200, new Rng(7), 1000);
    const seen = new Set(agents.map((a) => a.offerStrategy));
    expect(seen.size).toBe(3);
  });
});

describe('[正确性] 预算约束', () => {
  it('所有成功交易金额不超过任务预算（高溢价被拒）', () => {
    const r = runSimulation({ agentCount: 100, rounds: 100, seed: 42 });
    const budgetByTask = new Map(r.tasks.map((t) => [t.id, t.budget]));
    for (const tx of r.transactions) {
      expect(tx.amount).toBeLessThanOrEqual(budgetByTask.get(tx.taskId) ?? Infinity);
    }
  });

  it('contract 价格不超过任务预算', () => {
    const r = runSimulation({ agentCount: 100, rounds: 100, seed: 42 });
    const budgetByTask = new Map(r.tasks.map((t) => [t.id, t.budget]));
    for (const c of r.contracts) {
      expect(c.price).toBeLessThanOrEqual(budgetByTask.get(c.taskId) ?? Infinity);
    }
  });
});

describe('[可复现性] 策略扩展不破坏确定性', () => {
  it('同 seed 两次运行 agents 完全一致（含策略）', () => {
    const a = runSimulation({ agentCount: 50, rounds: 30, seed: 99 });
    const b = runSimulation({ agentCount: 50, rounds: 30, seed: 99 });
    expect(a.agents).toEqual(b.agents);
    expect(a.contracts).toEqual(b.contracts);
  });
});
