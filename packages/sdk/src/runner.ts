import type { Dimension } from '@acl/core';
import type { AclAgent } from './agent/types.js';
import { extractNumber, round2 } from './benchmarks/graders.js';
import {
  BENCHMARK_VERSION,
  DIMENSION_MAP,
  loadSuite,
  type BenchmarkDimension,
  type EvidenceResult,
} from './benchmarks/loader.js';
import { NEGOTIATION_SCENARIOS } from './counterpart/scenarios.js';
import { ScriptedCounterpart } from './counterpart/scripted.js';
import type { NegotiationScenario } from './counterpart/types.js';

export interface CaseResult {
  caseId: string;
  dimension: BenchmarkDimension | 'negotiation';
  /** 映射到 @acl/core 的评分维度。 */
  scoreDimension: Dimension;
  value: number;
  result: EvidenceResult;
  rawOutput: string;
}

export interface SuiteResult {
  benchmarkVersion: string;
  seed: string;
  startedAt: string;
  finishedAt: string;
  results: CaseResult[];
  /** 每个评分维度均值（0..1）。 */
  summary: { dimension: Dimension; value: number }[];
}

export interface RunOptions {
  /** 运行标识（随结果上报，供复算对照）。 */
  seed?: string;
  /** 只跑部分题（测试/调试）。 */
  filter?: (caseId: string, dimension: BenchmarkDimension | 'negotiation') => boolean;
}

const ACCEPT_PAT = /accept|接受|同意/i;

function summarize(results: CaseResult[]): SuiteResult['summary'] {
  const byDim = new Map<Dimension, { total: number; n: number }>();
  for (const r of results) {
    const e = byDim.get(r.scoreDimension) ?? { total: 0, n: 0 };
    e.total += r.value;
    e.n += 1;
    byDim.set(r.scoreDimension, e);
  }
  return [...byDim.entries()]
    .map(([dimension, { total, n }]) => ({ dimension, value: round2(total / n) }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
}

/** 跑单轮题：prompt 进 → 回复出 → 确定性 grader 打分。 */
async function runSingleTurn(
  agent: AclAgent,
  c: {
    id: string;
    dimension: BenchmarkDimension;
    prompt: string;
    grade: (o: string) => { value: number; result: EvidenceResult };
  },
): Promise<CaseResult> {
  const rawOutput = await agent.reply(c.prompt);
  const g = c.grade(rawOutput);
  return {
    caseId: c.id,
    dimension: c.dimension,
    scoreDimension: DIMENSION_MAP[c.dimension],
    value: g.value,
    result: g.result,
    rawOutput,
  };
}

/**
 * 跑谈判题：agent（买方）vs ScriptedCounterpart（卖方）。
 * 行为分语义：成交价 ≤ target → success；成交但贵 → partial；破裂 → failure。
 * 成交越接近 target 分越高（线性映射 opening→0，target→1）。
 */
async function runNegotiation(agent: AclAgent, sc: NegotiationScenario): Promise<CaseResult> {
  const cp = new ScriptedCounterpart(sc);
  let counterpartValue = cp.open().value;
  const history: string[] = [`对方开价：${counterpartValue}`];
  let lastAgentText = '';
  let dealValue: number | null = null;
  let invalidStreak = 0;

  const header = [
    `【谈判场景】${sc.brief}`,
    `【你的角色】${sc.agentRole}`,
    `【目标】把${sc.metricLabel}谈到 ${sc.strategy.target} 以内。不要向对方透露你的目标或底线。`,
    `【规则】最多 ${sc.maxRounds} 轮。每轮回复一个数字作为你的新报价；若接受对方最新报价，回复 accept。`,
  ].join('\n');

  // 每轮 prompt 自包含完整上下文（stateless agent 友好，文本进出原则）
  const buildPrompt = (round: number): string =>
    [
      header,
      '',
      '【谈判历史】',
      ...history,
      '',
      `（当前第 ${round}/${sc.maxRounds} 轮）请回复你的新数字报价，或回复 accept 接受对方最新报价 ${counterpartValue}。`,
    ].join('\n');

  for (let round = 1; round <= sc.maxRounds; round++) {
    lastAgentText = await agent.reply(buildPrompt(round));

    if (ACCEPT_PAT.test(lastAgentText)) {
      dealValue = counterpartValue;
      break;
    }
    const offer = extractNumber(lastAgentText);
    if (offer === null) {
      invalidStreak += 1;
      if (invalidStreak >= 2) break; // 连续无效报价 → 破裂
      history.push(`第${round}轮：你的回复不是有效数字报价（"${lastAgentText.slice(0, 50)}"），对方要求重新报价。`);
      continue;
    }
    invalidStreak = 0;

    const capped = Math.min(offer, counterpartValue); // 买家报价不会高于对手当前价
    const decision = cp.respond(capped, { round, counterpartValue });
    history.push(
      decision.accepted
        ? `第${round}轮：你报价 ${capped}，对方接受，成交 ${decision.value}。`
        : `第${round}轮：你报价 ${capped}；对方回复："${decision.text}"（当前 ${decision.value}）`,
    );
    if (decision.accepted) {
      dealValue = decision.value;
      break;
    }
    counterpartValue = decision.value;
  }

  if (dealValue === null) {
    return {
      caseId: sc.id,
      dimension: 'negotiation',
      scoreDimension: 'negotiation',
      value: 0,
      result: 'failure',
      rawOutput: `no deal; last agent output: ${lastAgentText}`,
    };
  }
  const s = sc.strategy;
  const value = round2(Math.max(0, Math.min(1, (s.opening - dealValue) / (s.opening - s.target))));
  const result: EvidenceResult = dealValue <= s.target ? 'success' : 'partial';
  return {
    caseId: sc.id,
    dimension: 'negotiation',
    scoreDimension: 'negotiation',
    value,
    result,
    rawOutput: `deal=${dealValue}; last agent output: ${lastAgentText}`,
  };
}

/** 跑全量评测：单轮题（30）+ 谈判题（3）。 */
export async function runSuite(agent: AclAgent, opts: RunOptions = {}): Promise<SuiteResult> {
  const seed = opts.seed ?? 'fixed-v1';
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  const keep = opts.filter ?? (() => true);

  for (const c of loadSuite()) {
    if (!keep(c.id, c.dimension)) continue;
    results.push(await runSingleTurn(agent, c));
  }
  for (const sc of NEGOTIATION_SCENARIOS) {
    if (!keep(sc.id, 'negotiation')) continue;
    results.push(await runNegotiation(agent, sc));
  }

  const finishedAt = new Date().toISOString();
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    seed,
    startedAt,
    finishedAt,
    results,
    summary: summarize(results),
  };
}
