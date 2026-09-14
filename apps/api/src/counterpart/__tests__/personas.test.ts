import { describe, expect, it } from 'vitest';
import { LIVE_PERSONAS, PERSONAS, personaById } from '../personas';

describe('PERSONAS', () => {
  it('四个人格，三个 live + 一个 scripted', () => {
    expect(PERSONAS.map((p) => p.id).sort()).toEqual(
      ['llm-lure', 'llm-softer', 'llm-stubborn', 'scripted'].sort(),
    );
    expect(LIVE_PERSONAS.map((p) => p.id).sort()).toEqual(
      ['llm-lure', 'llm-softer', 'llm-stubborn'].sort(),
    );
  });
  it('每个 live 人格有战术清单与量化区间，且 floor < opening', () => {
    for (const p of LIVE_PERSONAS) {
      expect(p.tactics.zh).toBeTruthy();
      expect(p.tactics.en).toBeTruthy();
      expect(p.strategy.opening[0]).toBeLessThanOrEqual(p.strategy.opening[1]);
      expect(p.strategy.floor[0]).toBeLessThanOrEqual(p.strategy.floor[1]);
      expect(p.strategy.floor[1]).toBeLessThan(p.strategy.opening[0]);
      expect(p.strategy.stepRatio).toBeGreaterThan(0);
    }
  });
  it('personaById 命中 / 未命中原样返回 undefined', () => {
    expect(personaById('llm-lure')?.id).toBe('llm-lure');
    expect(personaById('nope')).toBeUndefined();
  });
});
