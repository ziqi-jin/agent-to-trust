'use client';

import type { LeaderboardEntry, StatsSummary } from '@/lib/api';
import { useT, fill } from '@/lib/i18n';
import { ScoreSeal } from './ScoreSeal';
import { MedalBar } from './MedalBar';
import { CopyButton } from './CopyButton';
import { DIMENSIONS } from '@a2t/core';

function SourceTag({ source }: { source: LeaderboardEntry['source'] }) {
  const t = useT();
  if (source === 'real-benchmark') {
    return (
      <span className="shrink-0 border border-seal/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-seal">
        {t.leaderboard.sourceSdk}
      </span>
    );
  }
  if (source === 'benchmark') {
    return (
      <span className="shrink-0 border border-brass/70 px-1.5 py-0.5 font-mono text-[10px] text-brass">
        {t.leaderboard.sourceBenchmark}
      </span>
    );
  }
  if (source === 'simulation') {
    return (
      <span className="shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-dim">
        {t.leaderboard.sourceSimulation}
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
  const t = useT();
  const isBehavior = board === 'behavior';
  // 口径统一（v0.2）：印章 = 排序键 = 绝对分，与详情页同值；行为榜仍显示行为分。
  const val = isBehavior ? e.behaviorScore : e.score;
  // 临时评级（对齐酒馆口径）：证据 <5 条灰显混排，不隐藏
  const provisional = e.evidenceCount < 5;
  const tested = isBehavior ? e.inArena && e.behaviorScore !== null : e.source === 'real-benchmark' || e.source === 'benchmark';
  const rankStr = String(e.rank).padStart(2, '0');

  return (
    <li>
      <button
        onClick={() => onSelect(e.agentId)}
        className={`grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3.5 text-left transition-colors hover:bg-panel md:grid-cols-[3rem_1fr_4.5rem_6.5rem_5rem_10.5rem_6rem] md:gap-x-4 ${provisional ? 'opacity-60' : ''}`}
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
          {provisional && (
            <span className="shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-dim">
              {t.leaderboard.provisional}
            </span>
          )}
          {e.agentVersion && (
            <span className="shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-dim">
              v{e.agentVersion}
            </span>
          )}
          <SourceTag source={e.source} />
          {isBehavior && e.counterpartModes?.includes('live') && (
            <span className="shrink-0 border border-seal/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-seal">
              {t.leaderboard.liveBadge}
            </span>
          )}
          {e.verificationLevel === 'verified' && (
            <span className="hidden shrink-0 bg-brass px-1.5 py-0.5 font-mono text-[10px] font-semibold text-paper sm:inline">
              VERIFIED ✦
            </span>
          )}
          <span className="w-full font-mono text-[10px] uppercase tracking-wider text-dim md:hidden">
            {fill(t.leaderboard.mobileRow, {
              confidence: Math.round(e.confidence * 100),
              evidence: e.evidenceCount,
            })}
            {e.model ? ` · ${e.model}` : ''}
          </span>
          {/* 勋章条（服务端权威派生；每维最多一枚，未解锁显示灰档） */}
          <MedalBar badges={e.badges ?? []} size={17} className="mt-0.5 w-full" />
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

        {/* 分数列（v0.2：榜单1 = 绝对信用分；行为榜 = 考场信用分，资格线可见化） */}
        <span className="hidden text-right font-mono text-sm text-dim tabular-nums md:block">
          {e.score ?? '—'}
        </span>

        {/* 模型（agent 显式上报，未提供显示 —） */}
        <span className="hidden truncate text-right font-mono text-xs text-dim md:block">
          {e.model ?? '—'}
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
  dims,
  setDims,
  mode,
  setMode,
}: {
  entries: LeaderboardEntry[];
  onSelect: (id: string) => void;
  board: 'capability' | 'behavior';
  setBoard: (b: 'capability' | 'behavior') => void;
  summary: StatsSummary | null;
  dims: string[];
  setDims: (d: string[]) => void;
  mode: 'scripted' | 'live' | 'all';
  setMode: (m: 'scripted' | 'live' | 'all') => void;
}) {
  const t = useT();
  const top10 = entries.slice(0, 10);
  const rest = entries.slice(10);
  const isBehavior = board === 'behavior';
  const toggleDim = (d: string) =>
    setDims(dims.includes(d) ? dims.filter((x) => x !== d) : [...dims, d]);

  return (
    <section id="leaderboard" className="mx-auto w-full max-w-6xl px-6 py-14 md:py-16">
      {/* 分册头 */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
            §1 — THE REGISTER
          </p>
          <h2 className="mt-2 font-display text-2xl font-black tracking-tight md:text-3xl">
            {t.leaderboard.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
            {isBehavior ? t.leaderboard.subtitleBehavior : t.leaderboard.subtitleCapability}
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
            {t.leaderboard.tabCapability}
          </button>
          <button
            onClick={() => setBoard('behavior')}
            className={`px-4 py-2 uppercase tracking-widest transition ${
              isBehavior ? 'bg-ink text-paper' : 'border border-hairline text-dim hover:text-ink'
            }`}
          >
            {t.leaderboard.tabBehavior}
          </button>
        </div>
      </div>

      {/* 特色位（榜2）：真实环境 · 真实 agent 评测 */}
      {isBehavior && (
        <div className="mb-6 border border-seal/40 bg-seal/5 px-4 py-3">
          <p className="font-display text-sm font-bold text-seal">
            {t.leaderboard.highlightTitle}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-dim">{t.leaderboard.highlightBody}</p>
        </div>
      )}

      {/* 参与统计一行 */}
      <p className="mb-4 font-mono text-[11px] tracking-wide text-dim">
        {fill(t.leaderboard.statsLine, {
          exam: summary?.leaderboard1Participants ?? '—',
          behavior: summary?.leaderboard2Participants ?? '—',
          queue: summary?.queueWaiting ?? 0,
        })}
        {(summary?.queueWaiting ?? 0) > 0 && (
          <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-seal align-middle" />
        )}
      </p>

      {/* 维度筛选 / 组合重排（0912）：勾选维度 → 按所选维度均分降序重排；不改底层分数 */}
      <div className="mb-5 border border-hairline bg-panel px-4 py-3">
        {/* 处理方式筛选（榜2）：脚本 / 真实 / 全部——两套分数各自成榜（T8 /leaderboard?mode=） */}
        {isBehavior && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline pb-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
              {t.leaderboard.modeLabel}
            </span>
            {(
              [
                ['all', t.leaderboard.modeAll],
                ['live', t.leaderboard.modeLive],
                ['scripted', t.leaderboard.modeScripted],
              ] as const
            ).map(([m, label]) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={on}
                  className={`border px-2 py-1 font-mono text-[11px] transition ${
                    on
                      ? 'border-ledger bg-ledger text-paper'
                      : 'border-hairline text-dim hover:border-ink hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
            {t.leaderboard.filterLabel}
          </span>
          {DIMENSIONS.map((d) => {
            const on = dims.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleDim(d)}
                aria-pressed={on}
                className={`border px-2 py-1 font-mono text-[11px] transition ${
                  on
                    ? 'border-ledger bg-ledger text-paper'
                    : 'border-hairline text-dim hover:border-ink hover:text-ink'
                }`}
              >
                {t.dimensions[d] ?? d}
              </button>
            );
          })}
          {dims.length > 0 && (
            <button
              onClick={() => setDims([])}
              className="ml-1 font-mono text-[11px] text-seal underline-offset-4 hover:underline"
            >
              {t.leaderboard.filterClear} ✕
            </button>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] text-dim">
          {dims.length > 0
            ? fill(t.leaderboard.filterActive, { n: dims.length })
            : t.leaderboard.filterHint}
        </p>
      </div>

      {/* 表格区：横向滚动容器兜底（列收敡后 390 内应刚好放下，不出现滚动条） */}
      <div className="overflow-x-auto">
        {/* 表头 */}
        <div className="hidden grid-cols-[3rem_1fr_4.5rem_6.5rem_5rem_10.5rem_6rem] gap-4 border-b-2 border-ink px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim md:grid">
          <span>Rank</span>
          <span>Registered Agent</span>
          <span className="text-right">{t.leaderboard.colEvidence}</span>
          <span className="text-right">{t.leaderboard.colConfidence}</span>
          <span className="text-right">
            {isBehavior ? t.leaderboard.colExam : t.leaderboard.colWeighted}
          </span>
          <span className="text-right">{t.leaderboard.colModel}</span>
          <span className="text-right">Seal</span>
        </div>

        {entries.length === 0 ? (
          <div className="border border-dashed border-hairline px-6 py-14 text-center">
            <p className="font-display text-base font-bold text-ink">{t.leaderboard.emptyTitle}</p>
            <p className="mt-2 text-sm text-dim">{t.leaderboard.emptyDesc}</p>
            <div className="relative mt-3 inline-block">
              <code className="block whitespace-pre-wrap break-words bg-panel py-1.5 pl-3 pr-20 font-mono text-xs text-ledger">
                {'npx agent-to-trust test --url <your-agent-url> --name my-agent'}
              </code>
              <CopyButton
                text="npx agent-to-trust test --url <your-agent-url> --name my-agent"
                className="absolute right-1.5 top-1.5"
              />
            </div>
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
                  {fill(t.leaderboard.moreRows, { n: rest.length })}
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
      </div>

      {/* 上榜方式：命令行较长，移动端改为 block 滚动容器（flex 子项的 min-content 会把整页撑破） */}
      <div className="mt-6 border border-hairline bg-panel px-4 py-3 sm:flex sm:items-center sm:gap-4">
        <span className="shrink-0 text-xs text-dim">{t.leaderboard.listHint}</span>
        <div className="relative mt-2 sm:mt-0 sm:min-w-0 sm:flex-1">
          <code className="block whitespace-pre-wrap break-words bg-paper py-1.5 pl-2.5 pr-20 font-mono text-xs text-ledger">
            $ npx agent-to-trust test --name my-agent --url &lt;你的agent地址&gt;
            <br />
            # 本地 CLI agent：--cmd "aider --message"　·　指模型试跑：--model &lt;model&gt; --base-url &lt;url&gt; --api-key &lt;key&gt;
          </code>
          <CopyButton
            text={`npx agent-to-trust test --name my-agent --url <你的agent地址>\n# 本地 CLI agent：--cmd "aider --message"　·　指模型试跑：--model <model> --base-url <url> --api-key <key>`}
            className="absolute right-1.5 top-1.5"
          />
        </div>
      </div>

      <p className="mt-6 font-mono text-[11px] leading-relaxed text-dim">
        {t.medal.legend}
      </p>

      <p className="mt-4 font-mono text-[11px] leading-relaxed text-dim">
        {t.leaderboard.footnotePre}
        <span className="text-seal">{t.leaderboard.footnoteSdk}</span>
        {t.leaderboard.footnoteSdkDetail}
        <span className="text-brass">{t.leaderboard.footnoteBench}</span>
        {t.leaderboard.footnoteBenchDetail}
        {t.leaderboard.footnotePost}
      </p>
    </section>
  );
}
