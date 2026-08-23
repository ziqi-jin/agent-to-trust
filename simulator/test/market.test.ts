import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng';
import { MarketEngine, selectOffer } from '../src/market';
import { runSimulation } from '../src/scheduler';
import type { Offer, SimAgent, SimTask } from '../src/types';

function makeTask(overrides?: Partial<SimTask>): SimTask {
  return {
    id: 'task-0001',
    domain: 'code',
    complexity: 0.5,
    budget: 100,
    deadlineRound: 3,
    ...overrides,
  };
}

function makeAgents(): SimAgent[] {
  return [
    { id: 'a1', name: 'a1', capabilities: ['code'], skill: 0.9, reliability: 0.9, honesty: 0.9, wallet: 1000 },
    { id: 'a2', name: 'a2', capabilities: ['code'], skill: 0.5, reliability: 0.5, honesty: 0.5, wallet: 1000 },
    { id: 'a3', name: 'a3', capabilities: ['writing'], skill: 0.8, reliability: 0.8, honesty: 0.8, wallet: 1000 },
    { id: 'buyer', name: 'buyer', capabilities: ['code'], skill: 0.7, reliability: 0.7, honesty: 0.7, wallet: 1000 },
  ];
}

function makeOffers(): Offer[] {
  return [
    { taskId: 'task-0001', agentId: 'a1', price: 120, latency: 2 },
    { taskId: 'task-0001', agentId: 'a2', price: 90, latency: 6 },
    { taskId: 'task-0001', agentId: 'a3', price: 105, latency: 3 },
  ];
}

