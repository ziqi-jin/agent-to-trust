import { SUITE } from './suite.js';
import type { BenchmarkCase, BenchmarkDimension } from './types.js';

export { BENCHMARK_VERSION } from './version.js';
export type { BenchmarkCase, BenchmarkDimension, Grading, EvidenceResult } from './types.js';
export { DIMENSION_MAP } from './types.js';

/** 加载题集；可按维度过滤。确定性：返回顺序固定。 */
export function loadSuite(dimension?: BenchmarkDimension): readonly BenchmarkCase[] {
  return dimension ? SUITE.filter((c) => c.dimension === dimension) : SUITE;
}
