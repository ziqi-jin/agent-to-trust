'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { PgResult, PgSession } from '@/lib/api';
import { useT } from '@/lib/i18n';

const RESULT_CLS: Record<PgResult, string> = {
  success: 'border-info/30 bg-info/10 text-info',
  partial: 'border-amber/30 bg-amber/10 text-amber',
  failure: 'border-seal/30 bg-seal/10 text-seal',
};

const RESULT_EN: Record<PgResult, string> = {
  success: 'SUCCESS',
  partial: 'PARTIAL',
  failure: 'FAILURE',
};

/** 百分比指标：数字 + 细进度条。 */
function Meter({ pct }: { pct: number }) {
  return (
    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
      <span
        className="block h-full origin-left animate-grow-x rounded-full bg-ledger"
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </span>
  );
}

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
  const quality = Math.round(sc.dealQuality * 100);
  const compliance = Math.round(sc.protocolCompliance * 100);

  return (
    <div className="card hud relative mb-6 animate-pop-in p-5 shadow-lift md:p-6">
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
          {t.playground.scorecard.title}
        </p>
        <span
          className={`stamp-in inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 font-mono text-xs font-bold tracking-widest ${cls}`}
          style={{ '--rot': '-2deg' } as React.CSSProperties}
        >
          {RESULT_EN[sc.result]} · {labelMap[sc.result]}
        </span>
      </div>

      <p className="relative mt-3 font-display text-xl font-bold text-ink">
        {session.name || 'anonymous'}
        <span className="ml-2 font-mono text-[11px] font-normal text-dim">{t.playground.scorecard.vs}</span>
      </p>

      <dl className="relative mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md border border-line bg-night px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-dim">{t.playground.scorecard.dealPrice}</dt>
          <dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{sc.dealValue ?? '—'}</dd>
        </div>
        <div className="rounded-md border border-line bg-night px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-dim">{t.playground.scorecard.dealQuality}</dt>
          <dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{quality}%</dd>
          <Meter pct={quality} />
        </div>
        <div className="rounded-md border border-line bg-night px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-dim">
            {t.playground.scorecard.protocolCompliance}
          </dt>
          <dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{compliance}%</dd>
          <Meter pct={compliance} />
        </div>
        <div className="rounded-md border border-line bg-night px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-dim">{t.playground.scorecard.rounds}</dt>
          <dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{sc.roundsUsed}</dd>
        </div>
      </dl>

      <div className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-5">
        <Link href="/" className="btn-primary group">
          {t.playground.scorecard.goExam.replace(/\s*[→▸]\s*$/, '')}
          <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
        <p className="font-mono text-[11px] text-dim">{t.playground.scorecard.footnote}</p>
      </div>
    </div>
  );
}
