import { describe, it, expect } from 'vitest';
import type { EvidenceResult } from '@acl/core';
import { ExecutionEngine, Rng, runSimulation } from '../src/index';
import type { Contract, SimAgent, SimTask, Verification } from '../src/types';

const CONFIG = { agentCount: 100, rounds: 50, seed: 42, initialWallet: 1000 };

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

function makeProvider(overrides?: Partial<SimAgent>): SimAgent {
  return {
    id: 'p1',
    name: 'p1',
    capabilities: ['code'],
    skill: 0.9,
    reliability: 0.9,
    honesty: 0.9,
    wallet: 0,
    ...overrides,
  };
}

function makeContract(overrides?: Partial<Contract>): Contract {
  return {
    id: 'contract-0001',
    taskId: 'task-0001',
    buyerId: 'buyer',
    providerId: 'p1',
    price: 100,
    latency: 2,
    status: 'accepted',
    createdAt: new Date(0),
    acceptedAt: new Date(0),
    ...overrides,
  };
}

function makeVerification(result: EvidenceResult, overrides?: Partial<Verification>): Verification {
  return {
    contractId: 'contract-0001',
    providerId: 'p1',
    measuredQuality: 1,
    caughtCheating: false,
    result,
    ...overrides,
  };
}

describe('[正确性] Execution Engine', () => {
  it('execute 的 actualQuality 等于 provider 技能水平', () => {
    const e = new ExecutionEngine(new Rng(1));
    const o = e.execute(makeContract(), makeProvider({ skill: 0.73 }));
    expect(o.actualQuality).toBe(0.73);
    expect(o.contractId).toBe('contract-0001');
    expect(o.providerId).toBe('p1');
  });

  it('honesty=1 的 provider 永不 cheated', () => {
    const e = new ExecutionEngine(new Rng(42));
    for (let i = 0; i < 20; i++) {
      const o = e.execute(makeContract(), makeProvider({ honesty: 1 }));
      expect(o.cheated).toBe(false);
    }
  });

  it('honesty=0 的 provider 恒 cheated', () => {
    const e = new ExecutionEngine(new Rng(42));
    const o = e.execute(makeContract(), makeProvider({ honesty: 0 }));
    expect(o.cheated).toBe(true);
  });

  it('deliver：诚实者声称质量 = 实际质量', () => {
    const e = new ExecutionEngine(new Rng(1));
    const provider = makeProvider({ skill: 0.8, honesty: 1 });
    const o = e.execute(makeContract(), provider);
    const d = e.deliver(makeContract(), o);
    expect(d.claimedQuality).toBe(o.actualQuality);
    expect(d.cheated).toBe(false);
  });

  it('deliver：作弊者声称质量虚报为 1', () => {
    const e = new ExecutionEngine(new Rng(1));
    const provider = makeProvider({ skill: 0.3, honesty: 0 });
    const o = e.execute(makeContract(), provider);
    const d = e.deliver(makeContract(), o);
    expect(d.claimedQuality).toBe(1);
    expect(d.cheated).toBe(true);
  });

  it('verify：诚实 + 胜任 + 准时 → success', () => {
    const e = new ExecutionEngine(new Rng(1));
    const provider = makeProvider({ skill: 0.9, reliability: 1, honesty: 1 });
    const contract = makeContract();
    const o = e.execute(contract, provider);
    const d = e.deliver(contract, o);
    const v = e.verify(contract, o, d, makeTask({ complexity: 0.5 }));
    expect(o.onTime).toBe(true);
    expect(v.result).toBe('success');
    expect(v.caughtCheating).toBe(false);
  });

  it('verify：诚实 + 胜任 + 迟到 → partial', () => {
    const e = new ExecutionEngine(new Rng(1));
    const provider = makeProvider({ skill: 0.9, reliability: 0, honesty: 1 });
    const contract = makeContract();
    const o = e.execute(contract, provider);
    const d = e.deliver(contract, o);
    const v = e.verify(contract, o, d, makeTask({ complexity: 0.5 }));
    expect(o.onTime).toBe(false);
    expect(v.result).toBe('partial');
  });

  it('verify：诚实 + 不胜任 → failure', () => {
    const e = new ExecutionEngine(new Rng(1));
    const provider = makeProvider({ skill: 0.2, reliability: 1, honesty: 1 });
    const contract = makeContract();
    const o = e.execute(contract, provider);
    const d = e.deliver(contract, o);
    const v = e.verify(contract, o, d, makeTask({ complexity: 0.5 }));
    expect(v.result).toBe('failure');
    expect(v.caughtCheating).toBe(false);
  });

  it('verify：作弊被识破 → failure 且 caughtCheating=true', () => {
    const contract = makeContract();
    const task = makeTask({ complexity: 0.5 });
    const provider = makeProvider({ skill: 0.2, reliability: 1, honesty: 0 });
    let caught = false;
    for (let seed = 0; seed < 200; seed++) {
      const e = new ExecutionEngine(new Rng(seed));
      const o = e.execute(contract, provider);
      const d = e.deliver(contract, o);
      const v = e.verify(contract, o, d, task);
      if (v.caughtCheating) {
        caught = true;
        expect(v.result).toBe('failure');
        break;
      }
    }
    expect(caught).toBe(true);
  });

  it('verify：作弊存在未被识破（蒙混过关）的情况', () => {
    const contract = makeContract();
    const task = makeTask({ complexity: 0.5 });
    const provider = makeProvider({ skill: 0.2, reliability: 1, honesty: 0 });
    let passed = false;
    for (let seed = 0; seed < 200; seed++) {
      const e = new ExecutionEngine(new Rng(seed));
      const o = e.execute(contract, provider);
      const d = e.deliver(contract, o);
      const v = e.verify(contract, o, d, task);
      if (!v.caughtCheating && v.result === 'success') {
        passed = true;
        break;
      }
    }
    expect(passed).toBe(true);
  });

  it('settle：success 全款 / partial 半款 / failure 0', () => {
    const e = new ExecutionEngine(new Rng(1));
    const c = makeContract({ price: 100 });
    expect(e.settle(c, makeVerification('success')).amount).toBe(100);
    expect(e.settle(c, makeVerification('partial')).amount).toBe(50);
    expect(e.settle(c, makeVerification('failure')).amount).toBe(0);
  });
});

