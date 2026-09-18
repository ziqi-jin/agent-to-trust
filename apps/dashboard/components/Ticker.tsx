import { type Evidence } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { AgentMark } from './fx/AgentMark';

const RESULT_ICON: Record<string, string> = {
  success: '✓',
  failure: '✗',
  partial: '◐',
};

const RESULT_TONE: Record<string, string> = {
  success: 'text-info',
  failure: 'text-seal',
  partial: 'text-amber',
};

/** 证据流：数据总线——等宽字一路滚过，带真实证据的 payloadHash 前缀。 */
export function Ticker({ events, nameMap }: { events: Evidence[]; nameMap: Record<string, string> }) {
  const t = useT();
  if (events.length === 0) return null;

  const items = events.map((e) => ({
    id: e.id,
    name: nameMap[e.agentId] ?? e.agentId,
    label: t.dimensions[e.dimension] ?? e.dimension,
    result: t.results[e.result] ?? e.result,
    icon: RESULT_ICON[e.result] ?? '·',
    tone: RESULT_TONE[e.result] ?? 'text-dim',
    hash: e.payloadHash ? e.payloadHash.replace(/^(sha256:|0x)/, '').slice(0, 8) : null,
  }));

  const track = [...items, ...items]; // 无缝循环

  return (
    <section className="relative border-b border-line bg-surface">
      <div className="flex items-stretch">
        <span className="flex shrink-0 items-center gap-2 border-r border-line bg-ledger-soft px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ledger sm:px-6">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ledger/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ledger" />
          </span>
          <span className="hidden sm:inline">{t.ticker.label}</span>
          <span className="sm:hidden">LIVE</span>
        </span>
        <div className="mask-fade-x relative flex flex-1 items-center overflow-hidden">
          <div className="ticker-track flex w-max items-center">
            {track.map((it, i) => (
              <span
                key={`${it.id}-${i}`}
                className="flex items-center gap-2 whitespace-nowrap border-r border-line px-5 font-mono text-[12px] text-dim"
              >
                <AgentMark seed={it.name} size={20} />
                <span className="font-semibold text-ink">{it.name}</span>
                <span className="text-dim/50">/</span>
                <span>{it.label}</span>
                <span className={it.tone}>
                  {it.icon} {it.result}
                </span>
                {it.hash && <span className="text-[11px] text-dim/50">#{it.hash}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