describe('[正确性] Market Engine', () => {
  it('discover 找到能力匹配且非 buyer 的候选', () => {
    const m = new MarketEngine(new Rng(1));
    const task = makeTask({ domain: 'code' });
    const found = m.discover(task, makeAgents(), 'buyer');
    expect(found.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('offer 报价在 85%–115% 预算区间', () => {
    const m = new MarketEngine(new Rng(42));
    const task = makeTask({ budget: 100 });
    for (let i = 0; i < 100; i++) {
      const o = m.offer(task, { id: `a${i}`, name: 'x', capabilities: ['code'], skill: 0.5, reliability: 0.5, honesty: 0.5, wallet: 0 });
      expect(o.price).toBeGreaterThanOrEqual(85);
      expect(o.price).toBeLessThanOrEqual(115);
    }
  });

  it('offer 时延随技能提高而下降', () => {
    const m = new MarketEngine(new Rng(1));
    const task = makeTask();
    const hi = m.offer(task, { id: 'hi', name: 'hi', capabilities: ['code'], skill: 0.95, reliability: 0.5, honesty: 0.5, wallet: 0 });
    const lo = m.offer(task, { id: 'lo', name: 'lo', capabilities: ['code'], skill: 0.3, reliability: 0.5, honesty: 0.5, wallet: 0 });
    expect(hi.latency).toBeLessThan(lo.latency);
  });

  it('accept 默认选最低价并形成 accepted contract', () => {
    const m = new MarketEngine(new Rng(1));
    const task = makeTask();
    const c = m.accept(task, 'buyer', makeOffers(), 'lowest-price');
    expect(c).not.toBeNull();
    expect(c!.providerId).toBe('a2'); // price 90 最低
    expect(c!.price).toBe(90);
    expect(c!.buyerId).toBe('buyer');
    expect(c!.taskId).toBe(task.id);
    expect(c!.status).toBe('accepted');
  });

  it('contract id 唯一递增', () => {
    const m = new MarketEngine(new Rng(1));
    const task = makeTask();
    const c1 = m.accept(task, 'buyer', makeOffers());
    const c2 = m.accept(task, 'buyer', makeOffers());
    expect(c1!.id).not.toBe(c2!.id);
    expect(c1!.id).toBe('contract-0001');
    expect(c2!.id).toBe('contract-0002');
  });

  it('selectOffer lowest-price 返回最低价 offer', () => {
    const o = selectOffer(makeOffers(), 'lowest-price', new Rng(1));
    expect(o?.agentId).toBe('a2');
  });

  it('selectOffer random 返回集合内元素', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 20; i++) {
      const o = selectOffer(makeOffers(), 'random', rng);
      expect(['a1', 'a2', 'a3']).toContain(o?.agentId);
    }
  });
});

describe('[确定性] Market Engine', () => {
  it('同 seed 两个引擎 offerAll 结果 deep-equal', () => {
    const agents = makeAgents().filter((a) => a.id !== 'buyer');
    const task = makeTask();
    const a = new MarketEngine(new Rng(42)).offerAll(task, agents);
    const b = new MarketEngine(new Rng(42)).offerAll(task, agents);
    expect(a).toEqual(b);
  });

  it('同 seed 的 accept(random) 结果一致', () => {
    const task = makeTask();
    const c1 = new MarketEngine(new Rng(42)).accept(task, 'buyer', makeOffers(), 'random');
    const c2 = new MarketEngine(new Rng(42)).accept(task, 'buyer', makeOffers(), 'random');
    expect(c1).toEqual(c2);
  });
});

describe('[可复现性] Market Engine', () => {
  it('runSimulation 同 seed 两次 contracts deep-equal', () => {
    const a = runSimulation({ agentCount: 50, rounds: 30, seed: 42 });
    const b = runSimulation({ agentCount: 50, rounds: 30, seed: 42 });
    expect(a.contracts).toEqual(b.contracts);
  });
});

describe('[数据完整性] Market Engine', () => {
  it('runSimulation 的 contract 数与 stats.contractsCreated 一致', () => {
    const r = runSimulation({ agentCount: 100, rounds: 50, seed: 42 });
    expect(r.contracts.length).toBe(r.stats.contractsCreated);
    expect(r.contracts.length).toBeGreaterThan(0);
  });

  it('每个 contract 的 provider 具备任务领域能力且非 buyer', () => {
    const r = runSimulation({ agentCount: 100, rounds: 50, seed: 42 });
    const agentById = new Map(r.agents.map((a) => [a.id, a]));
    const taskById = new Map(r.tasks.map((t) => [t.id, t]));
    for (const c of r.contracts) {
      expect(c.providerId).not.toBe(c.buyerId);
      const provider = agentById.get(c.providerId)!;
      const task = taskById.get(c.taskId)!;
      expect(provider.capabilities).toContain(task.domain);
    }
  });

  it('每个 contract 可追溯到存在的 task 与 agent', () => {
    const r = runSimulation({ agentCount: 50, rounds: 30, seed: 7 });
    const agentIds = new Set(r.agents.map((a) => a.id));
    const taskIds = new Set(r.tasks.map((t) => t.id));
    for (const c of r.contracts) {
      expect(taskIds.has(c.taskId)).toBe(true);
      expect(agentIds.has(c.buyerId)).toBe(true);
      expect(agentIds.has(c.providerId)).toBe(true);
    }
  });
});

describe('[可解释性] Market Engine', () => {
  it('contract 的价格与时延来自被选中的 offer', () => {
    const m = new MarketEngine(new Rng(1));
    const task = makeTask();
    const offers = makeOffers();
    const c = m.accept(task, 'buyer', offers, 'lowest-price');
    const best = offers.reduce((a, b) => (a.price <= b.price ? a : b));
    expect(c!.price).toBe(best.price);
    expect(c!.latency).toBe(best.latency);
    expect(c!.providerId).toBe(best.agentId);
  });
});

describe('[鲁棒性] Market Engine', () => {
  it('discover 空池返回 []', () => {
    const m = new MarketEngine(new Rng(1));
    expect(m.discover(makeTask(), [], 'buyer')).toEqual([]);
  });

  it('accept 空 offers 返回 null', () => {
    const m = new MarketEngine(new Rng(1));
    expect(m.accept(makeTask(), 'buyer', [])).toBeNull();
  });

  it('selectOffer 空数组返回 null', () => {
    expect(selectOffer([], 'lowest-price', new Rng(1))).toBeNull();
  });

  it('无能力匹配者时 runSimulation 不产生 contract', () => {
    const r = runSimulation({ agentCount: 1, rounds: 10, seed: 1 });
    expect(r.contracts).toHaveLength(0);
  });
});

describe('[性能] Market Engine', () => {
  it('10000 报价 selectOffer 在 50ms 内完成', () => {
    const offers: Offer[] = Array.from({ length: 10000 }, (_, i) => ({
      taskId: 't',
      agentId: `a${i}`,
      price: i % 1000,
      latency: 1,
    }));
    const t0 = Date.now();
    selectOffer(offers, 'lowest-price', new Rng(1));
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
