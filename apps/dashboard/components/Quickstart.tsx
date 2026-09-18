'use client';

import { ArrowUpRight, FileText } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { reportPath } from '@/lib/api';
import { CopyButton } from './CopyButton';
import { Reveal } from './motion';
import { SectionHead } from './SectionHead';
import { ExamFlow3D } from './fx/ExamFlow3D';
import { useAutoStep } from './fx/useAutoStep';

const DURATION = 5200;

/** 命令区：终端底等宽，`$` 提示符 + 注释行降灰。 */
function Shell({ cmd }: { cmd: string }) {
  return (
    <div className="relative rounded-md border border-line bg-night">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-info shadow-glow-green" />
        shell
      </div>
      <pre className="whitespace-pre-wrap break-words px-3.5 py-3 pr-20 font-mono text-[12px] leading-relaxed">
        <code>
          {cmd.split('\n').map((line, i) => {
            const comment = line.trimStart().startsWith('#');
            return (
              <span key={i} className={`block ${comment ? 'text-dim/70' : 'text-ink'}`}>
                {!comment && <span className="select-none text-ledger">$ </span>}
                {line}
              </span>
            );
          })}
        </code>
      </pre>
      <CopyButton text={cmd} className="absolute right-2.5 top-9" dark />
    </div>
  );
}

/**
 * §3 送考：左侧三步（自动轮播、可点选；当前步展开命令，可一键复制），右侧 3D 场景同步演示。
 */
export function Quickstart() {
  const t = useT();
  const steps = t.quickstart.steps;
  const { step, cycle, paused, select, bind } = useAutoStep(steps.length, DURATION);

  return (
    <section id="quickstart" className="relative border-y border-line">
      <div aria-hidden className="bg-tech-grid mask-fade-b pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <SectionHead className="mb-10" label="§3 — Exam Card" title={t.quickstart.title} sub={t.quickstart.subtitle} />

        <Reveal className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-8">
          <ol className="space-y-2" {...bind}>
            {steps.map((s, i) => {
              const active = i === step;
              return (
                <li
                  key={s.n}
                  className={`relative overflow-hidden rounded-lg border transition-all duration-300 ${
                    active ? 'border-ledger/60 bg-surface shadow-glow-sm' : 'border-line bg-surface/50 hover:border-line-strong'
                  }`}
                >
                  <button type="button" onClick={() => select(i)} className="flex w-full items-start gap-4 p-4 text-left">
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md font-mono text-sm font-bold transition-colors duration-300 ${
                        active ? 'bg-ledger text-paper' : 'border border-line-strong text-dim'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-ledger">{s.n}</span>
                      <span className={`block font-display text-lg font-semibold ${active ? 'text-ink' : 'text-ink/75'}`}>
                        {s.title}
                      </span>
                    </span>
                  </button>
                  {/* 当前步：说明 + 可复制命令 */}
                  <div
                    className={`grid transition-all duration-500 ease-out-expo ${active ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                  >
                    <div className="overflow-hidden">
                      <div className="space-y-3 px-4 pb-4 sm:pl-16">
                        <p className="text-[14px] leading-relaxed text-dim">{s.desc}</p>
                        <Shell cmd={s.cmd} />
                      </div>
                    </div>
                  </div>
                  {active && (
                    <span
                      key={`${step}-${cycle}`}
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-ledger"
                      style={{ animation: `step-progress ${DURATION}ms linear both`, animationPlayState: paused ? 'paused' : 'running' }}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          <div className="hud relative order-first rounded-lg border border-line bg-paper/40 p-2 lg:sticky lg:top-24 lg:order-none">
            <div className="absolute left-4 top-3 z-10 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]">
              <span className="text-ledger">{steps[step].n}</span>
              <span className="text-ink">{t.fx.stations[step]}</span>
            </div>
            <ExamFlow3D step={step} cycle={cycle} />
          </div>
        </Reveal>

        {/* 零门槛入口：不想跑命令，也先看一份真报告（证据链长什么样） */}
        <Reveal delay={120} className="mt-10 flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-surface/70 p-4">
          <span className="mr-2 inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-ink">
            <FileText size={15} className="text-ledger" />
            {t.quickstart.sampleLabel}
          </span>
          {t.quickstart.sampleReports.map((r) => (
            <a
              key={r.ref}
              href={reportPath(r.ref)}
              className="group inline-flex items-center gap-1 rounded-[4px] border border-line-strong bg-night px-3 py-1.5 font-mono text-[12px] text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-ledger hover:text-ledger"
            >
              {r.label}
              <ArrowUpRight size={13} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          ))}
        </Reveal>

        <div className="mt-6 space-y-2 font-mono text-[12px] leading-relaxed text-dim">
          <p>
            {t.quickstart.hintPre}
            <span className="rounded-[3px] bg-ledger-soft px-1 py-0.5 text-ledger">{t.quickstart.hintCmd}</span>
            {t.quickstart.hintMid}
            <span className="rounded-[3px] bg-brass px-1.5 py-0.5 font-semibold text-paper">{t.quickstart.hintBadge}</span>
            {t.quickstart.hintPost}
          </p>
          <p>{t.quickstart.hintDemo}</p>
        </div>
      </div>
    </section>
  );
}
