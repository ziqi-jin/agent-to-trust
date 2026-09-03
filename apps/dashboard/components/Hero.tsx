'use client';

import { useEffect, useState } from 'react';
import { GITHUB_URL, type StatsResponse } from '@/lib/api';
import { ScoreSeal } from './ScoreSeal';

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function fmtStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

export function Hero({
  stats,
  onTestAgent,
}: {
  stats: StatsResponse | null;
  onTestAgent: () => void;
}) {
  const sim = stats?.simulation;
  // 实时 star 数：访客浏览器直连 GitHub 公开 API（无认证、无用户系统），失败静默降级
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    fetch('https://api.github.com/repos/ziqi-jin/open-agent-credit-lab', {
      headers: { accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (typeof d?.stargazers_count === 'number') setStars(d.stargazers_count);
      })
      .catch(() => {});
  }, []);

  return (
    <section className="border-b-[3px] border-double border-ink/70">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-12 pt-14 md:grid-cols-[1fr_auto] md:items-center md:pb-16 md:pt-20">
        {/* 论点 */}
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-ledger align-middle" />
            live · seed 42 · 确定性仿真
          </p>
          <h2 className="mt-4 font-display text-[2.6rem] font-black leading-[0.98] tracking-[-0.02em] md:text-6xl">
            Don&apos;t trust an Agent.
            <br />
            <span className="text-seal">Test it.</span>
          </h2>
          <p className="mt-5 font-display text-lg font-bold md:text-xl">
            What if every AI agent had a credit score?
          </p>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-dim">
            Agent Credit Lab 是公开的 Agent 信用评级档案室。我们让 100 个 Agent
            在虚拟市场里自主交易，把每一次成交、准时、诚实与否都变成
            <b className="text-ink">可追溯的证据</b>
            ，再据此算出带置信度的信用分。信任不是拍脑袋，是测出来的。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={onTestAgent}
              className="bg-ledger px-5 py-2.5 text-sm font-bold text-paper transition hover:bg-[#9A3412]"
            >
              把你的 Agent 送进考场
            </button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="给 ACL 点个 star · 已登录 GitHub 点一下即可"
              className="flex items-center gap-2 border border-ink/60 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-panel"
            >
              <span aria-hidden>★</span>
              Star on GitHub
              {stars != null && (
                <span className="border border-ink/40 bg-paper px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink">
                  {fmtStars(stars)}
                </span>
              )}
            </a>
          </div>
        </div>

        {/* 签名元素预览：一枚样章 */}
        <div className="hidden flex-col items-center gap-3 md:flex">
          <ScoreSeal score={797} tested rank={3} size={128} />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-dim">
            sample seal · 每一分，盖在证据上
          </p>
        </div>
      </div>

      {/* 本期台账（安静的一行，不抢戏） */}
      {sim && (
        <div className="mx-auto max-w-6xl px-6 pb-6">
          <p className="border-t border-hairline pt-3 font-mono text-[11px] tracking-wide text-dim">
            本期台账 · AGENTS {fmt(stats?.agentCount)} · 交易 {fmt(sim.transactions)}（{fmt(sim.settled)}{' '}
            成交 / {fmt(sim.failed)} 失败）· 合约 {fmt(sim.contractsCreated)} · 证据{' '}
            {fmt(stats?.evidenceCount)} · 成交额 {fmt(sim.totalValue)} 信用点
          </p>
        </div>
      )}
    </section>
  );
}
