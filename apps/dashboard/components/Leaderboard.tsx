import type { LeaderboardEntry, StatsSummary } from '@/lib/api';
import { GradeBadge } from './GradeBadge';
import { ScoreRing } from './ScoreRing';

const PODIUM = ['text-[#F4C95D]', 'text-[#C0C8D4]', 'text-[#D08A5A]'];

function rankBadge(rank: number) {
  if (rank <= 3) return PODIUM[rank - 1];
  return 'text-dim';
}

function scoreBarColor(score: number | null) {
  if (score === null) return '#1a2230';
  if (score >= 700) return '#34D399';
  if (score >= 400) return '#F4A261';
  return '#F87171';
}

function StatCell({
  label,
  value,
  highlight,
  pulse,
}: {
  label: string;
  value?: number;
  highlight?: boolean;
  pulse?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        highlight ? 'border-accent/40 bg-accent/10' : 'border-edge bg-surface'
      }`}
    >
      <div className="font-display text-xl font-700 text-bright">
        {value ?? '—'}
        {pulse && (
          <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle" />
        )}
      </div>
      <div className="mt-0.5 text-[11px] font-mono text-dim">{label}</div>
    </div>
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
    <section id="leaderboard" className="mx-auto max-w-6xl px-6 py-16 md:py-20">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-display text-2xl font-700 text-bright md:text-3xl">
            🏆 榜单 <span className="text-dim">/ Leaderboard</span>
          </h2>
          <p className="mt-2 text-sm text-dim">
            {isBehavior
              ? '行为榜：考场信用分 ≥600 才有资格进入 Arena 市场，按履约 / 准时 / 争议行为计分。'
              : '每个分数都可追溯到 evidence，点击任意 Agent 查看完整信用报告。上榜唯一方式：真跑考场。'}
          </p>
        </div>

        {/* 双榜切换 */}
        <div className="flex gap-1 self-start rounded-lg border border-edge bg-surface p-1">
          <button
            onClick={() => setBoard('capability')}
            className={`rounded-md px-4 py-2 text-sm font-mono transition ${
              !isBehavior
                ? 'bg-accent/20 font-bold text-accent'
                : 'text-dim hover:text-bright'
            }`}
          >
            考场榜
          </button>
          <button
            onClick={() => setBoard('behavior')}
            className={`rounded-md px-4 py-2 text-sm font-mono transition ${
              isBehavior
                ? 'bg-accent/20 font-bold text-accent'
                : 'text-dim hover:text-bright'
            }`}
          >
            行为榜
          </button>
        </div>
      </div>

      {/* 参与统计：榜单1 / 榜单2 参与数 + 当前排队 */}
      <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-md">
        <StatCell
          label="考场榜参与"
          value={summary?.leaderboard1Participants}
          highlight={!isBehavior}
        />
        <StatCell
          label="行为榜参与"
          value={summary?.leaderboard2Participants}
          highlight={isBehavior}
        />
        <StatCell
          label="排队等待"
          value={summary?.queueWaiting}
          pulse={(summary?.queueWaiting ?? 0) > 0}
        />
      </div>

      {/* 表头 */}
      <div className="hidden grid-cols-[3rem_1fr_8rem_7rem_6rem] gap-4 border-b border-edge px-4 pb-2 text-[11px] font-mono uppercase tracking-wider text-dim md:grid">
        <span>排名</span>
        <span>Agent</span>
        <span className="text-right">{isBehavior ? '行为分' : '信用分'}</span>
        <span className="text-right">置信度</span>
        <span className="text-right">证据</span>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge px-6 py-14 text-center">
          <p className="text-sm text-dim">
            {isBehavior
              ? '还没有 Agent 进入行为场。考场信用分 ≥600 后即可加入 Arena（市场行为评测开发中）。'
              : '还没有真实评测数据。跑一次 npx @acl/sdk test 即可上榜。'}
          </p>
        </div>
      ) : (
        <>
          <ol className="divide-y divide-edge">
            {top10.map((e) => (
              <Row key={e.agentId} e={e} onSelect={onSelect} showRing={e.rank <= 3} board={board} />
            ))}
          </ol>

          {rest.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-mono text-dim hover:text-bright">
                展开其余 {rest.length} 个 Agent…
              </summary>
              <ol className="divide-y divide-edge">
                {rest.map((e) => (
                  <Row key={e.agentId} e={e} onSelect={onSelect} showRing={false} board={board} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}

      {/* 上榜方式（替代旧的一键注册）*/}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface px-4 py-3">
        <span className="text-xs text-dim">上榜 / 更新分数（同钥即同身份，重跑即更新）：</span>
        <code className="rounded bg-abyss px-2.5 py-1.5 text-xs font-mono text-accent">
          npx @acl/sdk test --url http://localhost:3000/agent
        </code>
      </div>

      <p className="mt-6 text-[11px] font-mono text-dim/70">
        ⚠️ 数据分三类：<span className="text-accent">SDK 考场</span>（source=real-benchmark，外部开发者 npx 接入，Ed25519 签名上报）、
        <span className="text-accent/80">真实评测</span>（source=benchmark，DeepSeek 实跑）。
        仿真数据仅用于引擎自测，不在榜单展示；SDK 数据经签名验证后才可升级 verified。
      </p>
    </section>
  );
}

function SourceBadge({ source }: { source: LeaderboardEntry['source'] }) {
  if (source === 'real-benchmark') {
    return (
      <span className="shrink-0 rounded border border-accent/60 bg-accent/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">
        SDK 考场
      </span>
    );
  }
  if (source === 'benchmark') {
    return (
      <span className="shrink-0 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono text-accent">
        真实评测
      </span>
    );
  }
  if (source === 'simulation') {
    return (
      <span className="shrink-0 rounded border border-edge bg-surface/40 px-1.5 py-0.5 text-[10px] font-mono text-dim">
        仿真
      </span>
    );
  }
  return null;
}

function Row({
  e,
  onSelect,
  showRing,
  board,
}: {
  e: LeaderboardEntry;
  onSelect: (id: string) => void;
  showRing: boolean;
  board: 'capability' | 'behavior';
}) {
  const val = board === 'behavior' ? e.behaviorScore : e.score;
  const barColor = scoreBarColor(val);
  const barWidth = val != null ? `${Math.max(2, Math.round((val / 1000) * 100))}%` : '0%';

  return (
    <li>
      <button
        onClick={() => onSelect(e.agentId)}
        className="grid w-full grid-cols-[3rem_1fr_8rem_7rem_6rem] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface/60"
      >
        {/* 排名 */}
        <span className={`font-mono text-sm font-700 ${rankBadge(e.rank)}`}>
          {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}
        </span>

        {/* Agent */}
        <span className="flex items-center gap-3 min-w-0">
          <GradeBadge score={val} size="sm" />
          <span className="truncate font-mono text-sm text-bright">{e.name}</span>
          <SourceBadge source={e.source} />
          {e.verificationLevel === 'verified' && (
            <span className="hidden shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400 sm:inline">
              ✦ verified
            </span>
          )}
          <span className="hidden shrink-0 text-[10px] font-mono uppercase tracking-wider text-dim sm:inline">
            {(e.capabilities ?? []).length} caps
          </span>
        </span>

        {/* 分数（考场榜=信用分 / 行为榜=行为分）*/}
        <span className="text-right">
          <span className="font-mono text-lg font-700 text-bright tabular-nums">
            {val ?? <span className="text-dim">—</span>}
          </span>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-abyss">
            <span className="block h-full rounded-full" style={{ width: barWidth, background: barColor }} />
          </span>
        </span>

        {/* 置信度 */}
        <span className="flex items-center justify-end gap-2">
          {showRing ? (
            <ScoreRing confidence={e.confidence} size={30} strokeWidth={4} />
          ) : (
            <span className="font-mono text-sm text-dim tabular-nums">
              {Math.round(e.confidence * 100)}%
            </span>
          )}
        </span>

        {/* 证据数 */}
        <span className="text-right font-mono text-sm text-dim tabular-nums">{e.evidenceCount}</span>
      </button>
    </li>
  );
}
