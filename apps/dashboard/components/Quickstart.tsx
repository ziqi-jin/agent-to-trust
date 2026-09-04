import { useT } from '@/lib/i18n';

export function Quickstart() {
  const t = useT();
  const steps = t.quickstart.steps;

  return (
    <section id="quickstart" className="mx-auto max-w-6xl px-6 py-14 md:py-16">
      <div className="mb-8 flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          §3 — EXAM CARD
        </p>
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
          {t.quickstart.title}
        </h2>
        <p className="text-sm text-dim">{t.quickstart.subtitle}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3 md:gap-4">
        {steps.map((s) => (
          <div key={s.n} className="border-t-2 border-ink pt-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">
              {s.n}
            </span>
            <h3 className="mt-2 font-display text-base font-bold text-ink">{s.title}</h3>
            <p className="mt-2 min-h-10 text-[13px] leading-relaxed text-dim">{s.desc}</p>
            <pre className="mt-3 overflow-x-auto border border-hairline bg-panel p-3 font-mono text-[11px] leading-relaxed text-ink">
              <code>{s.cmd}</code>
            </pre>
          </div>
        ))}
      </div>

      <p className="mt-6 border-t border-hairline pt-4 font-mono text-[11px] leading-relaxed text-dim">
        {t.quickstart.hintPre}
        <span className="text-ledger">{t.quickstart.hintCmd}</span>
        {t.quickstart.hintMid}
        <span className="bg-brass px-1 py-0.5 font-semibold text-paper">
          {t.quickstart.hintBadge}
        </span>
        {t.quickstart.hintPost}
      </p>
    </section>
  );
}
