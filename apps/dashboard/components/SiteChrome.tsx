'use client';

/**
 * 全站统一外壳：吸顶玻璃导航 + 页脚。
 * 首页传 onAnchor（站内锚点由页面自己处理：从详情态回到榜单再滚动）；
 * 子页不传，锚点走 Link 到 `/#id`（Next 负责拼 basePath）。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { GITHUB_URL } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fmtStars, useGithubStars } from '@/lib/useGithubStars';
import { LanguageSwitcher } from './LanguageSwitcher';

export function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** 品牌标：一枚迷你印章（双圈 + 对勾）。 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-md border border-ledger bg-ledger-soft text-ledger shadow-glow-sm"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.72} height={size * 0.72} fill="none" aria-hidden>
        <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="8.5" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6 1.8" />
        <path d="M12 16.4l2.7 2.7L20.3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

type NavItem = { label: string; anchor?: string; href?: string };

export function SiteHeader({
  onAnchor,
  crumb,
}: {
  /** 首页：锚点交给页面处理（详情态需先回到榜单）。 */
  onAnchor?: (id: string) => void;
  /** 子页：品牌后的一段面包屑（如 Playground / API）。 */
  crumb?: string;
}) {
  const t = useT();
  const stars = useGithubStars();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 路由切换 / 宽屏时收起移动菜单
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const close = () => mq.matches && setOpen(false);
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, [open]);

  const items: NavItem[] = [
    { label: t.nav.leaderboard, anchor: 'leaderboard' },
    { label: t.nav.how, anchor: 'how' },
    { label: t.nav.docs, anchor: 'quickstart' },
    { label: 'Playground', href: '/playground' },
    { label: t.nav.apiDocs, href: '/api-docs' },
  ];

  const linkCls =
    'whitespace-nowrap rounded-[4px] px-3 py-1.5 text-[13.5px] font-medium text-dim transition-colors hover:bg-panel hover:text-ink';

  const renderItem = (it: NavItem, cls: string) => {
    if (it.anchor && onAnchor) {
      return (
        <button
          key={it.label}
          type="button"
          className={cls}
          onClick={() => {
            setOpen(false);
            onAnchor(it.anchor!);
          }}
        >
          {it.label}
        </button>
      );
    }
    return (
      <Link
        key={it.label}
        href={it.href ?? `/#${it.anchor}`}
        className={cls}
        onClick={() => setOpen(false)}
      >
        {it.label}
      </Link>
    );
  };

  return (
    <header
      className={`glass sticky top-0 z-40 border-b transition-[border-color,box-shadow] duration-300 ${
        scrolled || open ? 'border-line-strong' : 'border-line'
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ledger focus:px-3 focus:py-1.5 focus:text-xs focus:text-paper"
      >
        {t.nav.skip}
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="A2T home">
            <BrandMark />
            <span className="flex flex-col leading-none">
              <span className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink">A2T</span>
              <span className="mt-1 hidden font-mono text-[11px] uppercase tracking-[0.14em] text-dim xl:block">
                Public Register of Agent Credit
              </span>
            </span>
          </Link>
          {crumb && (
            <span className="hidden min-w-0 items-center gap-3 sm:flex md:hidden xl:flex">
              <span aria-hidden className="h-5 w-px rotate-12 bg-hairline" />
              <span className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
                {crumb}
              </span>
            </span>
          )}
        </div>

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
          {items.map((it) => renderItem(it, linkCls))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher className="hidden sm:inline-grid" />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface pl-3 pr-2 text-xs font-semibold text-ink transition hover:border-ledger/60 hover:-translate-x-px hover:-translate-y-px active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          >
            <GithubIcon size={13} />
            <span>Star</span>
            <span className="rounded-[3px] bg-panel px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-dim">
              {stars != null ? fmtStars(stars) : '★'}
            </span>
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={t.nav.menu}
            className="grid h-8 w-8 place-items-center rounded-md border border-line-strong bg-surface text-ink md:hidden"
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {/* 移动端下拉菜单 */}
      {open && (
        <div className="animate-fade-in border-t border-hairline px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            {items.map((it) =>
              renderItem(
                it,
                'flex items-center justify-between border-b border-dashed border-line px-1 py-3.5 text-left font-display text-xl font-medium text-ink transition hover:text-ledger',
              ),
            )}
          </nav>
          <LanguageSwitcher className="mt-3" />
        </div>
      )}
    </header>
  );
}

export function SiteFooter({ tagline }: { tagline?: string }) {
  const t = useT();
  const linkCls = 'py-1.5 text-dim transition-colors hover:text-ledger';
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark size={28} />
            <span className="font-display text-lg font-semibold">A2T</span>
          </div>
          <p className="mt-3 max-w-sm font-display text-xl font-semibold leading-snug text-ink sm:text-2xl">
            Don&apos;t trust an Agent. <span className="whitespace-nowrap text-ledger">Test it.</span>
          </p>
          <p className="mt-2 font-mono text-[11px] text-dim">{tagline ?? t.footer.register}</p>
        </div>
        <div className="flex flex-col items-start gap-0.5 text-sm">
          <span className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-ink">Product</span>
          <Link href="/#leaderboard" className={linkCls}>{t.nav.leaderboard}</Link>
          <Link href="/playground" className={linkCls}>Playground</Link>
          <Link href="/api-docs" className={linkCls}>API</Link>
          <Link href="/contributing" className={linkCls}>Contributing</Link>
        </div>
        <div className="flex flex-col items-start gap-0.5 text-sm">
          <span className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-ink">Resources</span>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={`${linkCls} inline-flex items-center gap-1`}>
            GitHub <ArrowUpRight size={13} />
          </a>
          <a href="/llms.txt" target="_blank" rel="noopener noreferrer" className={linkCls}>
            {t.footer.agentEntry}
          </a>
          <Link href="/privacy" className={linkCls}>{t.footer.privacy}</Link>
          <Link href="/terms" className={linkCls}>{t.footer.terms}</Link>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 font-mono text-[11px] text-dim sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} A2T · MIT License</span>
          <span>baseline-v0.2 · seed 42 · deterministic</span>
        </div>
      </div>
    </footer>
  );
}

/** 子页通用标题区（playground / legal / contributing）。 */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div aria-hidden className="bg-dots mask-fade-b pointer-events-none absolute inset-0" />
      <div aria-hidden className="bg-signal-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 md:pb-14 md:pt-16">
        <p className="eyebrow animate-fade-up">
          <span className="h-1.5 w-1.5 rounded-full bg-ledger" />
          {eyebrow}
        </p>
        <h1 className="mt-4 animate-fade-up font-display text-5xl font-semibold tracking-[-0.03em] text-ink [animation-delay:80ms] md:text-6xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-4 max-w-2xl animate-fade-up text-[15px] leading-relaxed text-dim [animation-delay:160ms]">
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}
