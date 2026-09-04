import { type Evidence } from '@/lib/api';
import { useT } from '@/lib/i18n';

const RESULT_ICON: Record<string, string> = {
  success: '✓',
  failure: '✗',
  partial: '◐',
};

const RESULT_COLOR: Record<string, string> = {
  success: 'text-ledger',
  failure: 'text-seal',
  partial: 'text-amber',
};

export function Ticker({ events, nameMap }: { events: Evidence[]; nameMap: Record<string, string> }) {
  const t = useT();
  if (events.length === 0) return null;

  const items = events.map((e) => ({
    id: e.id,
    name: nameMap[e.agentId] ?? e.agentId,
    label: t.dimensions[e.dimension] ?? e.dimension,
    result: t.results[e.result] ?? e.result,
    icon: RESULT_ICON[e.result] ?? '·',
    color: RESULT_COLOR[e.result] ?? 'text-dim',
  }));

  const track = [...items, ...items]; // 无缝循环

  return (
    <section className="border-y border-hairline bg-panel py-3">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6">
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
          {t.ticker.label}
        </span>
        <div className="relative flex-1 overflow-hidden">
          <div className="ticker-track flex w-max gap-8">
            {track.map((it, i) => (
              <span
                key={`${it.id}-${i}`}
                className="flex items-center gap-2 whitespace-nowrap font-mono text-xs text-dim"
              >
                <span className="text-ink">{it.name}</span>
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
