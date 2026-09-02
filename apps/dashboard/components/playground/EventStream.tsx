'use client';

import { useEffect, useRef } from 'react';
import type { PgActor, PgEvent, PgSession } from '@/lib/api';

/** 角色分色（现有档案室色板内）：system 灰 / agent 账簿绿 / 对手 黄铜橙 */
const ACTOR: Record<PgActor, { label: string; cls: string }> = {
  system: { label: '系统', cls: 'border-hairline text-dim' },
  agent: { label: 'AGENT', cls: 'border-ledger text-ledger' },
  counterpart: { label: '对手', cls: 'border-amber text-amber' },
};

const TYPE_LABELS: Record<PgEvent['type'], string> = {
  scenario: '场景',
  offer: '报价',
  accept: '接受',
  concede: '让步',
  deal: '成交',
  breakdown: '破裂',
  timeout: '超时',
};

function EventRow({ e }: { e: PgEvent }) {
  const actor = ACTOR[e.actor];
  const isFinale = e.type === 'deal' || e.type === 'breakdown';
  return (
    <li
      className={`flex items-start gap-3 px-4 py-2.5 ${
        isFinale ? 'bg-panel' : ''
      }`}
    >
      <span className="w-7 shrink-0 pt-1 text-right font-mono text-[10px] tabular-nums text-dim">
        {String(e.seq).padStart(2, '0')}
      </span>
      <span
        className={`mt-0.5 shrink-0 border px-1.5 py-0.5 font-mono text-[10px] ${actor.cls}`}
      >
        {actor.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-wider text-dim">
          {e.round > 0 ? `第 ${e.round} 轮 · ` : ''}
          {TYPE_LABELS[e.type] ?? e.type}
        </p>
        <p className="mt-0.5 break-words text-[13px] leading-relaxed text-ink">{e.text}</p>
      </div>
      {e.value != null && (
        <span className="shrink-0 pt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
          {e.value}
        </span>
      )}
    </li>
  );
}

/**
 * 实时证据流：按 seq 排序；未开跑显示引导文案（绝无假数据）；
 * running 时脉冲「谈判中…」；新事件到达时滚动到最新一条。
 */
export function EventStream({
  session,
  running,
}: {
  session: PgSession | null;
  running: boolean;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const prevCount = useRef<number>(0);

  const events = session ? [...session.events].sort((a, b) => a.seq - b.seq) : [];

  useEffect(() => {
    const count = events.length;
    if (count > prevCount.current && prevCount.current > 0) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    prevCount.current = count;
  }, [events.length]);

  return (
    <div>
      {running && (
        <div className="mb-4 flex items-center gap-2.5 border border-ledger/40 bg-panel px-4 py-2.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ledger" />
          <span className="font-mono text-xs tracking-wide text-ledger">
            谈判中… 每轮报价实时亮出
          </span>
        </div>
      )}

      {session === null ? (
        <div className="border border-dashed border-hairline px-6 py-14 text-center">
          <p className="font-display text-base font-bold text-ink">
            填好 endpoint，跑一局试试。
          </p>
          <p className="mt-2 text-sm text-dim">
            左侧选官方模板或自定义参数——开跑后这里逐条亮出谈判证据流，终局出评分卡。
          </p>
        </div>
      ) : events.length === 0 ? (
        <div className="border border-dashed border-hairline px-6 py-10 text-center font-mono text-xs text-dim">
          会话已建立，等待第一轮报价…
        </div>
      ) : (
        <ol className="divide-y divide-hairline border-y-2 border-ink">
          {events.map((e) => (
            <EventRow key={e.seq} e={e} />
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}
