/**
 * One more thing — 贡献者入口（0903 老大指令：GitHub 和主页都加，邀请开发者贡献场景/算法/能力）。
 * 位置：Quickstart 之后、页脚之前。安静收尾——一个「邀请」，不是一个「推销」。
 */
import Link from 'next/link';
import { useT } from '@/lib/i18n';

export function OneMoreThing() {
  const t = useT();
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-16 md:pb-20">
      <div className="border-t-2 border-ink pt-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          One more thing
        </p>
        <h2 className="mt-2 font-display text-2xl font-black tracking-tight md:text-3xl">
          {t.oneMore.title}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dim">
          {t.oneMore.desc}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/contributing"
            className="bg-ledger px-5 py-2.5 text-sm font-bold text-paper transition hover:bg-[#9A3412]"
          >
            {t.oneMore.cta}
          </Link>
          <a
            href="https://github.com/ziqi-jin/open-agent-credit-lab/blob/master/CONTRIBUTING.md"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-hairline px-5 py-2.5 font-mono text-sm text-ink transition hover:border-ink"
          >
            CONTRIBUTING.md @ GitHub ↗
          </a>
        </div>
      </div>
    </section>
  );
}
