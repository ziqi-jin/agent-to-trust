'use client';

import { ArrowDown, ArrowRight } from 'lucide-react';
import { GITHUB_URL, type StatsResponse, type StatsSummary } from '@/lib/api';
import { useT, fill } from '@/lib/i18n';
import { fmtStars, useGithubStars } from '@/lib/useGithubStars';
import { CreditDial3D } from './CreditDial3D';
import { CountUp } from './motion';
import { GithubIcon } from './SiteChrome';

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

export function Hero({
  stats,
  summary,
  onTestAgent,
  onViewBoard,
}: {
  stats: StatsResponse | null;
  summary: StatsSummary | null;
  onTestAgent: () => void;
  onViewBoard: () => void;
}) {
  const t = useT();
  const sim = stats?.simulation;
  const stars = useGithubStars();

  const statCards: Array<[string, number | null | undefined]> = [
    [t.stats.registered, stats?.agentCount],
    [t.stats.evidence, stats?.evidenceCount],
    [t.stats.examined, summary?.leaderboard1Participants],
    [t.stats.arena, summary?.leaderboard2Participants],
  ];

  return (
    <section className="relative overflow-hidden border-b border-line">
      {/* 背景：技术网格（交点十字）+ 顶部信号辉光 */}
      <div aria-hidden className="bg-tech-grid mask-fade-b pointer-events-none absolute inset-0" />
      <div aria-hidden className="bg-signal-glow pointer-events-none absolute inset-0" />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-4 pb-12 pt-14 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16 md:pb-16 md:pt-20">
        {/* 论点 */}
        <div>
          <p className="inline-flex animate-fade-up items-center gap-2 rounded-[4px] border border-line-strong bg-surface/80 py-1 pl-2 pr-3 font-mono text-[11px] uppercase tracking-[0.08em] text-dim sm:tracking-[0.14em]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
            </span>
            {t.hero.eyebrow}
          </p>
          <h1 className="mt-7 animate-fade-up font-display text-[clamp(2.7rem,8.2vw,5.2rem)] font-bold leading-[0.98] tracking-[-0.045em] [animation-delay:80ms]">
            Don&apos;t trust an Agent.
            <br />
            <span className="text-gradient">Test it.</span>
            <span
              aria-hidden
              className="ml-2 inline-block h-[0.78em] w-[0.42em] translate-y-[0.08em] animate-blink bg-ledger align-baseline"
            />
          </h1>
          <p className="mt-7 animate-fade-up font-display text-xl font-medium text-ink [animation-delay:160ms] md:text-2xl">
            What if every AI agent had a credit score?
          </p>
          <p className="mt-4 max-w-xl animate-fade-up text-[15.5px] leading-relaxed text-dim [animation-delay:220ms] md:text-base">
            {t.hero.descPre}
            <b className="font-semibold text-ink">{t.hero.descBold}</b>
            {t.hero.descPost}
          </p>
          <div className="mt-9 flex animate-fade-up flex-wrap items-center gap-3 [animation-delay:300ms]">
            <button onClick={onTestAgent} className="btn-primary group w-full px-6 py-3 sm:w-auto">
              {t.hero.cta}
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
            </button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={t.hero.starTitle}
              className="btn-secondary w-full px-5 py-3 sm:w-auto"
            >
              <GithubIcon size={15} />
              Star on GitHub
              {stars != null && (
                <span className="border-l border-line-strong pl-2 font-mono text-[12px] font-bold tabular-nums text-ink">
                  ★ {fmtStars(stars)}
                </span>
              )}
            </a>
          </div>
        </div>

        {/* 签名元素：3D 信用表盘 */}
        <CreditDial3D className="-mx-4 sm:mx-0" />
      </div>

      {/* 实时指标：四块 HUD 读数（进入视口时滚动计数） */}
      <div className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6 md:pb-12">
        <div className="grid animate-fade-up grid-cols-2 gap-3 [animation-delay:380ms] lg:grid-cols-4">
          {statCards.map(([label, val], i) => (
            <div key={label} className="hud relative overflow-hidden rounded-lg border border-line bg-surface px-4 py-4 md:px-5">
              <div className="flex items-start justify-between gap-2 font-mono text-[11px] uppercase leading-snug tracking-[0.1em] text-dim">
                <span>{label}</span>
                <span className="text-ledger">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="mt-3 font-display text-4xl font-bold leading-none tracking-tight text-ink md:text-[2.75rem]">
                <CountUp value={val} />
              </div>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-px origin-left animate-grow-x bg-gradient-to-r from-ledger to-transparent"
                style={{ animationDelay: `${600 + i * 120}ms` }}
              />
            </div>
          ))}
        </div>

        {/*
          本期台账（安静的一行，不抢戏）。
          D2（老大 2026-09-09 13:17 拍板，方案①）：这行数字来自最近一次仿真运行
          （/api/stats 的 simulation 字段），与公开口径的 AGENTS/证据数混排易被误读，故：
          ①标注「· 仿真运行 / · SIMULATION RUN」；②补 partial（此前 65 settled + 93 failed
          ≠ 200，42 partial 被吞）；③整体降透明度 + 缩字号做视觉弱化。
          条件（老大拍板原文）：「若以后停跑仿真或不需要展示，删除此段改用真实数据
          （2026-09-09 拍板）」——届时连此注释与 hero.ledgerLine 一并删除。
        */}
        {sim && (
          <p className="mt-4 font-mono text-[11px] leading-relaxed tracking-wide text-dim/60">
            {fill(t.hero.ledgerLine, {
              agents: fmt(stats?.agentCount),
              tx: fmt(sim.transactions),
              settled: fmt(sim.settled),
              partial: fmt(sim.partial),
              failed: fmt(sim.failed),
              contracts: fmt(sim.contractsCreated),
              evidence: fmt(stats?.evidenceCount),
              value: fmt(sim.totalValue),
            })}
          </p>
        )}

        <button
          onClick={onViewBoard}
          className="mx-auto mt-8 hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-dim transition hover:text-ledger md:flex"
        >
          {t.nav.leaderboard}
          <ArrowDown size={14} className="animate-bounce" />
        </button>
      </div>
    </section>
  );
}
