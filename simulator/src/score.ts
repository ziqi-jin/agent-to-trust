/**
 * @a2t/simulator — 仿真 → 信用评分桥接。
 *
 * 把仿真产生的 SimEvidence 映射到 @a2t/scoring 的 EvidencePoint，
 * 让「仿真交易 → evidence → AgentScore」闭环成立，且每个分数可反查到交易。
 */
import { computeScore, type EvidencePoint, type ScoreResult } from '@a2t/scoring';
import type { SimEvidence, SimulationResult } from './types';

export function evidenceToPoints(evidence: SimEvidence[]): EvidencePoint[] {
  return evidence.map((e) => ({
    dimension: e.dimension,
    source: e.source,
    sourceType: 'simulation',
    result: e.result,
    value: e.value,
    timestamp: e.timestamp,
  }));
}

/** 按 agent 聚合 evidence 并计算每个 agent 的信用分。 */
export function scoreAgents(result: SimulationResult, now?: Date): Map<string, ScoreResult> {
  const byAgent = new Map<string, SimEvidence[]>();
  for (const e of result.evidence) {
    const arr = byAgent.get(e.agentId);
    if (arr) arr.push(e);
    else byAgent.set(e.agentId, [e]);
  }
  const out = new Map<string, ScoreResult>();
  for (const [agentId, ev] of byAgent) {
    out.set(agentId, computeScore(evidenceToPoints(ev), now));
  }
  return out;
}
