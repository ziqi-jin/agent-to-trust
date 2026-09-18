'use client';

import { useT } from '@/lib/i18n';
import { Reveal } from './motion';
import { SectionHead } from './SectionHead';
import { PersonaCarousel3D } from './fx/PersonaCarousel3D';

/**
 * 理论背书常驻卡（T10）。
 * 展示每个对家人格背后的理论根：label + anchor + 一句话（blurb）+ 出处。
 * 人格的战术细节是服务端秘密；这里只渲染可公开的「话术/立场」。
 * 三个 LLM 人格在前，确定性基线压尾（对照臂）——顺序见 PERSONA_ROWS。
 */
export function CounterpartTheory({ variant = 'card' }: { variant?: 'card' }) {
  const t = useT();

  return (
    <section data-variant={variant} className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <SectionHead
        className="mb-8"
        label={t.theory.eyebrow.replace(/^§\s*—\s*/, '§ — ')}
        title={t.theory.title}
        sub={
          <span className="block border-l-2 border-brass pl-4 italic leading-relaxed text-ink/85">{t.theory.quote}</span>
        }
      />
      <Reveal delay={80}>
        <PersonaCarousel3D />
      </Reveal>
    </section>
  );
}
