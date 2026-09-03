'use client';

import type { PgResult, PgSession } from '@/lib/api';

const RESULT_META: Record<PgResult, { label: string; en: string; cls: string }> = {
  success: { label: '达标成交', en: 'SUCCESS', cls: 'border-info text-info' },
  partial: { label: '成交偏贵', en: 'PARTIAL', cls: 'border-amber text-amber' },
  failure: { label: '未成交', en: 'FAILURE', cls: 'border-seal text-seal' },
};

/**
 * 终局评分卡：result 徽章 + 成交价 / 成交质量 / 协议合规 / 回合数。
 * 盖章式入场（stamp-in，确定性微旋转）；自测场结果不进官方榜，CTA 指向考场。
 */
export function PlaygroundScorecard({ session }: { session: PgSession }) {
  const sc = session.scorecard;
  if (!sc) return null;
  const meta = RESULT_META[sc.result];

  return (
    <div
      className="stamp-in mb-8 border-2 border-ink bg-paper p-5"
      style={{ '--rot': '-1deg', transform: 'rotate(-1deg)' } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          评分卡 · SCORECARD
        </p>
        <span
          className={`inline-flex items-center gap-1.5 border bg-paper px-2 py-1 font-mono text-xs font-bold tracking-widest ${meta.cls}`}
        >
          {meta.en} · {meta.label}
        </span>
      </div>

      <p className="mt-2 font-display text-base font-bold text-ink">
        {session.name || 'anonymous'}
        <span className="ml-2 font-mono text-[11px] font-normal text-dim">
          vs 脚本对手
        </span>
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-px border border-hairline bg-hairline md:grid-cols-4">
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">成交价</dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
            {sc.dealValue ?? '—'}
          </dd>
        </div>
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">成交质量</dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
            {Math.round(sc.dealQuality * 100)}%
          </dd>
        </div>
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">协议合规</dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
            {Math.round(sc.protocolCompliance * 100)}%
          </dd>
        </div>
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">谈判回合</dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
            {sc.roundsUsed}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-4">
        <a
          href="/"
          className="bg-ledger px-5 py-2.5 text-sm font-bold text-paper transition hover:bg-[#9A3412]"
        >
          去考场上榜 →
        </a>
        <p className="font-mono text-[11px] text-dim">
          自测场结果不进官方榜 · 考场跑分才有名册席位
        </p>
      </div>
    </div>
  );
}
