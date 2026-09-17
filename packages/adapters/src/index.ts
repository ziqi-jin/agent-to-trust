/**
 * @a2t/adapters — 真实 Agent 适配层。
 *
 * 把「模型」（LLM，如 DeepSeek）包装成我们系统里的「Agent」个体，
 * 让同一个模型能产生多个不同 persona 的市场参与者，并通过 benchmark
 * 产出 source=benchmark 的真实证据，喂进 @a2t/scoring 评分引擎。
 *
 * 设计原则（2026-08-26 老大拍板）：
 * - 模型 ≠ Agent。模型是大脑，Agent 是市场个体（identity / 行为 / 历史）。
 * - 零新依赖：用 Node 原生 fetch，不引入 SDK。
 * - 证据显式 source=benchmark，绝不伪装成 real/verified。
 */

export type { ChatMessage, ChatCompletionOptions, ChatResponse } from './deepseek';
export { DeepSeekClient, DEFAULT_BASE_URL } from './deepseek';
export type { ModelAgentConfig } from './agent';
export { ModelAgent } from './agent';
export type {
  BenchmarkCase,
  BenchmarkDimension,
  BenchmarkGrading,
  BenchmarkResult,
} from './benchmark';
export {
  BENCHMARK_CASES,
  gradeBenchmark,
  runBenchmark,
  benchmarkToEvidence,
} from './benchmark';
