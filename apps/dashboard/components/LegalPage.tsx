'use client';

/**
 * 法律页共用骨架（privacy / terms / api-docs）：报头 + § 分节 + 联系行 + 页脚。
 * 样式与 contributing 页同一设计系统（0907 定稿）。
 * content 来自 i18n 字典（zh 为源，en 必须补齐）或页面内常量（api-docs，英文开发者面）。
 */
import Link from 'next/link';
import { GITHUB_URL } from '@/lib/api';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

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
      {/* 报头 */}
      <header className="bg-ledger text-paper">
        <div className="mx-auto max-w-3xl px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-paper/70">
                A2T · {doc}
              </p>
              <h1 className="mt-1 font-display text-xl font-black uppercase tracking-[0.16em] md:text-2xl">
                {legal.title}
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-paper/70">
                {legal.subtitle}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <Link
                href="/"
                className="border border-paper/40 px-3 py-1.5 font-mono text-xs text-paper transition hover:border-paper hover:bg-paper/10"
              >
                {legal.back}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-6 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">{legal.updated}</p>

        {legal.sections.map((sec) => (
          <section key={sec.label} className="border-t-2 border-ink pt-6 scroll-mt-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{sec.label}</p>
            <h2 className="mt-2 font-display text-xl font-black tracking-tight text-ink">{sec.title}</h2>
            <div className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink/85">
              {sec.body.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            {sec.code && sec.code.length > 0 && (
              <pre className="mt-3 whitespace-pre-wrap break-words border border-hairline bg-panel p-3 font-mono text-[12px] leading-relaxed text-ink">
                {sec.code.join('\n')}
              </pre>
            )}
          </section>
        ))}

        <p className="border-t border-hairline pt-4 font-mono text-xs text-dim">
          {legal.contactPre}
          <a
            href={`${GITHUB_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ledger underline underline-offset-4"
          >
            {legal.contactLink}
          </a>
          {legal.contactPost}
        </p>
      </main>

      <footer className="mt-auto border-t-[3px] border-double border-ink/70 px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-dim">A2T · {doc}</p>
          <p className="font-mono text-xs text-dim">Don&apos;t trust an Agent. Test it.</p>
        </div>
      </footer>
    </div>
  );
}
