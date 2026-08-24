/**
 * @acl/simulator — 仿真类型。
 *
 * 注意：这些都是「仿真世界」的类型，不是 @acl/core 里的「真实世界」类型。
 * 仿真产生的证据会显式标记 source=simulation，绝不伪装成真实交易。
 */
import type { Dimension, EvidenceResult, Source } from '@acl/core';

/** 仿真可用的任务领域。 */
export const DOMAINS = [
  'research',
  'code',
  'writing',
  'data',
  'web',
  'ops',
  'design',
  'math',
] as const;

export type Domain = (typeof DOMAINS)[number];

/** 仿真 Agent：带行为参数（非真实能力），用于驱动仿真行为。 */
export interface SimAgent {
  id: string;
  name: string;
  capabilities: Domain[];
  /** 技能水平 0..1 */
  skill: number;
  /** 交付准时可靠度 0..1 */
  reliability: number;
  /** 诚实度 0..1（越高越不作弊） */
  honesty: number;
  /** 虚拟钱包余额 */
  wallet: number;
}

export interface SimTask {
  id: string;
  domain: Domain;
  /** 复杂度 0..1 */
  complexity: number;
  budget: number;
  deadlineRound: number;
}

export interface Offer {
  taskId: string;
  agentId: string;
  price: number;
  latency: number;
}

export interface SimTransaction {
  id: string;
  taskId: string;
  buyerId: string;
  providerId: string;
  amount: number;
  result: EvidenceResult;
  round: number;
}

/** 合约生命周期状态。 */
export type ContractStatus = 'accepted' | 'executed' | 'settled' | 'cancelled';

/** 撮合接受策略（MVP：最低价 / 随机）。 */
export type AcceptanceStrategy = 'lowest-price' | 'random';

/** 市场合约：buyer 与 provider 在 task 上达成的成交记录。 */
export interface Contract {
  id: string;
  taskId: string;
  buyerId: string;
  providerId: string;
  price: number;
  latency: number;
  status: ContractStatus;
  createdAt: Date;
  acceptedAt: Date;
}

/** 履约结果：provider 实际执行情况（不对外声称）。 */
export interface ExecutionOutcome {
  contractId: string;
  providerId: string;
  /** 实际交付质量 0..1（= 技能水平的体现，可能低于声称值） */
  actualQuality: number;
  /** 是否准时交付 */
  onTime: boolean;
  /** 是否作弊（谎报质量） */
  cheated: boolean;
}

/** 交付物：provider 提交的成果，声称质量可能被作弊虚高。 */
export interface Deliverable {
  contractId: string;
  providerId: string;
  /** 声称质量 0..1 */
  claimedQuality: number;
  onTime: boolean;
  cheated: boolean;
}

/** 验证结果：中立方实测交付物后给出的判定。 */
export interface Verification {
  contractId: string;
  providerId: string;
  /** 实测质量 0..1 */
  measuredQuality: number;
  /** 是否识破作弊 */
  caughtCheating: boolean;
  /** 最终判定 */
  result: EvidenceResult;
}

/** 结算结果：按验证结果计算实际支付金额。 */
export interface Settlement {
  contractId: string;
  amount: number;
  result: EvidenceResult;
}

export interface SimEvent {
  type: string;
  round: number;
  taskId?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

/** 仿真证据：可追溯到 transaction，source 固定 simulation。 */
export interface SimEvidence {
  agentId: string;
  transactionId: string;
  dimension: Dimension;
  source: Source;
  result: EvidenceResult;
  timestamp: Date;
}

export interface SimulationConfig {
  agentCount: number;
  rounds: number;
  seed: number;
  initialWallet?: number;
}

export interface SimulationStats {
  agentCount: number;
  rounds: number;
  tasksCreated: number;
  contractsCreated: number;
  transactions: number;
  settled: number;
  failed: number;
  partial: number;
  totalValue: number;
  totalFees: number;
}

export interface SimulationResult {
  config: SimulationConfig;
  agents: SimAgent[];
  tasks: SimTask[];
  contracts: Contract[];
  transactions: SimTransaction[];
  events: SimEvent[];
  evidence: SimEvidence[];
  stats: SimulationStats;
}
