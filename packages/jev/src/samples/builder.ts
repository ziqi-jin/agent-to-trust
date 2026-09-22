import { loadSuite, type BenchmarkCase, type BenchmarkDimension } from 'agent-to-trust';
import { FIXTURES } from './fixtures.js';
import type { Verdict } from '../types.js';

export interface BuiltSample {
  caseId: string;
  dimension: BenchmarkDimension;
  /** 金标签（tricky 归入 failure）。 */
  label: Verdict;
  output: string;
}

const BY_ID = new Map(loadSuite().map((c) => [c.id, c]));

/** 按 caseId 取回题面（供判官用）。 */
export function findCase(id: string): BenchmarkCase | undefined {
  return BY_ID.get(id);
}

/** 展开 fixtures → 样本列表。确定性（顺序固定）。 */
export function buildSamples(): BuiltSample[] {
  const out: BuiltSample[] = [];
  for (const [caseId, outs] of Object.entries(FIXTURES)) {
    const c = BY_ID.get(caseId);
    if (!c) continue;
    for (const [key, output] of Object.entries(outs)) {
      if (typeof output !== 'string') continue;
      const label: Verdict = key === 'tricky' ? 'failure' : (key as Verdict);
      out.push({ caseId, dimension: c.dimension, label, output });
    }
  }
  return out;
}
