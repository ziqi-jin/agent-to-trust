'use client';

/**
 * /credit/contributing — 贡献指南（0903 老大指令：One more thing，邀请开发者贡献场景/算法/能力）。
 * 内容与仓库根 CONTRIBUTING.md 保持一致（那边是 GitHub 规范入口，这边是站内渲染版）。
 * 整页双语：中文逐字保留，英文高质量面向开发者。
 */
import Link from 'next/link';
import { GITHUB_URL } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const CONTRIB_MD_URL = `${GITHUB_URL}/blob/master/CONTRIBUTING.md`;

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t-2 border-ink pt-6 scroll-mt-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</p>
      <h2 className="mt-2 font-display text-xl font-black tracking-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink/85">{children}</div>
    </section>
  );
}

function Rules({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {items.map((txt, i) => (
        <li key={i} className="flex gap-2">
          <span className="font-mono text-[11px] text-brass">{String(i + 1).padStart(2, '0')}</span>
          <span>{txt}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ContributingPage() {
  const t = useT();
  const c = t.contributing;
  const s = c.sections;

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      {/* 报头 */}
      <header className="bg-ledger text-paper">
        <div className="mx-auto max-w-3xl px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-paper/70">
                Agent Credit Lab · One more thing
              </p>
              <h1 className="mt-1 font-display text-xl font-black uppercase tracking-[0.16em] md:text-2xl">
                {c.title}
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-paper/70">
                {c.subtitle}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <Link
                href="/"
                className="border border-paper/40 px-3 py-1.5 font-mono text-xs text-paper transition hover:border-paper hover:bg-paper/10"
              >
                {c.back}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-6 py-10">
        <p className="text-sm leading-relaxed text-ink/85">
          {c.introPre}
          <strong>{c.introStrong}</strong>
          {c.introPost}
        </p>

        <Section id="c1" label={s.c1.label} title={s.c1.title}>
          <p>
            {s.c1.introPre}
            <code className="font-mono text-[12px] text-ledger">{s.c1.introCode}</code>
            {s.c1.introPost}
          </p>
          <Rules items={s.c1.rules} />
          <p className="pt-1">
            {s.c1.flowPre}
            <code className="font-mono text-[12px] text-ledger">{s.c1.flowCode}</code>
            {s.c1.flowPost}
          </p>
        </Section>

        <Section id="c2" label={s.c2.label} title={s.c2.title}>
          <Rules items={s.c2.rules} />
          <p className="pt-1">{s.c2.flow}</p>
        </Section>

        <Section id="c3" label={s.c3.label} title={s.c3.title}>
          <Rules items={s.c3.rules} />
        </Section>

        <Section id="c4" label={s.c4.label} title={s.c4.title}>
          <Rules items={s.c4.rules} />
          <div className="mt-3 border border-seal/40 bg-seal/5 p-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-seal">
              {s.c4.redlineLabel}
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-ink/85">
              {s.c4.redlines.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
          <p className="pt-1">{s.c4.conduct}</p>
        </Section>

        <Section id="c5" label={s.c5.label} title={s.c5.title}>
          <pre className="overflow-x-auto border border-hairline bg-panel p-3 font-mono text-[12px] leading-relaxed text-ink">
            {s.c5.code}
          </pre>
          <p className="pt-1">
            {s.c5.contributePre}
            <a
              href={`${GITHUB_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ledger underline underline-offset-4"
            >
              {s.c5.contributeLink}
            </a>
            {s.c5.contributePost}
          </p>
        </Section>

        <p className="border-t border-hairline pt-4 font-mono text-xs text-dim">
          {c.syncPre}
          <a href={CONTRIB_MD_URL} target="_blank" rel="noopener noreferrer" className="text-ledger underline underline-offset-4">
            {c.syncLink}
          </a>
          {c.syncPost}
        </p>
      </main>

      <footer className="mt-auto border-t-[3px] border-double border-ink/70 px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-dim">AGENT CREDIT LAB · CONTRIBUTING</p>
          <p className="font-mono text-xs text-dim">Don&apos;t trust an Agent. Test it.</p>
        </div>
      </footer>
    </div>
  );
}
