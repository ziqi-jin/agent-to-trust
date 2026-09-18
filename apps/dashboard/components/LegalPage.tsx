'use client';

/**
 * 法律页共用骨架（privacy / terms / api-docs）：统一外壳 + 页头 + 左侧目录 + § 分节卡片。
 * 样式与 contributing 页同一设计系统。
 * content 来自 i18n 字典（zh 为源，en 必须补齐）或页面内常量（api-docs，英文开发者面）。
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { GITHUB_URL } from '@/lib/api';
import { CopyButton } from './CopyButton';
import { Reveal } from './motion';
import { PageHero, SiteFooter, SiteHeader } from './SiteChrome';

export interface LegalSection {
  label: string;
  title: string;
  body: string[];
  /** 可选：mono 代码块（端点清单、命令示例），逐行 join 渲染。 */
  code?: string[];
}

export interface LegalContent {
  title: string;
  subtitle: string;
  back: string;
  updated: string;
  sections: LegalSection[];
  contactPre: string;
  contactLink: string;
  contactPost: string;
}

export function LegalPage({ legal, doc }: { legal: LegalContent; doc: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <SiteHeader crumb={doc} />

      <main id="main" className="flex-1">
        <PageHero eyebrow={`A2T · ${doc}`} title={legal.title} subtitle={legal.subtitle}>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/" className="btn-secondary group px-4 py-2 text-[13px]">
              <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
              {legal.back.replace(/^←\s*/, '')}
            </Link>
            <span className="rounded-[4px] border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-dim">{legal.updated}</span>
          </div>
        </PageHero>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
          {/* 目录 */}
          <nav className="hidden lg:block" aria-label="Sections">
            <ul className="sticky top-24 space-y-1 border-l border-hairline">
              {legal.sections.map((sec, i) => (
                <li key={sec.label}>
                  <a
                    href={`#sec-${i}`}
                    className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-[13px] text-dim transition-colors hover:border-ledger hover:text-ink"
                  >
                    <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-dim/70">
                      {sec.label}
                    </span>
                    {sec.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-5">
            {legal.sections.map((sec, i) => (
              <Reveal key={sec.label} delay={Math.min(i, 4) * 60}>
                <section id={`sec-${i}`} className="card scroll-mt-24 p-6 md:p-8">
                  <p className="eyebrow">{sec.label}</p>
                  <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">{sec.title}</h2>
                  <div className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-ink/85">
                    {sec.body.map((para, j) => (
                      <p key={j}>{para}</p>
                    ))}
                  </div>
                  {sec.code && sec.code.length > 0 && (
                    <div className="relative mt-4">
                      <pre className="overflow-x-auto rounded-md border border-line bg-night p-4 pr-20 font-mono text-[12px] leading-relaxed text-ink">
                        {sec.code.map((line, j) => {
                          const hash = line.indexOf('#');
                          return (
                            <span key={j} className="block whitespace-pre">
                              {hash >= 0 ? (
                                <>
                                  {line.slice(0, hash)}
                                  <span className="text-dim/70">{line.slice(hash)}</span>
                                </>
                              ) : (
                                line || ' '
                              )}
                            </span>
                          );
                        })}
                      </pre>
                      <CopyButton text={sec.code.join('\n')} className="absolute right-2.5 top-2.5" dark />
                    </div>
                  )}
                </section>
              </Reveal>
            ))}

            <p className="px-1 pt-2 text-[13px] text-dim">
              {legal.contactPre}
              <a
                href={`${GITHUB_URL}/issues`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-ledger underline decoration-ledger/30 underline-offset-4 transition hover:decoration-ledger"
              >
                {legal.contactLink}
              </a>
              {legal.contactPost}
            </p>
          </div>
        </div>
      </main>

      <SiteFooter tagline={`A2T · ${doc}`} />
    </div>
  );
}
