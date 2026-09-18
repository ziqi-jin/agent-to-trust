'use client';

import { ArrowLeftRight, FileCheck2, Gauge, Network } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Reveal } from './motion';
import { SectionHead } from './SectionHead';
import { LoopScene3D } from './fx/LoopScene3D';
import { useAutoStep } from './fx/useAutoStep';

const ICONS = [Network, ArrowLeftRight, FileCheck2, Gauge];
const DURATION = 4200;

/**
 * §2 信任是怎么产生的：左侧四步（自动轮播、可点选），右侧等轴测 3D 场景同步演示。
 */
export function HowItWorks() {
  const t = useT();
  const steps = t.how.steps;
  const { step, cycle, paused, select, bind } = useAutoStep(steps.length, DURATION);

  return (
    <section id="how" className="relative border-y border-line bg-surface/40">
      <div aria-hidden className="bg-dots mask-fade-b pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <SectionHead className="mb-10" label="§2 — The Loop" title={t.how.title} sub={t.how.subtitle} />

        <Reveal className="grid grid-cols-1 items-center gap-6 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-8">
          <div {...bind}>
            {/* 步骤列表：编号是真序列，01→04 就是证据产生的顺序 */}
            <ol className="relative space-y-2">
              <span aria-hidden className="absolute bottom-6 left-[27px] top-6 w-px bg-line" />
              {steps.map((s, i) => {
                const Icon = ICONS[i % ICONS.length];
                const active = i === step;
                const done = i < step;
                return (
                  <li key={s.n}>
                    <button
                      type="button"
                      onClick={() => select(i)}
                      aria-current={active ? 'step' : undefined}
                      className={`group relative flex w-full gap-4 overflow-hidden rounded-lg border p-4 text-left transition-all duration-300 ${
                        active ? 'border-ledger/60 bg-ledger-soft shadow-glow-sm' : 'border-transparent hover:border-line hover:bg-surface'
                      }`}
                    >
                      <span
                        className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors duration-300 ${
                          active
                            ? 'border-ledger bg-ledger text-paper'
                            : done
                              ? 'border-ledger/50 bg-paper text-ledger'
                              : 'border-line-strong bg-paper text-dim'
                        }`}
                        style={{ width: 24, height: 24, marginLeft: 0 }}
                      >
                        <Icon size={13} strokeWidth={2.2} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-2">
                          <span className="font-mono text-[11px] text-ledger">{s.n}</span>
                          <span className={`font-display text-lg font-semibold ${active ? 'text-ink' : 'text-ink/75'}`}>
                            {s.title}
                          </span>
                        </span>
                        <span
                          className={`grid transition-all duration-500 ease-out-expo ${
                            active ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                          }`}
                        >
                          <span className="overflow-hidden text-[14px] leading-relaxed text-dim">{s.desc}</span>
                        </span>
                      </span>
                      {/* 本步剩余时间 */}
                      {active && (
                        <span
                          key={`${step}-${cycle}`}
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-ledger"
                          style={{
                            animation: `step-progress ${DURATION}ms linear both`,
                            animationPlayState: paused ? 'paused' : 'running',
                          }}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 pl-4 font-mono text-[11px] text-dim/70">{t.fx.auto}</p>
          </div>

          <div className="hud relative order-first rounded-lg border border-line bg-paper/40 p-2 md:order-none">
            <div className="absolute left-4 top-3 z-10 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]">
              <span className="text-ledger">{steps[step].n}</span>
              <span className="text-ink">{steps[step].title}</span>
            </div>
            <LoopScene3D step={step} cycle={cycle} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
