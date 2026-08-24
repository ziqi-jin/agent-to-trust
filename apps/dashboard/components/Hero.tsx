import { GITHUB_URL, type StatsResponse } from '@/lib/api';

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-3xl font-700 text-bright tabular-nums">{value}</span>
      <span className="mt-1 text-xs font-mono uppercase tracking-wider text-dim">{label}</span>
      {sub && <span className="text-[10px] font-mono text-dim/70">{sub}</span>}
    </div>
  );
}

export function Hero({
  stats,
  onTestAgent,
}: {
  stats: StatsResponse | null;
  onTestAgent: () => void;
}) {
  const sim = stats?.simulation;
  return (
    <section className="relative overflow-hidden border-b border-edge">
      {/* 实验室网格 + 微光背景 */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-edge bg-surface/70 px-3 py-1 text-xs font-mono text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            live · seed 42 · 确定性仿真
          </div>

          <h1 className="font-display text-4xl font-700 leading-[1.05] tracking-tight text-bright md:text-6xl">
            Don&apos;t trust an Agent.
            <br />
            <span className="text-accent score-glow">Test it.</span>
          </h1>

          <p className="mt-5 text-lg font-display font-600 text-bright/80 md:text-xl">
            What if every AI agent had a credit score?
          </p>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-dim md:text-base">
            Agent Credit Lab 是开源的 Agent 信任实验场。我们让 100 个 Agent 在虚拟市场里自主交易，
            把每一次成交、准时、诚实与否都变成<b className="text-bright/90">可追溯的证据</b>，再据此算出
            带置信度的信用分。信任不是拍脑袋，是测出来的。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-bright px-5 py-2.5 text-sm font-semibold text-abyss transition hover:bg-white"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              Star on GitHub
            </a>
            <button
              onClick={onTestAgent}
              className="inline-flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/20"
            >
              🧪 送你的 Agent 上榜
            </button>
          </div>
        </div>

        {/* 实时大数字 */}
        <div className="mt-12 grid grid-cols-2 gap-6 border-t border-edge pt-8 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Agents" value={fmt(stats?.agentCount)} sub="自主交易" />
          <Stat label="交易" value={fmt(sim?.transactions)} sub={`${fmt(sim?.settled)} 成交`} />
          <Stat label="合约" value={fmt(sim?.contractsCreated)} sub={`${fmt(sim?.failed)} 失败`} />
          <Stat label="证据" value={fmt(stats?.evidenceCount)} sub="source=simulation" />
          <Stat label="成交额" value={fmt(sim?.totalValue)} sub="虚拟信用点" />
        </div>
      </div>
    </section>
  );
}
