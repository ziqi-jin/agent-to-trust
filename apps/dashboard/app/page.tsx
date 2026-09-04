'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  GITHUB_URL,
  type Evidence,
  type LeaderboardEntry,
  type StatsResponse,
  type StatsSummary,
} from '@/lib/api';
import { useLocale, useT, mapApiError } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { FeedbackBubble } from '@/components/FeedbackBubble';
import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { Quickstart } from '@/components/Quickstart';
import { OneMoreThing } from '@/components/OneMoreThing';
import { Leaderboard } from '@/components/Leaderboard';
import { Ticker } from '@/components/Ticker';
import { AgentDetail } from '@/components/AgentDetail';

export default function Page() {
  const t = useT();
  const { locale } = useLocale();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [events, setEvents] = useState<Evidence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<'capability' | 'behavior'>('capability');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, lb, ev, sum] = await Promise.all([
        api.stats(),
        api.leaderboard(board),
        api.events(),
        api.statsSummary(),
      ]);
      setStats(s);
      setEntries(lb);
      setEvents(ev);
      setSummary(sum);
    } catch (e) {
      const msg = (e as Error).message;
      setError(locale === 'zh' ? msg : mapApiError(msg, t.apiError));
    }
  }, [board, locale, t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries) m[e.agentId] = e.name;
    return m;
  }, [entries]);

  const scrollToQuickstart = () => {
    document.getElementById('quickstart')?.scrollIntoView({ behavior: 'smooth' });
  };

  const onBack = useCallback(() => {
    setSelectedId(null);
    refresh();
  }, [refresh]);

  // 报头版本行：名册的期号 = 真实登记数据（结构即信息）
  const edition = [
    `VOL. 2026-09`,
    `${stats?.agentCount ?? '—'} REGISTERED`,
    `${summary?.leaderboard1Participants ?? '—'} EXAMINED`,
    `${summary?.leaderboard2Participants ?? '—'} ARENA-TESTED`,
    `SEED 42 · DETERMINISTIC`,
  ].join(' · ');

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      {/* 报头：账簿绿整块，公开名册的刊头 */}
      <header className="bg-ledger text-paper">
        <div className="mx-auto max-w-6xl px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-black uppercase tracking-[0.16em] md:text-2xl">
                Agent Credit Lab
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.24em] text-paper/70">
                {t.masthead.registerSub}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <a
                href="/playground"
                className="hidden border border-paper/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-paper transition hover:border-paper hover:bg-paper/10 sm:inline"
              >
                {t.masthead.playground}
              </a>
              <a
                href="#quickstart"
                className="hidden font-mono text-[11px] uppercase tracking-widest text-paper/80 transition hover:text-paper sm:inline"
              >
                Docs
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 border border-paper/40 px-3 py-1.5 font-mono text-xs text-paper transition hover:border-paper hover:bg-paper/10"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                Star
              </a>
            </div>
          </div>
          <p className="mt-3 border-t border-paper/25 pt-2 font-mono text-[10px] tracking-[0.14em] text-paper/75">
            {edition}
          </p>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 border border-seal/50 bg-seal/10 px-4 py-2 font-mono text-sm text-seal">
          {error}
        </div>
      )}

      {selectedId ? (
        <AgentDetail agentId={selectedId} onBack={onBack} />
      ) : (
        <>
          <Hero stats={stats} onTestAgent={scrollToQuickstart} />
          <Leaderboard
            entries={entries}
            onSelect={setSelectedId}
            board={board}
            setBoard={setBoard}
            summary={summary}
          />
          <Ticker events={events} nameMap={nameMap} />
          <HowItWorks />
          <Quickstart />
          <OneMoreThing />
        </>
      )}

      {/* 反馈入口（隐蔽）：右下角小气泡 */}
      <FeedbackBubble />

      {/* 页脚：双划线收底 */}
      <footer className="mt-auto border-t-[3px] border-double border-ink/70 px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-dim">
            {t.footer.register}
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-ledger underline-offset-4 hover:underline"
          >
            github.com/ziqi-jin/open-agent-credit-lab
          </a>
        </div>
      </footer>
    </div>
  );
}
