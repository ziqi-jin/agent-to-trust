import { describe, expect, it } from 'vitest';
import { DIMENSION_WEIGHTS, type Dimension } from '@acl/core';
import { computeScore, SCORE_MODEL_VERSION, type EvidencePoint } from '../src/index';

const NOW = new Date('2026-08-23T12:00:00Z');

function ev(partial: Partial<EvidencePoint> & { dimension: Dimension }): EvidencePoint {
  return { source: 'simulation', result: 'success', timestamp: NOW, ...partial };
}

describe('computeScore', () => {
  it('无证据 → unverified (score=null)', () => {
    const r = computeScore([]);
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.evidenceCount).toBe(0);
  });

  it('同样输入结果一致（确定性）', () => {
    const evidence = [ev({ dimension: 'capability', source: 'benchmark' }), ev({ dimension: 'reliability' })];
    const r1 = computeScore(evidence, NOW);
    const r2 = computeScore(evidence, NOW);
    expect(r1.score).toBe(r2.score);
    expect(r1.dimensions).toEqual(r2.dimensions);
  });

  it('成功证据分数高于失败证据', () => {
    const success = computeScore([ev({ dimension: 'capability', source: 'benchmark', result: 'success' })], NOW);
    const failure = computeScore([ev({ dimension: 'capability', source: 'benchmark', result: 'failure' })], NOW);
    expect(success.score!).toBeGreaterThan(failure.score!);
  });

  it('只有 capability 证据 → coverage = 0.20', () => {
    const r = computeScore([ev({ dimension: 'capability', source: 'benchmark' })], NOW);
    expect(r.score).not.toBeNull();
    expect(r.coverage).toBeCloseTo(0.2, 4);
    expect(r.dimensions[0].dimension).toBe('capability');
  });

  it('更多证据 → 更高置信度', () => {
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

  it('新鲜度衰减：旧证据 freshness 更低', () => {
    const old = computeScore([ev({ dimension: 'capability', source: 'benchmark', timestamp: new Date('2026-06-24T12:00:00Z') })], NOW);
    const fresh = computeScore([ev({ dimension: 'capability', source: 'benchmark', timestamp: NOW })], NOW);
    expect(old.freshnessFactor).toBeLessThan(fresh.freshnessFactor);
    expect(old.freshnessDays!).toBeGreaterThan(fresh.freshnessDays!);
  });

  it('model_version 为 baseline-v0.1', () => {
    const r = computeScore([ev({ dimension: 'capability' })], NOW);
    expect(r.modelVersion).toBe(SCORE_MODEL_VERSION);
  });
});
