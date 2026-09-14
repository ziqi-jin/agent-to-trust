import { describe, expect, it } from 'vitest';
import { jitterParams, pickPersona, seedFromSession } from '../select';

describe('pickPersona', () => {
  it('scripted 模式恒为 scripted 人格', () => {
    expect(pickPersona({ mode: 'scripted', seed: 's1' }).id).toBe('scripted');
  });
  it('live 模式抽到三个 LLM 人格之一，且同 seed 可复现', () => {
    const a = pickPersona({ mode: 'live', seed: 'as-abc' });
    const b = pickPersona({ mode: 'live', seed: 'as-abc' });
    expect(a.live).toBe(true);
    expect(a.id).toBe(b.id);
  });
  it('live 模式跨 seed 能抽到不同人格（分布非退化）', () => {
    const seen = new Set([...Array(40).keys()].map((i) => pickPersona({ mode: 'live', seed: `as-${i}` }).id));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('jitterParams', () => {
  it('同 seed 可复现，且落在区间内、floor < opening', () => {
    const p = pickPersona({ mode: 'live', seed: 'as-x' });
    const a = jitterParams(p, 'as-x');
    const b = jitterParams(p, 'as-x');
    expect(a).toEqual(b);
    expect(a.opening).toBeGreaterThanOrEqual(p.strategy.opening[0]);
    expect(a.opening).toBeLessThanOrEqual(p.strategy.opening[1]);
    expect(a.floor).toBeGreaterThanOrEqual(p.strategy.floor[0]);
    expect(a.floor).toBeLessThanOrEqual(p.strategy.floor[1]);
    expect(a.floor).toBeLessThan(a.opening);
  });
});

describe('seedFromSession', () => {
  it('确定性映射', () => {
    expect(seedFromSession('as-1234')).toBe(seedFromSession('as-1234'));
    expect(seedFromSession('as-1234')).not.toBe(seedFromSession('as-9999'));
  });
});
