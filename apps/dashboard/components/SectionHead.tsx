'use client';

/**
 * 分节标头（控制台式）：橙色 § 编号签 + 解码动效的分册名 + 一条随进入视口延展的信号线，
 * 下接大标题与说明。label 形如「§1 — The Register」，按「 — 」拆成编号与分册名。
 */
import type { ReactNode } from 'react';
import { Reveal, Scramble } from './motion';

export function SectionHead({
  label,
  title,
  sub,
  aside,
  className = '',
}: {
  label: string;
  title: ReactNode;
  sub?: ReactNode;
  /** 标题行右侧的控件（如榜单切换）。 */
  aside?: ReactNode;
  className?: string;
}) {
  const [index, ...rest] = label.split(/\s+—\s+/);
  const kicker = rest.join(' — ');
  return (
    <Reveal className={`group/reveal ${className}`}>
      <div className="flex items-center gap-3">
        <span className="shrink-0 rounded-[3px] border border-ledger/60 bg-ledger-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ledger">
          {index}
        </span>
        {kicker && (
          <Scramble
            text={kicker.toUpperCase()}
            className="shrink-0 font-mono text-[11px] font-medium tracking-[0.2em] text-dim"
          />
        )}
        <span
          aria-hidden
          className="h-px flex-1 origin-left scale-x-0 bg-gradient-to-r from-ledger/70 via-line-strong to-transparent transition-transform delay-200 duration-[1400ms] ease-out-expo group-data-[shown=true]/reveal:scale-x-100"
        />
      </div>
      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="section-title">{title}</h2>
          {sub && <div className="section-sub">{sub}</div>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </Reveal>
  );
}
