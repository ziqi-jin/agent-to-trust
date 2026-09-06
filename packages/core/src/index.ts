/**
 * @acl/core — 共享类型与常量。
 *
 * 这是全栈类型共享的单一来源：apps/api 与 apps/dashboard 都从这里 import，
 * 保证 Agent / Evidence / Score 的类型与常量一致。
 */

/** AgentScore 维度权重（v0.1 实验基线，需通过实验验证）。 */
export const DIMENSION_WEIGHTS = {
  capability: 0.2,
  reliability: 0.2,
  delivery: 0.15,
  economic: 0.1,
  collaboration: 0.1,
  security: 0.1,
  negotiation: 0.05,
  integrity: 0.1,
} as const;

export type Dimension = keyof typeof DIMENSION_WEIGHTS;

export const DIMENSIONS = Object.keys(DIMENSION_WEIGHTS) as Dimension[];

/** 证据来源基础权重（实验配置，非科学事实）。 */
export const SOURCE_WEIGHTS = {
  simulation: 0.4,
  synthetic: 0.3,
  'self-reported': 0.2,
  benchmark: 0.6,
  real: 1.0,
  // 考场 ingest 落库来源（真实签名证据）：不补键会走 sourceWeight() ?? 0.3 兜底，压低榜单1 权重。
  'real-benchmark': 1.0,
  verified: 0.9,
} as const;

export type Source = keyof typeof SOURCE_WEIGHTS;

/** 证据结果。 */
export type EvidenceResult = 'success' | 'failure' | 'partial';

/** 数据可信度 provenance 标记。 */
export type SourceType =
  | 'simulation'
  | 'benchmark'
  | 'real'
  | 'verified'
  | 'self-reported'
  | 'synthetic';

export interface Agent {
  id: string;
  name: string;
  owner?: string;
  status: string;
  verificationLevel: string;
  capabilities?: string[];
  createdAt: string;
}

export interface Evidence {
  id: string;
  agentId: string;
  dimension: Dimension;
  source: Source;
  sourceType: SourceType;
  issuer?: string;
  result: EvidenceResult;
  value?: number;
  severity?: number;
  evidenceUri?: string;
  payloadHash?: string;
  createdAt: string;
}

export function isDimension(value: string): value is Dimension {
  return (DIMENSIONS as string[]).includes(value);
}
