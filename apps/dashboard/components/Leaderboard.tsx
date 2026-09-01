'use client';

import type { LeaderboardEntry, StatsSummary } from '@/lib/api';
import { ScoreSeal } from './ScoreSeal';

function SourceTag({ source }: { source: LeaderboardEntry['source'] }) {
  if (source === 'real-benchmark') {
    return (
      <span className="shrink-0 border border-seal/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-seal">
        SDK 考场
      </span>
    );
  }
  if (source === 'benchmark') {
    return (
      <span className="shrink-0 border border-brass/70 px-1.5 py-0.5 font-mono text-[10px] text-brass">
        真实评测
      </span>
    );
  }
  if (source === 'simulation') {
    return (
      <span className="shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-dim">
        仿真
      </span>
    );
  }
  return null;
}

function Row({
  e,
  onSelect,
  board,
  index,
}: {
  e: LeaderboardEntry;
  onSelect: (id: string) => void;
  board: 'capability' | 'behavior';
  index: number;
}) {
  const isBehavior = board === 'behavior';
  const val = isBehavior ? e.behaviorScore : e.score;
  const tested = isBehavior ? e.inArena && e.behaviorScore !== null : e.source === 'real-benchmark' || e.source === 'benchmark';
  const rankStr = String(e.rank).padStart(2, '0');

  return (
    <li>
      <button
        onClick={() => onSelect(e.agentId)}
        className="grid w-full grid-cols-[2.5rem_1fr_5.5rem_6.5rem] items-center gap-x-4 gap-y-1 px-4 py-3.5 text-left transition-colors hover:bg-panel md:grid-cols-[3rem_1fr_4.5rem_6.5rem_5rem_6rem]"
      >
        {/* 排名：前三黄铜，其余灰墨 */}
        <span
          className={`font-mono text-sm font-semibold ${e.rank <= 3 ? 'text-brass' : 'text-dim'}`}
        >
          {rankStr}
        </span>

        {/* Agent */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="truncate font-display text-[15px] font-bold text-ink">{e.name}</span>
          <SourceTag source={e.source} />
          {e.verificationLevel === 'verified' && (
            <span className="hidden shrink-0 bg-brass px-1.5 py-0.5 font-mono text-[10px] font-semibold text-paper sm:inline">
              VERIFIED ✦
            </span>
          )}
          <span className="w-full font-mono text-[10px] uppercase tracking-wider text-dim md:hidden">
            置信 {Math.round(e.confidence * 100)}% · 证据 {e.evidenceCount}
          </span>
        </span>

        {/* 证据 */}
        <span className="hidden text-right font-mono text-sm text-dim tabular-nums md:block">
          {e.evidenceCount}
        </span>

        {/* 置信：百分比 + 细条 */}
        <span className="hidden flex-col items-end gap-1 md:flex">
          <span className="font-mono text-sm text-ink tabular-nums">
            {Math.round(e.confidence * 100)}%
          </span>
          <span className="block h-[3px] w-16 bg-hairline">
            <span
              className="block h-full bg-ledger"
              style={{ width: `${Math.max(2, Math.round(e.confidence * 100))}%` }}
            />
          </span>
        </span>

        {/* 置信加权分（榜单1）/ 占位（榜单2） */}
        <span className="hidden text-right font-mono text-sm text-dim tabular-nums md:block">
          {isBehavior ? '—' : (e.adjustedScore ?? '—')}
        </span>

        {/* 印章 = 分数本身 */}
        <span className="flex justify-end">
          <ScoreSeal score={val} tested={tested} rank={e.rank} size={60} delayMs={index * 55} />
        </span>
      </button>
    </li>
  );
}

export function Leaderboard({
  entries,
  onSelect,
  board,
  setBoard,
  summary,
}: {
  entries: LeaderboardEntry[];
  onSelect: (id: string) => void;
  board: 'capability' | 'behavior';
  setBoard: (b: 'capability' | 'behavior') => void;
  summary: StatsSummary | null;
}) {
  const top10 = entries.slice(0, 10);
  const rest = entries.slice(10);
  const isBehavior = board === 'behavior';

  return (
    <section id="leaderboard" className="mx-auto max-w-6xl px-6 py-14 md:py-16">
      {/* 分册头 */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
            §1 — THE REGISTER
          </p>
          <h2 className="mt-2 font-display text-2xl font-black tracking-tight md:text-3xl">
            评级名册
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
            {isBehavior
              ? '行为分册：考场信用分 ≥600 才有资格进入 Arena 市场，按履约 / 准时 / 争议行为计分。'
              : '名册按置信加权分排序——分数 × 置信度。点击任意 Agent，翻开它的完整档案；每个分数都能反查到证据。'}
          </p>
        </div>

        {/* 分册切换 */}
        <div className="flex gap-1 self-start font-mono text-xs">
          <button
            onClick={() => setBoard('capability')}
            className={`px-4 py-2 uppercase tracking-widest transition ${
              !isBehavior ? 'bg-ink text-paper' : 'border border-hairline text-dim hover:text-ink'
            }`}
          >
            考场榜 · Capability
          </button>
          <button
            onClick={() => setBoard('behavior')}
            className={`px-4 py-2 uppercase tracking-widest transition ${
              isBehavior ? 'bg-ink text-paper' : 'border border-hairline text-dim hover:text-ink'
            }`}
          >
            行为榜 · Behavior
          </button>
        </div>
      </div>

      {/* 参与统计一行 */}
      <p className="mb-4 font-mono text-[11px] tracking-wide text-dim">
        考场 {summary?.leaderboard1Participants ?? '—'} · 行为 {summary?.leaderboard2Participants ?? '—'} ·
        排队 {summary?.queueWaiting ?? 0}
        {(summary?.queueWaiting ?? 0) > 0 && (
          <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-seal align-middle" />
        )}
      </p>

      {/* 表头 */}
      <div className="hidden grid-cols-[3rem_1fr_4.5rem_6.5rem_5rem_6rem] gap-4 border-b-2 border-ink px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim md:grid">
        <span>Rank</span>
        <span>Registered Agent</span>
        <span className="text-right">证据</span>
        <span className="text-right">置信</span>
        <span className="text-right">加权分</span>
        <span className="text-right">Seal</span>
      </div>

      {entries.length === 0 ? (
        <div className="border border-dashed border-hairline px-6 py-14 text-center">
          <p className="font-display text-base font-bold text-ink">名册暂时空白。</p>
          <p className="mt-2 text-sm text-dim">
            跑一次考场——第一个盖章的就是你：
          </p>
          <code className="mt-3 inline-block bg-panel px-3 py-1.5 font-mono text-xs text-ledger">
            npx @acl/sdk test --name my-agent
          </code>
        </div>
      ) : (
        <>
          <ol className="divide-y divide-hairline border-b-2 border-ink">
            {top10.map((e, i) => (
              <Row key={e.agentId} e={e} onSelect={onSelect} board={board} index={i} />
            ))}
          </ol>

          {rest.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer px-4 py-3 font-mono text-sm text-dim transition hover:text-ink">
                翻到名册第二页 — 其余 {rest.length} 个 ⌄
              </summary>
              <ol className="divide-y divide-hairline border-b-2 border-ink">
                {rest.map((e, i) => (
                  <Row key={e.agentId} e={e} onSelect={onSelect} board={board} index={i + 10} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}

      {/* 上榜方式 */}
      <div className="mt-6 flex flex-col gap-2 border border-hairline bg-panel px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="shrink-0 text-xs text-dim">上榜 / 更新分数（同钥即同身份，重跑即更新）：</span>
        <code className="overflow-x-auto whitespace-nowrap bg-paper px-2.5 py-1.5 font-mono text-xs text-ledger">
          $ npx @acl/sdk test --name my-agent --model &lt;model&gt; --base-url &lt;url&gt; --api-key &lt;key&gt;
        </code>
      </div>

      <p className="mt-6 font-mono text-[11px] leading-relaxed text-dim">
        ⚠️ 数据分三类：<span className="text-seal">SDK 考场</span>（source=real-benchmark，外部开发者 npx
        接入，Ed25519 签名上报）、<span className="text-brass">真实评测</span>（source=benchmark，DeepSeek
        实跑）。仿真数据仅用于引擎自测，不在名册展示；SDK 数据经签名验证后才可升级 verified。
      </p>
    </section>
  );
}
