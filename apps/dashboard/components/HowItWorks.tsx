import { useT } from '@/lib/i18n';

export function HowItWorks() {
  const t = useT();
  const steps = t.how.steps;

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-14 md:py-16">
      <div className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">§2 — THE LOOP</p>
        <h2 className="mt-2 font-display text-2xl font-black tracking-tight md:text-3xl">
          {t.how.title}
        </h2>
        <p className="mt-2 text-sm text-dim">{t.how.subtitle}</p>
      </div>

      {/* 编号是真序列：01→04 就是证据产生的顺序 */}
      <div className="grid gap-6 md:grid-cols-4 md:gap-4">
        {steps.map((s) => (
          <div key={s.n} className="border-t-2 border-ink pt-4">
            <span className="font-mono text-sm font-semibold text-brass">{s.n}</span>
            <h3 className="mt-2 font-display text-base font-bold text-ink">{s.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-dim">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
