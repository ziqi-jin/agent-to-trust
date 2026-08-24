/**
 * @acl/simulator — Simulation Engine v0.1。
 *
 * Agent 池 + 任务生成器 + 虚拟钱包 + 调度器。
 * 确定性（seed 可复现）、纯函数（无外部副作用）、仿真数据显式标记 source=simulation。
 */
export { Rng, mulberry32, hashSeed, round2 } from './rng';
export { generateAgents } from './agents';
export { generateTask } from './tasks';
export { Wallet } from './wallet';
export { MarketEngine, selectOffer } from './market';
export { ExecutionEngine, CHEAT_CAUGHT_RATE } from './execution';
export { runSimulation } from './scheduler';
export { evidenceToPoints, scoreAgents } from './score';
export { DOMAINS } from './types';
export type {
  Domain,
  SimAgent,
  SimTask,
  Offer,
  Contract,
  ContractStatus,
  AcceptanceStrategy,
  ExecutionOutcome,
  Deliverable,
  Verification,
  Settlement,
  SimTransaction,
  SimEvent,
  SimEvidence,
  SimulationConfig,
  SimulationStats,
  SimulationResult,
} from './types';
