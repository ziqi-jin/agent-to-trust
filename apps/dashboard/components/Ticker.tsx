import { DIMENSION_LABELS, RESULT_LABELS, type Evidence } from '@/lib/api';

const RESULT_ICON: Record<string, string> = {
  success: '✓',
  failure: '✗',
  partial: '◐',
};

const RESULT_COLOR: Record<string, string> = {
  success: 'text-accent',
  failure: 'text-danger',
  partial: 'text-amber',
};

export function Ticker({ events, nameMap }: { events: Evidence[]; nameMap: Record<string, string> }) {
  if (events.length === 0) return null;

  const items = events.map((e) => ({
    id: e.id,
    name: nameMap[e.agentId] ?? e.agentId,
    label: DIMENSION_LABELS[e.dimension] ?? e.dimension,
    result: RESULT_LABELS[e.result] ?? e.result,
    icon: RESULT_ICON[e.result] ?? '·',
    color: RESULT_COLOR[e.result] ?? 'text-dim',
  }));

  const track = [...items, ...items]; // 无缝循环

  return (
    <section className="border-t border-edge bg-surface/40 py-3">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6">
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-dim">
          证据流 · evidence feed
        </span>
        <div className="relative flex-1 overflow-hidden">
          <div className="ticker-track flex w-max gap-8">
            {track.map((it, i) => (
              <span key={`${it.id}-${i}`} className="flex items-center gap-2 whitespace-nowrap font-mono text-xs text-dim">
                <span className="text-bright/80">{it.name}</span>
                <span>·</span>
                <span>{it.label}</span>
                <span className={it.color}>
                  {it.icon} {it.result}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
