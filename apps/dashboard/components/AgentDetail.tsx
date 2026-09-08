'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Agent,
  type Evidence,
  type ScoreResponse,
} from '@/lib/api';
import { useLocale, useT, fill, mapApiError } from '@/lib/i18n';
import { ScoreSeal } from './ScoreSeal';

function fmtTime(iso: string, locale: 'en' | 'zh'): string {
  const d = new Date(iso);
  return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="border border-hairline bg-paper p-6">
      <h3 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-ink">{title}</h3>
      {note && <p className="mt-1 font-mono text-[11px] leading-relaxed text-dim">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

const RESULT_TAG: Record<string, string> = {
  success: 'text-ledger border-ledger',
  failure: 'text-seal border-seal',
  partial: 'text-amber border-amber',
};

export function AgentDetail({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // T6 榜单展示开关：本地状态 + 乐观更新（失败回滚）
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilitySaved, setVisibilitySaved] = useState(false);
  const [visibilityError, setVisibilityError] = useState(false);

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
      const msg = (e as Error).message;
      setError(locale === 'zh' ? msg : mapApiError(msg, t.apiError));
    } finally {
      setBusy(false);
    }
  }, [agentId, locale, t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleVisibility = useCallback(async () => {
    if (!agent || visibilityBusy) return;
    const next = !agent.leaderboardVisible;
    setVisibilityBusy(true);
    setVisibilitySaved(false);
    setVisibilityError(false);
    setAgent({ ...agent, leaderboardVisible: next }); // 乐观更新
    try {
      const updated = await api.updateAgentVisibility(agent.id, next);
      setAgent(updated);
      setVisibilitySaved(true);
      setTimeout(() => setVisibilitySaved(false), 2000);
    } catch {
      setAgent({ ...agent, leaderboardVisible: !next }); // 回滚
      setVisibilityError(true);
      setTimeout(() => setVisibilityError(false), 3000);
    } finally {
      setVisibilityBusy(false);
    }
  }, [agent, visibilityBusy]);

  const dims = score?.dimensions ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <button
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 font-mono text-sm text-dim transition hover:text-ink"
      >
        {t.detail.back}
      </button>

      {error && (
        <div className="mb-4 border border-seal/50 bg-seal/10 px-4 py-2 font-mono text-sm text-seal">
          {error}
        </div>
      )}

      {!agent ? (
        <div className="py-16 text-center text-sm text-dim">
          {busy ? t.detail.loading : t.detail.notFound}
        </div>
      ) : (
        <>
          {/* 卷宗头部：名字 + 大印章 */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
                {fill(t.detail.fileNo, { id: agent.id.slice(0, 8) })}
              </p>
              <h2 className="mt-2 font-display text-3xl font-black tracking-tight">{agent.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-dim">
                <span className="uppercase tracking-wider">{agent.verificationLevel}</span>
                <span>·</span>
                <span>{agent.status}</span>
                <span>·</span>
                <span>{fill(t.detail.registered, { t: fmtTime(agent.createdAt, locale) })}</span>
              </div>
              {(agent.capabilities ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(agent.capabilities ?? []).map((c) => (
                    <span
                      key={c}
                      className="border border-hairline px-2.5 py-0.5 font-mono text-xs text-dim"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <ScoreSeal
              score={score?.score ?? null}
              tested={score?.score != null}
              rank={1}
              size={104}
            />
          </div>

          {/* 评级摘要 */}
          <div className="mt-6">
            <Panel title={t.detail.ratingSummary}>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-6xl font-semibold text-ink tabular-nums">
                  {score?.score ?? '—'}
                </span>
                <span className="font-mono text-sm text-dim">/1000</span>
                {score?.score === null && (
                  <span className="font-mono text-xs text-dim">{t.detail.unverified}</span>
                )}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-hairline pt-4 sm:grid-cols-4">
                {[
                  ['Adjusted', score?.adjustedScore ?? null],
                  ['Coverage', score ? `${Math.round(score.coverage * 100)}%` : '—'],
                  ['Freshness', score?.freshnessDays != null ? `${score.freshnessDays}d` : '—'],
                  ['Evidence', score?.evidenceCount ?? 0],
                ].map(([label, val]) => (
                  <div key={label as string}>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
                      {label}
                    </div>
                    <div className="mt-1 font-mono text-lg text-ink tabular-nums">{val}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* T6 榜单展示开关（设计冻结条款 5：注册后可改；opt-out 直链保留） */}
          <div className="mt-4">
            <Panel title={t.detail.visibilityTitle} note={t.detail.visibilityDesc}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span
                    className={`font-mono text-sm font-bold ${
                      agent.leaderboardVisible ? 'text-ledger' : 'text-seal'
                    }`}
                  >
                    {agent.leaderboardVisible ? t.detail.visibilityOn : t.detail.visibilityOff}
                  </span>
                  {visibilitySaved && (
                    <span className="ml-2 font-mono text-[11px] text-dim">{t.detail.visibilitySaved}</span>
                  )}
                  {visibilityError && (
                    <span className="ml-2 font-mono text-[11px] text-seal">{t.detail.visibilitySaveFailed}</span>
                  )}
                </div>
                <button
                  onClick={toggleVisibility}
                  disabled={visibilityBusy}
                  aria-pressed={agent.leaderboardVisible}
                  role="switch"
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
                    agent.leaderboardVisible
                      ? 'border-ledger bg-ledger/25'
                      : 'border-hairline bg-panel'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                      agent.leaderboardVisible ? 'left-[1.5rem] bg-ledger' : 'left-0.5 bg-dim'
                    }`}
                  />
                </button>
              </div>
            </Panel>
          </div>

          {/* 维度分解 */}
          <div className="mt-4">
            <Panel title={t.detail.dimensions} note={t.detail.dimsNote}>
              <div className="space-y-3">
                {dims.map((d) => (
                  <div key={d.dimension} className="flex items-center gap-3">
                    <div className="w-20 shrink-0 font-mono text-xs text-dim">
                      {t.dimensions[d.dimension] ?? d.dimension}
                    </div>
                    <div className="h-2.5 flex-1 bg-panel">
                      {d.score !== null ? (
                        <div
                          className="h-full bg-ledger"
                          style={{ width: `${d.score}%` }}
                        />
                      ) : (
                        <div
                          className="h-full w-full"
                          style={{
                            background:
                              'repeating-linear-gradient(90deg,#D8CEBC 0 5px,#F2ECDF 5px 10px)',
                          }}
                        />
                      )}
                    </div>
                    <div className="w-12 shrink-0 text-right font-mono text-sm text-ink tabular-nums">
                      {d.score !== null ? (
                        d.score
                      ) : (
                        <span className="text-dim" title={t.detail.noEvidenceDim}>—</span>
                      )}
                    </div>
                    <div className="w-10 shrink-0 text-right font-mono text-[11px] text-dim">
                      w{d.weight}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* 证据链 */}
          <div className="mt-4">
            <Panel title={fill(t.detail.evidenceChain, { n: evidence.length })}>
              {evidence.length === 0 ? (
                <p className="text-sm text-dim">{t.detail.noEvidence}</p>
              ) : (
                <ol className="relative ml-2 space-y-4 border-l border-hairline">
                  {[...evidence].reverse().map((e) => (
                    <li key={e.id} className="ml-4">
                      <span className="absolute -left-[4.5px] mt-1.5 h-2 w-2 bg-ink" />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-ink">
                          {t.dimensions[e.dimension] ?? e.dimension}
                        </span>
                        <span className="font-mono text-xs text-dim">
                          {t.sources[e.source] ?? e.source}
                        </span>
                        <span
                          className={`border px-1.5 py-0.5 font-mono text-xs ${
                            RESULT_TAG[e.result] ?? 'text-dim border-hairline'
                          }`}
                        >
                          {e.result === 'success' ? '✓' : e.result === 'failure' ? '✗' : '◐'}{' '}
                          {t.results[e.result] ?? e.result}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-dim">
                          {fmtTime(e.createdAt, locale)}
                        </span>
                      </div>
                      {e.evidenceUri && (
                        <div className="mt-0.5 font-mono text-[11px] text-dim">{e.evidenceUri}</div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          {/* README Badge（增长飞轮） */}
          <div className="mt-4">
            <Panel title="README Badge">
              <div className="mb-3 flex items-center gap-3">
                <img
                  src={`/credit/api/badge/${agent.id}.svg`}
                  alt="ACL badge"
                  className="h-7"
                  onError={(ev) => {
                    (ev.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <span className="font-mono text-[11px] text-dim">{t.detail.badgeSync}</span>
              </div>
              <div className="overflow-x-auto border border-hairline bg-panel p-3 font-mono text-xs text-ink">
                {`[![ACL](https://reeftavern.cc/credit/api/badge/${agent.id}.svg)](https://reeftavern.cc/credit)`}
              </div>
              <p className="mt-2 font-mono text-[11px] text-dim">{t.detail.badgeCopy}</p>
            </Panel>
          </div>

          {/* Market / 市场（引流三刀：档案 → Reef Tavern 挂牌入口） */}
          <div className="mt-4">
            <Panel title={t.detail.marketTitle}>
              <p className="text-sm leading-relaxed text-dim">{t.detail.marketDesc}</p>
              <div className="mt-4">
                <a
                  href="https://reeftavern.cc/market"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center bg-ledger px-5 py-2.5 text-sm font-bold text-paper transition hover:bg-[#9A3412]"
                >
                  {t.detail.marketCta}
                </a>
              </div>
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
