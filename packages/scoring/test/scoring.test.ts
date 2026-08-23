import { describe, expect, it } from 'vitest';
import { DIMENSION_WEIGHTS, type Dimension, type Source } from '@acl/core';
import { computeScore, SCORE_MODEL_VERSION, type EvidencePoint } from '../src/index';

const NOW = new Date('2026-08-23T12:00:00Z');

function ev(partial: Partial<EvidencePoint> & { dimension: Dimension }): EvidencePoint {
  return { source: 'simulation', result: 'success', timestamp: NOW, ...partial };
}

// 验收维度映射：docs/TESTING.md
// 正确性 / 确定性 / 可解释性 / 可复现性 / 鲁棒性 / 数据完整性 / 性能

describe('[正确性] Correctness', () => {
  it('单条 success → score 1000', () => {
    expect(computeScore([ev({ dimension: 'capability', source: 'benchmark' })], NOW).score).toBe(1000);
  });

  it('单条 failure → score 0', () => {
    expect(computeScore([ev({ dimension: 'capability', source: 'benchmark', result: 'failure' })], NOW).score).toBe(0);
  });

  it('单条 partial → score 500', () => {
    expect(computeScore([ev({ dimension: 'capability', source: 'benchmark', result: 'partial' })], NOW).score).toBe(500);
  });

  it('跨维度混合：capability 成功 + reliability 失败 → 500', () => {
    const r = computeScore(
      [
        ev({ dimension: 'capability', source: 'benchmark' }),
        ev({ dimension: 'reliability', source: 'benchmark', result: 'failure' }),
      ],
      NOW,
    );
    expect(r.score).toBe(500);
  });

  it('score 始终落在 [0, 1000]', () => {
    const r = computeScore(
      [
        ev({ dimension: 'capability', source: 'benchmark', result: 'success' }),
        ev({ dimension: 'economic', source: 'real', result: 'partial' }),
        ev({ dimension: 'integrity', source: 'self-reported', result: 'failure' }),
      ],
      NOW,
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1000);
  });
});

describe('[确定性] Determinism', () => {
  it('同输入两次结果完全一致（deep-equal）', () => {
    const evidence = [ev({ dimension: 'capability', source: 'benchmark' }), ev({ dimension: 'reliability' })];
    expect(computeScore(evidence, NOW)).toEqual(computeScore(evidence, NOW));
  });
});

describe('[可解释性] Explainability', () => {
  it('explanation 覆盖所有有证据的维度', () => {
    const r = computeScore([ev({ dimension: 'capability' }), ev({ dimension: 'economic' })], NOW);
    expect(r.explanation.map((e) => e.dimension).sort()).toEqual(['capability', 'economic']);
  });

  it('explanation 每项含维度/分数/权重/证据数', () => {
    const r = computeScore([ev({ dimension: 'capability', source: 'benchmark' })], NOW);
    const item = r.explanation[0];
    expect(item).toHaveProperty('dimension');
    expect(item).toHaveProperty('score');
    expect(item).toHaveProperty('weight');
    expect(item).toHaveProperty('evidenceCount');
    expect(item.evidenceCount).toBe(1);
  });

  it('dimensions 恒返回 8 个维度，无证据的 score 为 null', () => {
    const r = computeScore([ev({ dimension: 'capability' })], NOW);
    expect(r.dimensions).toHaveLength(8);
    expect(r.dimensions.filter((d) => d.score === null)).toHaveLength(7);
  });

  it('evidenceCount 汇总等于输入证据数', () => {
    const evidence = [ev({ dimension: 'capability' }), ev({ dimension: 'delivery' }), ev({ dimension: 'security' })];
    expect(computeScore(evidence, NOW).evidenceCount).toBe(3);
  });
});

describe('[覆盖度] Coverage', () => {
  it('单 capability → coverage 0.2', () => {
    expect(computeScore([ev({ dimension: 'capability', source: 'benchmark' })], NOW).coverage).toBeCloseTo(0.2, 4);
  });

  it('全 8 维度 → coverage 1.0', () => {
    const all = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).map((d) => ev({ dimension: d }));
    expect(computeScore(all, NOW).coverage).toBeCloseTo(1.0, 4);
  });

  it('两维度 → coverage = 权重和', () => {
    const r = computeScore([ev({ dimension: 'capability' }), ev({ dimension: 'negotiation' })], NOW);
    expect(r.coverage).toBeCloseTo(0.2 + 0.05, 4);
  });
});

describe('[来源权重] Source weighting', () => {
  it('高权重来源（benchmark）对分数影响大于低权重（self-reported）', () => {
    const benchHigh = computeScore(
      [
        ev({ dimension: 'capability', source: 'benchmark', result: 'success' }),
        ev({ dimension: 'capability', source: 'self-reported', result: 'failure' }),
      ],
      NOW,
    );
    const selfHigh = computeScore(
      [
        ev({ dimension: 'capability', source: 'self-reported', result: 'success' }),
        ev({ dimension: 'capability', source: 'benchmark', result: 'failure' }),
      ],
      NOW,
    );
    expect(benchHigh.score!).toBeGreaterThan(selfHigh.score!);
  });

  it('真实来源（real）满分证据 → score 1000', () => {
    expect(computeScore([ev({ dimension: 'capability', source: 'real' })], NOW).score).toBe(1000);
  });
});

