'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  badgeMarkdown,
  badgeSvgUrl,
  reportPath,
  PUBLIC_SITE_URL,
  type Agent,
  type Evidence,
  type ScoreResponse,
} from '@/lib/api';
import { useLocale, useT, fill, mapApiError } from '@/lib/i18n';
import { ArrowLeft, ArrowUpRight, CalendarDays, Eye, EyeOff, Link2, ShieldCheck } from 'lucide-react';
import { MedalBar } from './MedalBar';
import { ScoreSeal } from './ScoreSeal';
import { CopyButton } from './CopyButton';
import { CountUp } from './motion';
import { AgentMark } from './fx/AgentMark';

function fmtTime(iso: string, locale: 'en' | 'zh'): string {
  const d = new Date(iso);
  return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Panel({
  title,
  children,
  note,
  delay = 0,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
  delay?: number;
}) {
  return (
    <div className="card animate-fade-up p-5 md:p-6" style={{ animationDelay: `${delay}ms` }}>
      <h3 className="flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">
        <span className="h-3 w-1 bg-ledger" />
        {title}
        <span className="h-px flex-1 bg-line" />
      </h3>
      {note && <p className="mt-1.5 text-[12px] leading-relaxed text-dim">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** 维度分数条色阶：高分橙、中分琥珀、低分印泥红。 */
function barTone(score: number): string {
  if (score >= 70) return 'from-ledger/80 to-ledger';
  if (score >= 40) return 'from-amber/70 to-amber';
  return 'from-seal/60 to-seal';
}

const RESULT_TAG: Record<string, string> = {
  success: 'bg-info/10 text-info',
  failure: 'bg-seal/10 text-seal',
  partial: 'bg-amber/10 text-amber',
};

const RESULT_DOT: Record<string, string> = {
  success: 'bg-info',
  failure: 'bg-seal',
  partial: 'bg-amber',
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
  const reportUrl = agent ? `${PUBLIC_SITE_URL}${reportPath(agent.name)}` : '';

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <button onClick={onBack} className="btn-ghost group -ml-3 mb-6 px-3 py-1.5 font-mono text-[13px]">
        <ArrowLeft size={15} className="transition-transform duration-300 group-hover:-translate-x-1" />
        {t.detail.back.replace(/^←\s*/, '')}
      </button>

      {error && (
        <div className="mb-4 rounded-xl border border-seal/30 bg-seal/5 px-4 py-2.5 font-mono text-sm text-seal">
          {error}
        </div>
      )}

      {!agent ? (
        busy ? (
          /* 骨架屏：比一行「加载中」更稳的等待态 */
          <div className="space-y-4" aria-busy="true" aria-label={t.detail.loading}>
            <div className="card h-48 animate-pulse bg-gradient-to-r from-surface via-panel/60 to-surface" />
            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="card h-72 animate-pulse" />
              <div className="card h-72 animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="card py-20 text-center">
            <p className="font-display text-lg font-bold text-ink">{t.detail.notFound}</p>
          </div>
        )
      ) : (
        <>
          {/* 卷宗头部：名字 + 大印章 */}
          <div className="relative animate-fade-up overflow-hidden rounded-lg border border-line-strong bg-surface shadow-lift">
            <div aria-hidden className="bg-tech-grid mask-fade-b pointer-events-none absolute inset-0" />
            <div className="relative flex flex-col-reverse gap-6 p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ledger">
                  {fill(t.detail.fileNo, { id: agent.id.slice(0, 8) })}
                </p>
                <h1 className="mt-3 flex items-center gap-3 font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] sm:gap-4 sm:text-5xl md:text-6xl">
                  <span className="grid shrink-0 place-items-center rounded-lg border border-line-strong bg-night p-1.5 shadow-glow-sm">
                    <AgentMark seed={agent.name} size={52} verified={agent.verificationLevel === 'verified'} />
                  </span>
                  <span className="min-w-0 break-words">{agent.name}</span>
                </h1>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span
                    className={`chip px-2.5 py-1 uppercase tracking-wider ${
                      agent.verificationLevel === 'verified'
                        ? 'border-brass bg-brass text-paper'
                        : 'border-hairline bg-surface text-dim'
                    }`}
                  >
                    <ShieldCheck size={11} />
                    {agent.verificationLevel}
                  </span>
                  <span className="chip border-hairline bg-surface px-2.5 py-1 text-dim">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${agent.status === 'active' ? 'bg-info' : 'bg-dim/50'}`}
                    />
                    {agent.status}
                  </span>
                  <span className="chip border-hairline bg-surface px-2.5 py-1 text-dim">
                    <CalendarDays size={11} />
                    {fill(t.detail.registered, { t: fmtTime(agent.createdAt, locale) })}
                  </span>
                </div>
                {(agent.capabilities ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(agent.capabilities ?? []).map((c) => (
                      <span key={c} className="rounded-md bg-panel px-2 py-0.5 font-mono text-[11px] text-dim">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative shrink-0 self-start sm:self-center">
                <div aria-hidden className="absolute inset-2 rounded-full bg-surface" />
                <div className="relative">
                  <ScoreSeal score={score?.score ?? null} tested={score?.score != null} rank={1} size={128} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* 左列：评级 → 维度 → 证据链 */}
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title={t.detail.ratingSummary} delay={80}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-display text-7xl font-semibold tracking-[-0.03em] text-ink">
                    {score?.score != null ? <CountUp value={score.score} /> : '—'}
                  </span>
                  <span className="font-mono text-sm text-dim">/1000</span>
                  {score?.score === null && (
                    <span className="font-mono text-xs text-dim">{t.detail.unverified}</span>
                  )}
                </div>
                {/* 分数进度：0–1000 刻度 */}
                <div className="mt-4 h-2.5 overflow-hidden border border-line bg-surface">
                  <div
                    className="h-full origin-left animate-grow-x bg-ledger"
                    style={{ width: `${Math.max(0, Math.min(100, (score?.score ?? 0) / 10))}%` }}
                  />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    [t.detail.statAdjusted, score?.adjustedScore ?? '—'],
                    [t.detail.statCoverage, score ? `${Math.round(score.coverage * 100)}%` : '—'],
                    [t.detail.statFreshness, score?.freshnessDays != null ? `${score.freshnessDays}d` : '—'],
                    [t.detail.statEvidence, score?.evidenceCount ?? 0],
                  ].map(([label, val]) => (
                    <div key={label as string} className="border-l-2 border-ledger bg-paper px-3.5 py-3">
                      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{label}</div>
                      <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">{val}</div>
                    </div>
                  ))}
                </div>
                {/* 维度勋章（2026-09-13）：与榜单行同口径，服务端权威派生 */}
                <div className="mt-5 border-t border-hairline pt-4">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">{t.medal.title}</div>
                  <MedalBar badges={score?.badges ?? []} size={26} className="mt-2.5 gap-1.5" />
                  <p className="mt-2.5 font-mono text-[11px] leading-relaxed text-dim">{t.medal.legend}</p>
                </div>
              </Panel>

              {/* 维度分解 */}
              <Panel title={t.detail.dimensions} note={t.detail.dimsNote} delay={140}>
                <div className="space-y-3.5">
                  {dims.map((d, i) => (
                    <div key={d.dimension} className="grid grid-cols-[6.5rem_1fr_2.5rem_2.5rem] items-center gap-3">
                      <div className="truncate text-[13px] font-medium text-ink">
                        {t.dimensions[d.dimension] ?? d.dimension}
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-panel">
                        {d.score !== null ? (
                          <div
                            className={`h-full origin-left animate-grow-x rounded-full bg-gradient-to-r ${barTone(d.score)}`}
                            style={{ width: `${d.score}%`, animationDelay: `${200 + i * 70}ms` }}
                          />
                        ) : (
                          <div
                            className="h-full w-full opacity-70"
                            style={{
                              background: 'repeating-linear-gradient(135deg,#2A2A30 0 4px,transparent 4px 8px)',
                            }}
                          />
                        )}
                      </div>
                      <div className="text-right font-mono text-sm font-semibold tabular-nums text-ink">
                        {d.score !== null ? (
                          d.score
                        ) : (
                          <span className="text-dim" title={t.detail.noEvidenceDim}>
                            —
                          </span>
                        )}
                      </div>
                      <div className="text-right font-mono text-[11px] text-dim">w{d.weight}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* 证据链 */}
              <Panel title={fill(t.detail.evidenceChain, { n: evidence.length })} delay={200}>
                {evidence.length === 0 ? (
                  <p className="text-sm text-dim">{t.detail.noEvidence}</p>
                ) : (
                  <div className="-ml-1 max-h-[34rem] overflow-y-auto pl-2 pr-1">
                  <ol className="relative ml-1.5 space-y-1 border-l border-hairline">
                    {[...evidence].reverse().map((e) => (
                      <li key={e.id} className="relative ml-5 rounded-md px-3 py-2.5 transition-colors hover:bg-panel">
                        <span
                          className={`absolute -left-[1.6rem] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${
                            RESULT_DOT[e.result] ?? 'bg-dim'
                          }`}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-ink">
                            {t.dimensions[e.dimension] ?? e.dimension}
                          </span>
                          <span className="font-mono text-[11px] text-dim">{t.sources[e.source] ?? e.source}</span>
                          <span
                            className={`rounded-[3px] px-2 py-0.5 font-mono text-[11px] ${
                              RESULT_TAG[e.result] ?? 'bg-panel text-dim'
                            }`}
                          >
                            {e.result === 'success' ? '✓' : e.result === 'failure' ? '✗' : '◐'}{' '}
                            {t.results[e.result] ?? e.result}
                          </span>
                          <span className="ml-auto font-mono text-[11px] tabular-nums text-dim">
                            {fmtTime(e.createdAt, locale)}
                          </span>
                        </div>
                        {e.evidenceUri && (
                          <div className="mt-1 break-all font-mono text-[11px] text-dim">{e.evidenceUri}</div>
                        )}
                      </li>
                    ))}
                  </ol>
                  </div>
                )}
              </Panel>
            </div>

            {/* 右列：展示开关 / 分享 / 徽章 / 市场 */}
            <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
              {/* T6 榜单展示开关（设计冻结条款 5：注册后可改；opt-out 直链保留） */}
              <Panel title={t.detail.visibilityTitle} note={t.detail.visibilityDesc} delay={120}>
                <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-night px-4 py-3">
                  <div className="flex items-center gap-2">
                    {agent.leaderboardVisible ? (
                      <Eye size={16} className="text-ledger" />
                    ) : (
                      <EyeOff size={16} className="text-seal" />
                    )}
                    <span
                      className={`text-sm font-semibold ${agent.leaderboardVisible ? 'text-ledger' : 'text-seal'}`}
                    >
                      {agent.leaderboardVisible ? t.detail.visibilityOn : t.detail.visibilityOff}
                    </span>
                    {visibilitySaved && (
                      <span className="animate-fade-in font-mono text-[11px] text-info">{t.detail.visibilitySaved}</span>
                    )}
                    {visibilityError && (
                      <span className="animate-fade-in font-mono text-[11px] text-seal">
                        {t.detail.visibilitySaveFailed}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={toggleVisibility}
                    disabled={visibilityBusy}
                    aria-pressed={agent.leaderboardVisible}
                    role="switch"
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300 disabled:opacity-50 ${
                      agent.leaderboardVisible ? 'bg-ledger' : 'bg-hairline'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all duration-300 ease-out-expo ${
                        agent.leaderboardVisible ? 'left-[1.375rem]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              </Panel>

              {/* 公开档案链接（分享用：可直接贴进 README / issue / 微信群） */}
              <Panel title={t.detail.reportTitle} note={t.detail.reportDesc} delay={180}>
                <div className="relative">
                  <div className="flex items-start gap-2 break-all rounded-md border border-line bg-night p-3 pr-20 font-mono text-xs text-ink">
                    <Link2 size={13} className="mt-0.5 shrink-0 text-dim" />
                    {reportUrl}
                  </div>
                  <CopyButton text={reportUrl} className="absolute right-2 top-2" />
                </div>
              </Panel>

              {/* README Badge（增长飞轮） */}
              <Panel title="README Badge" delay={240}>
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-night px-3 py-3">
                  <img
                    src={badgeSvgUrl(agent.id)}
                    alt="A2T badge"
                    className="h-6"
                    onError={(ev) => {
                      (ev.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <span className="font-mono text-[11px] text-dim">{t.detail.badgeSync}</span>
                </div>
                <div className="relative">
                  <div className="whitespace-pre-wrap break-all rounded-md border border-line bg-night p-3 pr-20 font-mono text-[11px] leading-relaxed text-ink">
                    {badgeMarkdown(agent)}
                  </div>
                  <CopyButton text={badgeMarkdown(agent)} className="absolute right-2 top-2" dark />
                </div>
                <p className="mt-2.5 text-[12px] leading-relaxed text-dim">{t.detail.badgeCopy}</p>
              </Panel>

              {/* Market / 市场（引流三刀：档案 → Reef Tavern 挂牌入口） */}
              <div
                className="hud relative animate-fade-up overflow-hidden rounded-lg border border-ledger/40 bg-surface p-6"
                style={{ animationDelay: '300ms' }}
              >
                <h3 className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ledger">
                  {t.detail.marketTitle}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-dim">{t.detail.marketDesc}</p>
                <a
                  href="https://reeftavern.cc/market"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary relative mt-5"
                >
                  {t.detail.marketCta.replace(/\s*↗\s*$/, '')}
                  <ArrowUpRight size={15} />
                </a>
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
