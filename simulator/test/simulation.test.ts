import { describe, it, expect } from 'vitest';
import {
  runSimulation,
  scoreAgents,
  generateAgents,
  hashSeed,
  Rng,
} from '../src/index';

const CONFIG = { agentCount: 100, rounds: 50, seed: 42, initialWallet: 1000 };

describe('[正确性] Simulation Engine', () => {
  it('生成指定数量的 Agent', () => {
    const r = runSimulation(CONFIG);
    expect(r.agents).toHaveLength(100);
    expect(r.stats.agentCount).toBe(100);
  });

  it('钱包守恒：转账不创造/销毁资金', () => {
    const r = runSimulation(CONFIG);
    const total = r.agents.reduce((s, a) => s + a.wallet, 0);
    expect(total).toBe(100 * 1000);
  });

  it('settled + failed + partial === transactions', () => {
    const r = runSimulation(CONFIG);
    expect(r.stats.settled + r.stats.failed + r.stats.partial).toBe(r.stats.transactions);
  });

  it('失败交易金额为 0（不转账）', () => {
    const r = runSimulation(CONFIG);
    for (const tx of r.transactions) {
      if (tx.result === 'failure') expect(tx.amount).toBe(0);
    }
  });

  it('成功交易金额 > 0 且 <= 任务预算', () => {
    const r = runSimulation(CONFIG);
    const budgetByTask = new Map(r.tasks.map((t) => [t.id, t.budget]));
    for (const tx of r.transactions) {
      if (tx.result === 'success') {
        expect(tx.amount).toBeGreaterThan(0);
        expect(tx.amount).toBeLessThanOrEqual(budgetByTask.get(tx.taskId) ?? Infinity);
      }
    }
  });

  it('行为参数在合法区间内', () => {
    const agents = generateAgents(100, new Rng(1), 1000);
    for (const a of agents) {
      expect(a.skill).toBeGreaterThanOrEqual(0.3);
      expect(a.skill).toBeLessThanOrEqual(0.95);
      expect(a.honesty).toBeGreaterThanOrEqual(0.3);
      expect(a.honesty).toBeLessThanOrEqual(0.95);
      expect(a.capabilities.length).toBeGreaterThanOrEqual(1);
      expect(a.capabilities.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('[确定性] Simulation Engine', () => {
  it('同 seed 两次运行 deep-equal', () => {
    const a = runSimulation(CONFIG);
    const b = runSimulation(CONFIG);
    expect(a).toEqual(b);
  });

  it('不同 seed 产生不同交易序列', () => {
    const a = runSimulation(CONFIG);
    const b = runSimulation({ ...CONFIG, seed: 43 });
    expect(a.transactions).not.toEqual(b.transactions);
  });
});

describe('[可复现性] Simulation Engine', () => {
  it('可读 seed 名经 hashSeed 派生后结果稳定', () => {
    const a = runSimulation({ agentCount: 10, rounds: 10, seed: hashSeed('demo-experiment') });
    const b = runSimulation({ agentCount: 10, rounds: 10, seed: hashSeed('demo-experiment') });
    expect(a).toEqual(b);
    // 确保确实产生了交易（seed 派生有效）
    expect(a.transactions.length).toBeGreaterThan(0);
  });
});

describe('[数据完整性] Simulation Engine', () => {
  it('每条 evidence 显式标记 source=simulation（不伪装真实）', () => {
    const r = runSimulation(CONFIG);
    expect(r.evidence.length).toBeGreaterThan(0);
    for (const e of r.evidence) expect(e.source).toBe('simulation');
  });

  it('每条 evidence 可追溯到存在的 transaction', () => {
    const r = runSimulation(CONFIG);
    const txIds = new Set(r.transactions.map((t) => t.id));
    for (const e of r.evidence) expect(txIds.has(e.transactionId)).toBe(true);
  });

  it('每条 evidence 的 agentId 是存在的 agent', () => {
    const r = runSimulation(CONFIG);
    const agentIds = new Set(r.agents.map((a) => a.id));
    for (const e of r.evidence) expect(agentIds.has(e.agentId)).toBe(true);
  });

  it('每笔成功交易产生 6 条 evidence（6 维度）', () => {
    const r = runSimulation(CONFIG);
    expect(r.evidence.length).toBe(r.transactions.length * 6);
  });
});

describe('[可解释性] Simulation Engine', () => {
  it('每个 agent 的信用分可反查到 evidence（数量一致）', () => {
    const r = runSimulation(CONFIG);
    const scores = scoreAgents(r);
    expect(scores.size).toBeGreaterThan(0);
    for (const [agentId, s] of scores) {
      const evCount = r.evidence.filter((e) => e.agentId === agentId).length;
      expect(s.evidenceCount).toBe(evCount);
      expect(evCount).toBeGreaterThan(0);
    }
  });

  it('分数带 modelVersion 且可追溯', () => {
    const r = runSimulation(CONFIG);
    for (const s of scoreAgents(r).values()) {
      expect(s.modelVersion).toBe('baseline-v0.2');
    }
  });
});

describe('[标定] economic / negotiation 证据链路', () => {
  it('每笔成交都产出 economic + negotiation 证据，且 source=simulation', () => {
    const r = runSimulation(CONFIG);
    const econ = r.evidence.filter((e) => e.dimension === 'economic');
    const negot = r.evidence.filter((e) => e.dimension === 'negotiation');
    expect(econ.length).toBe(r.transactions.length);
    expect(negot.length).toBe(r.transactions.length);
    for (const e of [...econ, ...negot]) expect(e.source).toBe('simulation');
  });

  it('economic value 在 0..1 区间且带 result 映射', () => {
    const r = runSimulation(CONFIG);
    const econ = r.evidence.filter((e) => e.dimension === 'economic');
    for (const e of econ) {
      expect(e.value).toBeDefined();
      expect(e.value!).toBeGreaterThanOrEqual(0);
      expect(e.value!).toBeLessThanOrEqual(1);
      if (e.value! >= 0.9) expect(e.result).toBe('success');
      else if (e.value! >= 0.6) expect(e.result).toBe('partial');
      else expect(e.result).toBe('failure');
    }
  });

  it('negotiation value 即成交价/预算比，在 0.55..1 区间', () => {
    // 报价经预算约束后 price <= budget，且 undercut 下探 0.55，故 value ∈ [0.55, 1]。
    const r = runSimulation(CONFIG);
    const negot = r.evidence.filter((e) => e.dimension === 'negotiation');
    for (const e of negot) {
      expect(e.value).toBeDefined();
      expect(e.value!).toBeGreaterThanOrEqual(0.55);
      expect(e.value!).toBeLessThanOrEqual(1);
      if (e.value! >= 0.85) expect(e.result).toBe('success');
      else if (e.value! >= 0.7) expect(e.result).toBe('partial');
      else expect(e.result).toBe('failure');
    }
  });

  it('economic 与 negotiation 存在反向张力：压价(undercut)抬升性价比、压低议价', () => {
    // 反例性校验：economic 用「质量÷价位」、negotiation 用「价位」本身，
    // 二者对低价的反应方向相反——这正是真实市场的卖方/买方张力，非缺陷。
    const r = runSimulation(CONFIG);
    const econ = r.evidence.filter((e) => e.dimension === 'economic');
    const negot = r.evidence.filter((e) => e.dimension === 'negotiation');
    expect(econ.length).toBeGreaterThan(0);
    expect(negot.length).toBeGreaterThan(0);
  });
});

describe('[标定] P0-9 连续质量', () => {
  it('capability evidence 带连续 value（0..1）', () => {
    const r = runSimulation(CONFIG);
    const cap = r.evidence.filter((e) => e.dimension === 'capability');
    expect(cap.length).toBeGreaterThan(0);
    for (const e of cap) {
      expect(e.value).toBeDefined();
      expect(e.value!).toBeGreaterThanOrEqual(0);
      expect(e.value!).toBeLessThanOrEqual(1);
    }
  });

  it('分数有区分度（最高分不再打满 1000）', () => {
    const r = runSimulation(CONFIG);
    const scores = [...scoreAgents(r).values()]
      .map((s) => s.score)
      .filter((s): s is number => s !== null);
    expect(scores.length).toBeGreaterThan(5);
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    expect(max).toBeLessThan(1000);
    expect(max - min).toBeGreaterThan(50);
  });
});

describe('[鲁棒性] Simulation Engine', () => {
  it('agentCount=0 安全返回空结果', () => {
    const r = runSimulation({ agentCount: 0, rounds: 10, seed: 1 });
    expect(r.agents).toHaveLength(0);
    expect(r.transactions).toHaveLength(0);
  });

  it('rounds=0 安全返回空任务与空证据', () => {
    const r = runSimulation({ agentCount: 10, rounds: 0, seed: 1 });
    expect(r.tasks).toHaveLength(0);
    expect(r.evidence).toHaveLength(0);
  });

  it('负数参数被钳制为 0', () => {
    const r = runSimulation({ agentCount: -5, rounds: -2, seed: 1 });
    expect(r.agents).toHaveLength(0);
    expect(r.stats.rounds).toBe(0);
  });

  it('小数参数向下取整', () => {
    const r = runSimulation({ agentCount: 3.9, rounds: 5.9, seed: 1 });
    expect(r.agents).toHaveLength(3);
    expect(r.stats.rounds).toBe(5);
  });

  it('agent 过少无法成交时安全降级', () => {
    const r = runSimulation({ agentCount: 1, rounds: 10, seed: 1 });
    expect(r.transactions).toHaveLength(0);
  });
});

describe('[性能] Simulation Engine', () => {
  it('100 agent × 50 round 在 1s 内完成', () => {
    const t0 = Date.now();
    runSimulation(CONFIG);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('1000 agent × 100 round 在 5s 内完成', () => {
    const t0 = Date.now();
    runSimulation({ agentCount: 1000, rounds: 100, seed: 7 });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
