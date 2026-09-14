'use client';

import { COUNTERPART_THEORY, type CounterpartTheoryKey } from '@acl/core';
import { useLocale, useT } from '@/lib/i18n';

/**
 * 理论背书常驻卡（T10）。
 * 展示每个对家人格背后的理论根：label + anchor + 一句话（blurb）+ 出处。
 * 人格的战术细节是服务端秘密；这里只渲染可公开的「话术/立场」。
 */
// 三个 LLM 人格在前，确定性基线压尾（对照臂）。
const ROWS: CounterpartTheoryKey[] = ['llm-stubborn', 'llm-softer', 'llm-lure', 'scripted'];

export function CounterpartTheory({ variant = 'card' }: { variant?: 'card' }) {
  const t = useT();
  const { locale } = useLocale();

  return (
    <section
      data-variant={variant}
      className="mx-auto w-full max-w-6xl px-6 py-10 md:py-12"
    >
      <div className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          {t.theory.eyebrow}
        </p>
        <h2 className="mt-2 font-display text-2xl font-black tracking-tight md:text-3xl">
          {t.theory.title}
        </h2>
        <p className="mt-3 max-w-3xl border-l-2 border-brass pl-4 font-display text-[15px] italic leading-relaxed text-ink">
          {t.theory.quote}
        </p>
      </div>

      {/* 每人格一行：label + 理论锚 + 一句话 */}
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        {ROWS.map((key) => {
          const entry = COUNTERPART_THEORY[key];
          return (
            <div key={key} className="border-t-2 border-ink pt-4">
              <h3 className="font-display text-base font-bold text-ink">
                {entry.label[locale]}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">{entry.blurb[locale]}</p>
              <p className="mt-2.5 font-mono text-[11px] leading-relaxed text-brass">
                {t.theory.anchorLabel} · {entry.anchor[locale]}
              </p>
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-dim">
                {t.theory.sourceLabel} · {entry.source}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