describe('[确定性] Execution Engine', () => {
  it('同 seed 两次 execute→deliver→verify→settle 结果 deep-equal', () => {
    const run = (seed: number) => {
      const e = new ExecutionEngine(new Rng(seed));
      const contract = makeContract();
      const provider = makeProvider({ skill: 0.6, reliability: 0.7, honesty: 0.6 });
      const task = makeTask({ complexity: 0.5 });
      const o = e.execute(contract, provider);
      const d = e.deliver(contract, o);
      const v = e.verify(contract, o, d, task);
      const s = e.settle(contract, v);
      return { o, d, v, s };
    };
    expect(run(42)).toEqual(run(42));
  });
});

describe('[可复现性] Execution Engine', () => {
  it('runSimulation 同 seed 两次事件序列（含 DELIVER/VERIFY）一致', () => {
    const a = runSimulation(CONFIG);
    const b = runSimulation(CONFIG);
    expect(a.events).toEqual(b.events);
    expect(a.events.some((e) => e.type === 'VERIFY')).toBe(true);
    expect(a.events.some((e) => e.type === 'DELIVER')).toBe(true);
  });
});

describe('[数据完整性] Execution Engine', () => {
  it('每个 contract 都有完整事件链 EXECUTE→DELIVER→VERIFY→SETTLE 且有序', () => {
    const r = runSimulation(CONFIG);
    const seqByTask = new Map<string, string[]>();
    for (const ev of r.events) {
      if (!ev.taskId) continue;
      const arr = seqByTask.get(ev.taskId) ?? [];
      arr.push(ev.type);
      seqByTask.set(ev.taskId, arr);
    }
    expect(r.contracts.length).toBeGreaterThan(0);
    for (const c of r.contracts) {
      const seq = seqByTask.get(c.taskId) ?? [];
      for (const t of ['EXECUTE', 'DELIVER', 'VERIFY', 'SETTLE']) expect(seq).toContain(t);
      expect(seq.indexOf('EXECUTE')).toBeLessThan(seq.indexOf('DELIVER'));
      expect(seq.indexOf('DELIVER')).toBeLessThan(seq.indexOf('VERIFY'));
      expect(seq.indexOf('VERIFY')).toBeLessThan(seq.indexOf('SETTLE'));
    }
  });

  it('contract 状态流转到 settled', () => {
    const r = runSimulation(CONFIG);
    for (const c of r.contracts) expect(c.status).toBe('settled');
  });

  it('交易金额与结算结果一致（settle 决定钱包转账）', () => {
    const r = runSimulation(CONFIG);
    for (const tx of r.transactions) {
      if (tx.result === 'success') expect(tx.amount).toBeGreaterThan(0);
      if (tx.result === 'failure') expect(tx.amount).toBe(0);
    }
  });
});

describe('[可解释性] Execution Engine', () => {
  it('verify 的 result 可追溯到 measuredQuality 与 complexity 的关系', () => {
    const e = new ExecutionEngine(new Rng(1));
    const contract = makeContract();
    // 诚实 provider：measuredQuality = skill，结果由 skill vs complexity + onTime 决定
    const provider = makeProvider({ skill: 0.8, reliability: 1, honesty: 1 });
    const o = e.execute(contract, provider);
    const d = e.deliver(contract, o);
    const v = e.verify(contract, o, d, makeTask({ complexity: 0.5 }));
    expect(v.measuredQuality).toBe(0.8);
    expect(v.measuredQuality >= 0.5).toBe(true);
    expect(v.result).toBe('success');
  });
});

describe('[鲁棒性] Execution Engine', () => {
  it('极端 provider 参数不抛异常', () => {
    const e = new ExecutionEngine(new Rng(1));
    for (const skill of [0, 1, 0.999]) {
      for (const honesty of [0, 1]) {
        const contract = makeContract();
        const provider = makeProvider({ skill, honesty, reliability: 0.5 });
        const o = e.execute(contract, provider);
        const d = e.deliver(contract, o);
        expect(() => e.verify(contract, o, d, makeTask({ complexity: 0 }))).not.toThrow();
      }
    }
  });

  it('complexity=0 时胜任恒成立', () => {
    const e = new ExecutionEngine(new Rng(1));
    const provider = makeProvider({ skill: 0.1, reliability: 1, honesty: 1 });
    const contract = makeContract();
    const o = e.execute(contract, provider);
    const d = e.deliver(contract, o);
    const v = e.verify(contract, o, d, makeTask({ complexity: 0 }));
    expect(v.result).toBe('success');
  });
});

describe('[性能] Execution Engine', () => {
  it('单次 execute→deliver→verify→settle < 5ms', () => {
    const e = new ExecutionEngine(new Rng(1));
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      const contract = makeContract({ id: `c-${i}` });
      const provider = makeProvider({ id: `p-${i}` });
      const task = makeTask();
      const o = e.execute(contract, provider);
      const d = e.deliver(contract, o);
      const v = e.verify(contract, o, d, task);
      e.settle(contract, v);
    }
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