describe('[置信度] Confidence semantics', () => {
  it('无证据 → confidence 0', () => {
    expect(computeScore([], NOW).confidence).toBe(0);
  });

  it('证据越多 → confidence 越高', () => {
    const one = [ev({ dimension: 'capability', source: 'benchmark' })];
    const many = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).flatMap((d) => [
      ev({ dimension: d, source: 'benchmark' }),
      ev({ dimension: d, source: 'benchmark' }),
      ev({ dimension: d, source: 'benchmark' }),
    ]);
    expect(computeScore(many, NOW).confidence).toBeGreaterThan(computeScore(one, NOW).confidence);
  });

  it('verified 来源置信度高于 self-reported', () => {
    const self = computeScore([ev({ dimension: 'capability', source: 'self-reported' })], NOW);
    const verified = computeScore([ev({ dimension: 'capability', source: 'verified' })], NOW);
    expect(verified.confidence).toBeGreaterThan(self.confidence);
  });

  it('confidence 封顶 1', () => {
    const many = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).flatMap((d) =>
      Array.from({ length: 30 }, () => ev({ dimension: d, source: 'real' })),
    );
    expect(computeScore(many, NOW).confidence).toBeLessThanOrEqual(1);
  });
});

describe('[新鲜度] Freshness decay', () => {
  it('旧证据 freshnessFactor 更低、freshnessDays 更高', () => {
    const old = computeScore(
      [ev({ dimension: 'capability', source: 'benchmark', timestamp: new Date('2026-06-24T12:00:00Z') })],
      NOW,
    );
    const fresh = computeScore([ev({ dimension: 'capability', source: 'benchmark', timestamp: NOW })], NOW);
    expect(old.freshnessFactor).toBeLessThan(fresh.freshnessFactor);
    expect(old.freshnessDays!).toBeGreaterThan(fresh.freshnessDays!);
  });

  it('60 天前（2 个半衰期）→ freshnessFactor ≈ 0.25', () => {
    const r = computeScore(
      [ev({ dimension: 'capability', source: 'benchmark', timestamp: new Date('2026-06-24T12:00:00Z') })],
      NOW,
    );
    expect(r.freshnessDays).toBeCloseTo(60, 1);
    expect(r.freshnessFactor).toBeCloseTo(0.25, 2);
  });

  it('无 timestamp → freshnessFactor = 1', () => {
    const r = computeScore([{ dimension: 'capability', source: 'benchmark', result: 'success' }], NOW);
    expect(r.freshnessFactor).toBe(1);
  });
});

describe('[鲁棒性] Robustness', () => {
  it('空数组不抛异常，返回 unverified', () => {
    const r = computeScore([], NOW);
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('value 越界被 clamp 到 [0,1]', () => {
    const high = computeScore([ev({ dimension: 'capability', source: 'benchmark', value: 1.5 })], NOW);
    const low = computeScore([ev({ dimension: 'capability', source: 'benchmark', value: -0.5 })], NOW);
    expect(high.score).toBe(1000);
    expect(low.score).toBe(0);
  });

  it('未知 source 回退默认权重，不抛异常', () => {
    const r = computeScore([ev({ dimension: 'capability', source: 'hacker' as Source })], NOW);
    expect(r.score).not.toBeNull();
    expect(r.score).toBe(1000);
  });

  it('非法维度（运行时传入）被忽略，不崩', () => {
    const r = computeScore([{ dimension: 'not-a-dim' as Dimension, source: 'benchmark', result: 'success' }], NOW);
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
});

describe('[单调性] Monotonicity', () => {
  it('同维度添加成功证据不降低分数', () => {
    const before = computeScore([ev({ dimension: 'capability', source: 'benchmark', result: 'failure' })], NOW);
    const after = computeScore(
      [
        ev({ dimension: 'capability', source: 'benchmark', result: 'failure' }),
        ev({ dimension: 'capability', source: 'benchmark', result: 'success' }),
      ],
      NOW,
    );
    expect(after.score!).toBeGreaterThan(before.score!);
  });
});

describe('[可复现性] Reproducibility', () => {
  it('modelVersion 固定且可追溯', () => {
    expect(SCORE_MODEL_VERSION).toBe('baseline-v0.1');
    expect(computeScore([ev({ dimension: 'capability' })], NOW).modelVersion).toBe(SCORE_MODEL_VERSION);
  });
});

describe('[性能] Performance', () => {
  it('万级证据计算 < 2s（冒烟）', () => {
    const dims = Object.keys(DIMENSION_WEIGHTS) as Dimension[];
    const evidence = Array.from({ length: 10000 }, (_, i) =>
      ev({ dimension: dims[i % 8], source: 'benchmark', result: i % 3 === 0 ? 'failure' : 'success' }),
    );
    const t0 = performance.now();
    computeScore(evidence, NOW);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
