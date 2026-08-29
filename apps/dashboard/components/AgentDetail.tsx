'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  DIMENSION_LABELS,
  RESULT_LABELS,
  SOURCE_LABELS,
  scoreTone,
  type Agent,
  type Evidence,
  type ScoreResponse,
} from '@/lib/api';
import { GradeBadge } from './GradeBadge';
import { ScoreRing } from './ScoreRing';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AgentDetail({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [agent, ev, sc] = await Promise.all([
        api.getAgent(agentId),
        api.listEvidence(agentId),
        api.getScore(agentId),
      ]);
      setAgent(agent);
      setEvidence(ev);
      setScore(sc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);


  const dims = score?.dimensions ?? [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <button
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-mono text-dim transition hover:text-bright"
      >
        ← 返回榜单
      </button>

      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-danger text-sm">
          {error}
        </div>
      )}

      {!agent ? (
        <div className="py-16 text-center text-dim text-sm">{busy ? '加载中…' : 'Agent 不存在'}</div>
      ) : (
        <>
          {/* Agent 头部 */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-700 text-bright">{agent.name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-xs font-mono uppercase tracking-wider text-dim">
                  {agent.verificationLevel}
                </span>
                <span className="text-dim">·</span>
                <span className="text-xs font-mono text-dim">{agent.status}</span>
                <span className="text-dim">·</span>
                <span className="text-xs font-mono text-dim">注册于 {fmtTime(agent.createdAt)}</span>
              </div>
              {(agent.capabilities ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(agent.capabilities ?? []).map((c) => (
                    <span
                      key={c}
                      className="text-xs rounded-full border border-edge px-2.5 py-0.5 text-dim font-mono"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <GradeBadge score={score?.score ?? null} size="lg" />
          </div>

          {/* 分数卡 */}
          <div className="mt-6 rounded-xl border border-edge bg-surface p-6">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-dim text-xs font-mono uppercase tracking-wider mb-2">
                  Credit Score
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`font-mono text-6xl font-700 score-glow ${scoreTone(score?.score ?? null)}`}>
                    {score?.score ?? '—'}
                  </span>
                  <span className="text-dim text-sm font-mono">/1000</span>
                </div>
                {score?.score === null && (
                  <div className="text-dim text-xs font-mono mt-1">unverified（无证据）</div>
                )}
              </div>
              <div className="ml-auto flex flex-col items-center gap-1">
                <ScoreRing confidence={score?.confidence ?? 0} />
                <span className="text-dim text-[11px] font-mono">confidence</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-edge">
              {[
                ['Adjusted', score?.adjustedScore ?? null, ''],
                ['Coverage', score ? `${Math.round(score.coverage * 100)}%` : '—', ''],
                ['Freshness', score?.freshnessDays != null ? `${score.freshnessDays}d` : '—', ''],
                ['Evidence', score?.evidenceCount ?? 0, ''],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <div className="text-dim text-[11px] font-mono uppercase tracking-wider">{label}</div>
                  <div className="text-bright font-mono text-lg mt-1">{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 维度分解 */}
          <div className="mt-6 rounded-xl border border-edge bg-surface p-6">
            <h3 className="font-display text-sm font-600 text-bright mb-1">维度分解</h3>
            <p className="text-dim text-[11px] leading-relaxed mb-4">
              只计入有证据的维度——"—" = 暂无证据，不虚高分。可靠性/交付/经济/协作/安全由 Arena 行为评测产生，谈判由考场谈判题产生（Phase 2 后补全）。COVERAGE = 已覆盖维度的权重占比。
            </p>
            <div className="space-y-3">
              {dims.map((d) => (
                <div key={d.dimension} className="flex items-center gap-3">
                  <div className="w-20 shrink-0 text-xs text-dim">
                    {DIMENSION_LABELS[d.dimension] ?? d.dimension}
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-abyss overflow-hidden">
                    {d.score !== null ? (
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${d.score}%`,
                          background: d.score >= 70 ? '#34D399' : d.score >= 40 ? '#F4A261' : '#F87171',
                        }}
                      />
                    ) : (
                      <div
                        className="h-full w-full"
                        style={{
                          background:
                            'repeating-linear-gradient(90deg,#1a2230 0 6px,#141a24 6px 12px)',
                        }}
                      />
                    )}
                  </div>
                  <div className="w-12 shrink-0 text-right font-mono text-sm text-bright">
                    {d.score !== null ? d.score : (
                      <span className="text-dim" title="暂无证据，不计入分数">—</span>
                    )}
                  </div>
                  <div className="w-10 shrink-0 text-right font-mono text-[11px] text-dim">w{d.weight}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence 时间线 */}
          <div className="mt-6 rounded-xl border border-edge bg-surface p-6">
            <h3 className="font-display text-sm font-600 text-bright mb-4">
              Evidence（{evidence.length}）
            </h3>
            {evidence.length === 0 ? (
              <p className="text-dim text-sm">暂无证据</p>
            ) : (
              <ol className="relative border-l border-edge ml-2 space-y-4">
                {[...evidence].reverse().map((e) => (
                  <li key={e.id} className="ml-4">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-edge" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-bright">
                        {DIMENSION_LABELS[e.dimension] ?? e.dimension}
                      </span>
                      <span className="text-xs font-mono text-dim">
                        {SOURCE_LABELS[e.source] ?? e.source}
                      </span>
                      <span
                        className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                          e.result === 'success'
                            ? 'text-accent bg-accent/10'
                            : e.result === 'failure'
                              ? 'text-danger bg-danger/10'
                              : 'text-amber bg-amber/10'
                        }`}
                      >
                        {RESULT_LABELS[e.result] ?? e.result}
                      </span>
                      <span className="text-[11px] font-mono text-dim ml-auto">{fmtTime(e.createdAt)}</span>
                    </div>
                    {e.evidenceUri && (
                      <div className="text-[11px] font-mono text-dim/70 mt-0.5">{e.evidenceUri}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* README Badge（增长飞轮） */}
          <div className="mt-6 rounded-xl border border-edge bg-surface p-5">
            <div className="text-xs font-mono uppercase tracking-wider text-dim mb-3">README Badge</div>
            <div className="flex items-center gap-3 mb-3">
              <img
                src={`/credit/api/badge/${agent.id}.svg`}
                alt="ACL badge"
                className="h-7"
                onError={(ev) => {
                  (ev.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <span className="text-[11px] font-mono text-dim">← 实时生成，分数更新自动同步</span>
            </div>
            <div className="overflow-x-auto rounded-lg bg-abyss border border-edge p-3 font-mono text-xs text-accent/90">
              {[`[![ACL](https://reeftavern.cc/credit/api/badge/${agent.id}.svg)](https://reeftavern.cc/credit)`]}
            </div>
            <p className="mt-2 text-[11px] font-mono text-dim">复制到 README，把你的信用分挂到全世界面前。</p>
          </div>
        </>
      )}
    </main>
  );
}
