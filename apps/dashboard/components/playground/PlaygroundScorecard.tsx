'use client';

import type { PgResult, PgSession } from '@/lib/api';
import { useT } from '@/lib/i18n';

const RESULT_CLS: Record<PgResult, string> = {
  success: 'border-info text-info',
  partial: 'border-amber text-amber',
  failure: 'border-seal text-seal',
};

const RESULT_EN: Record<PgResult, string> = {
  success: 'SUCCESS',
  partial: 'PARTIAL',
  failure: 'FAILURE',
};

/**
 * 终局评分卡：result 徽章 + 成交价 / 成交质量 / 协议合规 / 回合数。
 * 盖章式入场（stamp-in，确定性微旋转）；自测场结果不进官方榜，CTA 指向考场。
 */
export function PlaygroundScorecard({ session }: { session: PgSession }) {
  const t = useT();
  const sc = session.scorecard;
  if (!sc) return null;
  const labelMap: Record<PgResult, string> = {
    success: t.playground.scorecard.resultSuccess,
    partial: t.playground.scorecard.resultPartial,
    failure: t.playground.scorecard.resultFailure,
  };
  const cls = RESULT_CLS[sc.result];

  return (
    <div
      className="stamp-in mb-8 border-2 border-ink bg-paper p-5"
      style={{ '--rot': '-1deg', transform: 'rotate(-1deg)' } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          {t.playground.scorecard.title}
        </p>
        <span
          className={`inline-flex items-center gap-1.5 border bg-paper px-2 py-1 font-mono text-xs font-bold tracking-widest ${cls}`}
        >
          {RESULT_EN[sc.result]} · {labelMap[sc.result]}
        </span>
      </div>

      <p className="mt-2 font-display text-base font-bold text-ink">
        {session.name || 'anonymous'}
        <span className="ml-2 font-mono text-[11px] font-normal text-dim">
          {t.playground.scorecard.vs}
        </span>
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-px border border-hairline bg-hairline md:grid-cols-4">
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">
            {t.playground.scorecard.dealPrice}
          </dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
            {sc.dealValue ?? '—'}
          </dd>
        </div>
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">
            {t.playground.scorecard.dealQuality}
          </dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
            {Math.round(sc.dealQuality * 100)}%
          </dd>
        </div>
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">
            {t.playground.scorecard.protocolCompliance}
          </dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
            {Math.round(sc.protocolCompliance * 100)}%
          </dd>
        </div>
        <div className="bg-paper px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">
            {t.playground.scorecard.rounds}
          </dt>
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
          {t.playground.scorecard.goExam}
        </a>
        <p className="font-mono text-[11px] text-dim">{t.playground.scorecard.footnote}</p>
      </div>
    </div>
  );
}
