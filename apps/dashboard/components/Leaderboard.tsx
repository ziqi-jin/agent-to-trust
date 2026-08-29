import type { LeaderboardEntry } from '@/lib/api';
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

export function Leaderboard({
  entries,
  onSelect,
  newName,
  setNewName,
  onCreate,
  busy,
}: {
  entries: LeaderboardEntry[];
  onSelect: (id: string) => void;
  newName: string;
  setNewName: (s: string) => void;
  onCreate: () => void;
  busy: boolean;
}) {
  const top10 = entries.slice(0, 10);
  const rest = entries.slice(10);

  return (
    <section id="leaderboard" className="mx-auto max-w-6xl px-6 py-16 md:py-20">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-display text-2xl font-700 text-bright md:text-3xl">
            🏆 榜单 <span className="text-dim">/ Leaderboard</span>
          </h2>
          <p className="mt-2 text-sm text-dim">
            每个分数都可追溯到 evidence，点击任意 Agent 查看完整信用报告。
          </p>
        </div>

        {/* 送你的 Agent 上榜 */}
        <div className="flex w-full max-w-sm gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
            placeholder="给你的 Agent 起个名字…"
            className="flex-1 rounded-lg bg-abyss border border-edge px-3 py-2.5 text-sm text-bright placeholder:text-dim focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={onCreate}
            disabled={busy || !newName.trim()}
            className="rounded-lg bg-accent/90 px-4 py-2.5 text-sm font-semibold text-abyss hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            上榜
          </button>
        </div>
      </div>

      {/* 表头 */}
      <div className="hidden grid-cols-[3rem_1fr_8rem_7rem_6rem] gap-4 border-b border-edge px-4 pb-2 text-[11px] font-mono uppercase tracking-wider text-dim md:grid">
        <span>排名</span>
        <span>Agent</span>
        <span className="text-right">信用分</span>
        <span className="text-right">置信度</span>
        <span className="text-right">证据</span>
      </div>

      <ol className="divide-y divide-edge">
        {top10.map((e) => (
          <Row key={e.agentId} e={e} onSelect={onSelect} showRing={e.rank <= 3} />
        ))}
      </ol>

      {rest.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-mono text-dim hover:text-bright">
            展开其余 {rest.length} 个 Agent…
          </summary>
          <ol className="divide-y divide-edge">
            {rest.map((e) => (
              <Row key={e.agentId} e={e} onSelect={onSelect} showRing={false} />
            ))}
          </ol>
        </details>
      )}

      <p className="mt-6 text-[11px] font-mono text-dim/70">
        ⚠️ 数据分三类：<span className="text-accent">SDK 考场</span>（source=real-benchmark，外部开发者 npx 接入，Ed25519 签名上报）、
        <span className="text-accent/80">真实评测</span>（source=benchmark，DeepSeek 实跑）与
        <span className="text-dim">仿真</span>（source=simulation，seed=42 确定性生成）。仿真数据绝不伪装成真实数据；SDK 数据经签名验证后才可升级 verified。
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
}: {
  e: LeaderboardEntry;
  onSelect: (id: string) => void;
  showRing: boolean;
}) {
  const barColor = scoreBarColor(e.score);
  const barWidth = e.score != null ? `${Math.max(2, Math.round((e.score / 1000) * 100))}%` : '0%';

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
          <GradeBadge score={e.score} size="sm" />
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

        {/* 信用分 */}
        <span className="text-right">
          <span className="font-mono text-lg font-700 text-bright tabular-nums">
            {e.score ?? <span className="text-dim">—</span>}
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
