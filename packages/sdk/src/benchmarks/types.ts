/**
 * 题集类型（沿用 @a2t/adapters 已验证的 BenchmarkCase 形状，
 * 在 SDK 内独立定义，避免依赖 adapters 包）。
 */

export type BenchmarkDimension = 'coding' | 'reasoning' | 'honesty';

export type EvidenceResult = 'success' | 'partial' | 'failure';

export interface Grading {
  /** 归一化 0..1。 */
  value: number;
  result: EvidenceResult;
}

export interface BenchmarkCase {
  id: string;
  dimension: BenchmarkDimension;
  /** 评测 prompt（发给被测 agent）。 */
  prompt: string;
  /** 确定性 grader：原始输出 → 打分。 */
  grade: (output: string) => Grading;
}

/** 题维度 → @a2t/core 评分维度。 */
export const DIMENSION_MAP = {
  coding: 'capability',
  reasoning: 'capability',
  honesty: 'integrity',
} as const;
