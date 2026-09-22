'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type Evidence,
  type LeaderboardEntry,
  type StatsResponse,
  type StatsSummary,
} from '@/lib/api';
import { useLocale, useT, mapApiError } from '@/lib/i18n';
import { DIMENSIONS } from '@a2t/core';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { FeedbackBubble } from '@/components/FeedbackBubble';
import { Hero } from '@/components/Hero';
import { CounterpartTheory } from '@/components/CounterpartTheory';
import { HowItWorks } from '@/components/HowItWorks';
import { Quickstart } from '@/components/Quickstart';
import { OneMoreThing } from '@/components/OneMoreThing';
import { JevCrosscheck } from '@/components/JevCrosscheck';
import { Leaderboard } from '@/components/Leaderboard';
import { Ticker } from '@/components/Ticker';
import { AgentDetail } from '@/components/AgentDetail';

// 详情页 URL 化（0907 批次2）：?agent=<id> 驱动，可直接分享/刷新/后退。
// 不走 next/navigation（避免 useSearchParams 的 Suspense CSR-bailout 约束），
// 用 history API + popstate 手动同步——单页结构下最轻。
function readAgentParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('agent');
}

// 榜单 URL 化：?board= & ?dims=a,b（可分享/刷新/后退）。
function readBoardParam(): 'capability' | 'behavior' {
  if (typeof window === 'undefined') return 'capability';
  return new URLSearchParams(window.location.search).get('board') === 'behavior'
    ? 'behavior'
    : 'capability';
}

function readDimsParam(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = new URLSearchParams(window.location.search).get('dims');
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => (DIMENSIONS as string[]).includes(s));
}

function writeListParams(board: 'capability' | 'behavior', dims: string[]) {
  const url = new URL(window.location.href);
  if (board === 'capability') url.searchParams.delete('board');
  else url.searchParams.set('board', board);
  if (dims.length === 0) url.searchParams.delete('dims');
  else url.searchParams.set('dims', dims.join(','));
  window.history.pushState({}, '', url);
}

export default function Page() {
  const t = useT();
  const { locale } = useLocale();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [events, setEvents] = useState<Evidence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<'capability' | 'behavior'>('capability');
  const [dims, setDims] = useState<string[]>([]);
  const [mode, setMode] = useState<'scripted' | 'live' | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, lb, ev, sum] = await Promise.all([
        api.stats(),
        api.leaderboard(board, dims, mode),
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
  }, [board, dims, mode, locale, t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 挂载后读一次 URL（SSR 首帧保持默认榜单渲染，无 hydration mismatch）；
  // 浏览器前进/后退经 popstate 同步详情↔榜单与筛选态。
  useEffect(() => {
    const id = readAgentParam();
    if (id) setSelectedId(id);
    setBoard(readBoardParam());
    setDims(readDimsParam());
    const sync = () => {
      setSelectedId(readAgentParam());
      setBoard(readBoardParam());
      setDims(readDimsParam());
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const changeBoard = useCallback((b: 'capability' | 'behavior') => {
    setBoard(b);
    writeListParams(b, dims);
  }, [dims]);

  const changeDims = useCallback((d: string[]) => {
    setDims(d);
    writeListParams(board, d);
  }, [board]);

  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries) m[e.agentId] = e.name;
    return m;
  }, [entries]);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const onBack = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('agent');
    window.history.pushState({}, '', url);
    setSelectedId(null);
    refresh();
  }, [refresh]);

  // 导航锚点：详情态先回榜单，等下一帧 DOM 就绪再滚动
  const onAnchor = useCallback(
    (id: string) => {
      if (selectedId) {
        onBack();
        window.setTimeout(() => scrollTo(id), 60);
      } else {
        scrollTo(id);
      }
    },
    [selectedId, onBack, scrollTo],
  );

  const onSelectAgent = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('agent', id);
    window.history.pushState({}, '', url);
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <SiteHeader onAnchor={onAnchor} />

      <main id="main" className="flex-1">
        {error && (
          <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-6">
            <div className="animate-fade-in rounded-xl border border-seal/30 bg-seal/5 px-4 py-2.5 font-mono text-sm text-seal">
              {error}
            </div>
          </div>
        )}

        {selectedId ? (
          <AgentDetail agentId={selectedId} onBack={onBack} />
        ) : (
          <>
            <Hero
              stats={stats}
              summary={summary}
              onTestAgent={() => scrollTo('quickstart')}
              onViewBoard={() => scrollTo('leaderboard')}
            />
            <Ticker events={events} nameMap={nameMap} />
            <Leaderboard
              entries={entries}
              onSelect={onSelectAgent}
              board={board}
              setBoard={changeBoard}
              summary={summary}
              dims={dims}
              setDims={changeDims}
              mode={mode}
              setMode={setMode}
            />
            <HowItWorks />
            <CounterpartTheory variant="card" />
            <JevCrosscheck />
            <Quickstart />
            <OneMoreThing />
          </>
        )}
      </main>

      {/* 反馈入口（隐蔽）：右下角小气泡 */}
      <FeedbackBubble />

      <SiteFooter />
    </div>
  );
}
