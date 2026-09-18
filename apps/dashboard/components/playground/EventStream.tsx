'use client';

import { useEffect, useRef } from 'react';
import { MessagesSquare } from 'lucide-react';
import { AgentMark } from '../fx/AgentMark';
import type { PgActor, PgEvent, PgSession } from '@/lib/api';
import { useT, fill } from '@/lib/i18n';

/** 角色分色（现有档案室色板内）：system 灰 / agent 燃橙 / 对手 琥珀 */
const ACTOR_META: Record<PgActor, { chip: string; bubble: string; avatar: string }> = {
  system: {
    chip: 'bg-panel text-dim',
    bubble: 'border-hairline bg-panel/50',
    avatar: 'bg-panel text-dim',
  },
  agent: {
    chip: 'bg-ledger/10 text-ledger',
    bubble: 'border-ledger/30 bg-ledger-soft',
    avatar: 'bg-ledger text-paper',
  },
  counterpart: {
    chip: 'bg-amber/10 text-amber',
    bubble: 'border-hairline bg-surface',
    avatar: 'bg-amber text-paper',
  },
};

/**
 * 对话式排布：对手在左、被测 agent 在右、系统事件居中——一眼看出谁在出价。
 * 新事件逐条淡入。
 */
function EventRow({ e, seed }: { e: PgEvent; seed: string }) {
  const t = useT();
  const actorLabel = t.playground.stream.actors[e.actor];
  const typeLabel = t.playground.stream.types[e.type] ?? e.type;
  const isFinale = e.type === 'deal' || e.type === 'breakdown';
  const meta = ACTOR_META[e.actor];
  const seq = String(e.seq).padStart(2, '0');

  if (e.actor === 'system') {
    return (
      <li className="flex animate-pop-in justify-center py-1">
        <div
          className={`max-w-[92%] rounded-2xl border px-4 py-2.5 text-center ${
            isFinale ? 'border-ledger bg-ledger-soft text-ink shadow-glow-sm' : meta.bubble
          }`}
        >
          <p className={`font-mono text-[11px] uppercase tracking-wider ${isFinale ? 'text-ledger' : 'text-dim'}`}>
            {seq} · {e.round > 0 ? fill(t.playground.stream.roundPrefix, { n: e.round }) : ''}
            {typeLabel}
          </p>
          <p className={`mt-0.5 break-words text-[13px] leading-relaxed ${'text-ink'}`}>
            {e.text}
            {e.value != null && <span className="ml-2 font-mono font-semibold tabular-nums">{e.value}</span>}
          </p>
        </div>
      </li>
    );
  }

  const mine = e.actor === 'agent';
  return (
    <li className={`flex animate-pop-in items-end gap-2.5 py-1 ${mine ? 'flex-row-reverse' : ''}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-night">
        {mine ? (
          <AgentMark seed={seed} size={32} />
        ) : (
          <AgentMark seed="counterpart" size={32} variant={{ shape: 1, eyes: 1, antenna: 2, accent: '#F5A524' }} />
        )}
      </span>
      <div
        className={`min-w-0 max-w-[80%] rounded-2xl border px-4 py-3 ${meta.bubble} ${
          mine ? 'rounded-br-md' : 'rounded-bl-md'
        } ${isFinale ? 'ring-2 ring-ledger/30' : ''}`}
      >
        <div className={`flex flex-wrap items-center gap-2 ${mine ? 'justify-end' : ''}`}>
          <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${meta.chip}`}>
            {actorLabel}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-dim">
            {e.round > 0 ? fill(t.playground.stream.roundPrefix, { n: e.round }) : ''}
            {typeLabel}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-dim/60">#{seq}</span>
        </div>
        <p className="mt-1.5 break-words text-[13.5px] leading-relaxed text-ink">{e.text}</p>
        {e.value != null && (
          <p className={`mt-2 ${mine ? 'text-right' : ''}`}>
            <span className="inline-block rounded-md border border-line bg-night px-2.5 py-1 font-mono text-sm font-bold tabular-nums text-ink">
              {e.value}
            </span>
          </p>
        )}
      </div>
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
  const t = useT();
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
        <div className="mb-4 flex animate-fade-in items-center gap-3 rounded-full border border-ledger/25 bg-ledger-soft/60 px-4 py-2.5">
          <span className="flex gap-1">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-ledger"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
          <span className="font-mono text-xs tracking-wide text-ledger">{t.playground.stream.negotiating}</span>
        </div>
      )}

      {session === null ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ledger-soft text-ledger">
            <MessagesSquare size={24} />
          </span>
          <p className="mt-5 font-display text-lg font-bold text-ink">{t.playground.stream.emptyTitle}</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-dim">{t.playground.stream.emptyDesc}</p>
        </div>
      ) : events.length === 0 ? (
        <div className="card space-y-3 px-5 py-6">
          {[70, 55, 80].map((w, i) => (
            <div
              key={i}
              className={`h-12 animate-pulse rounded-2xl bg-panel ${i % 2 ? 'ml-auto' : ''}`}
              style={{ width: `${w}%` }}
            />
          ))}
          <p className="pt-1 text-center font-mono text-xs text-dim">{t.playground.stream.waiting}</p>
        </div>
      ) : (
        <ol className="card space-y-2 p-4 md:p-5">
          {events.map((e) => (
            <EventRow key={e.seq} e={e} seed={session?.name || 'your-agent'} />
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}
