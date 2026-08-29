import { describe, expect, it } from 'vitest';
import { ScriptedCounterpart } from '../scripted.js';
import type { NegotiationScenario } from '../types.js';

const SC: NegotiationScenario = {
  id: 'test-sc',
  brief: '',
  agentRole: '',
  counterpartRole: '卖家',
  metricLabel: '单价',
  maxRounds: 4,
  strategy: { opening: 100, floor: 55, step: 15, target: 65 },
};

describe('ScriptedCounterpart', () => {
  it('opens at strategy.opening', () => {
    const d = new ScriptedCounterpart(SC).open();
    expect(d.value).toBe(100);
    expect(d.accepted).toBe(false);
  });

  it('concedes by step, never below floor', () => {
    const cp = new ScriptedCounterpart(SC);
    let v = cp.open().value;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const d = cp.respond(0, { round: i + 1, counterpartValue: v }); // 报 0 → 永不接受
      expect(d.accepted).toBe(false);
      v = d.value;
      seen.push(v);
    }
    expect(seen).toEqual([85, 70, 55, 55, 55]);
  });

  it('accepts agent offer at or above accept line', () => {
    const cp = new ScriptedCounterpart(SC);
    const d = cp.respond(85, { round: 1, counterpartValue: 100 }); // 线 = max(55, 85) = 85
    expect(d.accepted).toBe(true);
    expect(d.value).toBe(85);
  });

  it('rejects below accept line', () => {
    const cp = new ScriptedCounterpart(SC);
    const d = cp.respond(84, { round: 1, counterpartValue: 100 });
    expect(d.accepted).toBe(false);
  });

  it("agent 'accept' closes at counterpart current value", () => {
    const cp = new ScriptedCounterpart(SC);
    const d = cp.respond('accept', { round: 2, counterpartValue: 70 });
    expect(d.accepted).toBe(true);
    expect(d.value).toBe(70);
  });
});
