'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, GITHUB_URL, type Evidence, type LeaderboardEntry, type StatsResponse } from '@/lib/api';
import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { Quickstart } from '@/components/Quickstart';
import { Leaderboard } from '@/components/Leaderboard';
import { Ticker } from '@/components/Ticker';
import { AgentDetail } from '@/components/AgentDetail';

export default function Page() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [events, setEvents] = useState<Evidence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, lb, ev] = await Promise.all([api.stats(), api.leaderboard(), api.events()]);
      setStats(s);
      setEntries(lb);
      setEvents(ev);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries) m[e.agentId] = e.name;
    return m;
  }, [entries]);

  const createAgent = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const agent = await api.createAgent(newName.trim());
      setNewName('');
      await refresh();
      setSelectedId(agent.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scrollToLeaderboard = () => {
    document.getElementById('leaderboard')?.scrollIntoView({ behavior: 'smooth' });
  };

  const onBack = useCallback(() => {
    setSelectedId(null);
    refresh();
  }, [refresh]);

  return (
    <div className="min-h-screen flex flex-col bg-abyss">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-edge bg-abyss/80 backdrop-blur px-6 py-3.5 flex items-center justify-between">
        <button
          onClick={() => selectedId && onBack()}
          className="flex items-center gap-2.5 text-left"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 font-mono text-sm font-700 text-accent">
            A
          </span>
          <span className="font-display text-base font-700 tracking-tight text-bright">
            Agent Credit Lab
          </span>
        </button>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11px] font-mono text-dim sm:inline">
            Don&apos;t trust an Agent. Test it.
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs font-mono text-dim transition hover:border-accent/40 hover:text-bright"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Star
          </a>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-danger text-sm">
          {error}
        </div>
      )}

      {selectedId ? (
        <AgentDetail agentId={selectedId} onBack={onBack} />
      ) : (
        <>
          <Hero stats={stats} onTestAgent={scrollToLeaderboard} />
          <HowItWorks />
          <Quickstart />
          <Leaderboard
            entries={entries}
            onSelect={setSelectedId}
            newName={newName}
            setNewName={setNewName}
            onCreate={createAgent}
            busy={busy}
          />
          <Ticker events={events} nameMap={nameMap} />
        </>
      )}

      {/* 页脚 */}
      <footer className="mt-auto border-t border-edge px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-mono text-dim">
            Agent Credit Lab · baseline-v0.1 · Don&apos;t trust an Agent. Test it.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-accent/70 hover:text-accent"
          >
            github.com/agent-credit-lab
          </a>
        </div>
      </footer>
    </div>
  );
}
