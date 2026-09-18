'use client';

/**
 * /credit/contributing — 贡献指南（0903 老大指令：One more thing，邀请开发者贡献场景/算法/能力）。
 * 内容与仓库根 CONTRIBUTING.md 保持一致（那边是 GitHub 规范入口，这边是站内渲染版）。
 * 整页双语：中文逐字保留，英文高质量面向开发者。
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { GITHUB_URL } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CopyButton } from '@/components/CopyButton';
import { Reveal } from '@/components/motion';
import { PageHero, SiteFooter, SiteHeader } from '@/components/SiteChrome';
const CONTRIB_MD_URL = `${GITHUB_URL}/blob/master/CONTRIBUTING.md`;

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section id={id} className="card scroll-mt-24 p-6 md:p-8">
        <p className="eyebrow">{label}</p>
        <h2 className="mt-2 font-display text-2xl font-black tracking-tight text-ink">{title}</h2>
        <div className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-ink/85">{children}</div>
      </section>
    </Reveal>
  );
}

function Rules({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-2">
      {items.map((txt, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 grid h-5 w-7 shrink-0 place-items-center rounded-md bg-brass/10 font-mono text-[11px] font-semibold text-brass">
            {String(i + 1).padStart(2, '0')}
          </span>
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
      <SiteHeader crumb="Contributing" />

      <PageHero eyebrow="A2T · Open Source" title={c.title} subtitle={c.subtitle}>
        <div className="mt-6">
          <Link href="/" className="btn-secondary group px-4 py-2 text-[13px]">
            <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
            {c.back.replace(/^←\s*/, '')}
          </Link>
        </div>
      </PageHero>

      <main id="main" className="mx-auto w-full max-w-4xl flex-1 space-y-5 px-4 py-12 sm:px-6">
        <p className="rounded-2xl border border-ledger/20 bg-ledger-soft/60 p-5 text-[15px] leading-relaxed text-ink/85">
          {c.introPre}
          <strong>{c.introStrong}</strong>
          {c.introPost}
        </p>

        <Section id="c1" label={s.c1.label} title={s.c1.title}>
          <p>
            {s.c1.introPre}
            <code className="rounded bg-ledger-soft px-1 py-0.5 font-mono text-[12px] text-ledger">{s.c1.introCode}</code>
            {s.c1.introPost}
          </p>
          <Rules items={s.c1.rules} />
          <p className="pt-1">
            {s.c1.flowPre}
            <code className="rounded bg-ledger-soft px-1 py-0.5 font-mono text-[12px] text-ledger">{s.c1.flowCode}</code>
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
          <div className="mt-3 rounded-xl border border-seal/25 bg-seal/5 p-4">
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
          <div className="relative">
            <pre className="whitespace-pre-wrap break-words rounded-md border border-line bg-night p-4 pr-20 font-mono text-[12px] leading-relaxed text-ink">
              {s.c5.code}
            </pre>
            <CopyButton text={s.c5.code} className="absolute right-2.5 top-2.5" dark />
          </div>
          <p className="pt-1">
            {s.c5.contributePre}
            <a
              href={`${GITHUB_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ledger underline decoration-ledger/30 underline-offset-4 transition hover:decoration-ledger"
            >
              {s.c5.contributeLink}
            </a>
            {s.c5.contributePost}
          </p>
        </Section>

        <Section id="c6" label={s.c6.label} title={s.c6.title}>
          <p>{s.c6.intro}</p>
          <ul className="mt-2 space-y-2">
            {s.c6.gaps.map((g) => (
              <li key={g.dim} className="rounded-xl border border-seal/20 bg-seal/[0.04] px-4 py-3">
                <span className="font-mono text-[12px] font-semibold text-seal">{g.dim}</span>
                <p className="mt-0.5 text-[13px] text-ink/85">{g.need}</p>
              </li>
            ))}
          </ul>
          <p className="pt-2 font-semibold text-ink">{s.c6.thinTitle}</p>
          <ul className="space-y-1">
            {s.c6.thin.map((txt, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-7 shrink-0 place-items-center rounded-md bg-brass/10 font-mono text-[11px] font-semibold text-brass">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{txt}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-md border border-line bg-night p-4 font-mono text-[11px] leading-relaxed text-dim">
            {s.c6.hint}
          </p>
        </Section>

        <p className="px-1 pt-3 text-[13px] text-dim">
          {c.syncPre}
          <a href={CONTRIB_MD_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-ledger underline decoration-ledger/30 underline-offset-4 transition hover:decoration-ledger">
            {c.syncLink}
          </a>
          {c.syncPost}
        </p>
      </main>

      <SiteFooter tagline="A2T · CONTRIBUTING" />
    </div>
  );
}
