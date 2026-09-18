/**
 * 贡献者入口（0903 老大指令：GitHub 和主页都加，邀请开发者贡献场景/算法/能力）。
 * 位置：Quickstart 之后、页脚之前。安静收尾——一个「邀请」，不是一个「推销」。
 * 注：眉标不再使用 "One more thing"（该短语在部分法域是第三方注册商标），改用自有措辞。
 * 右侧 3D：四个可贡献模块轮流接入考场核心。
 */
import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { SectionHead } from './SectionHead';
import { ModuleCubes3D } from './fx/ModuleCubes3D';

export function OneMoreThing() {
  const t = useT();
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <div className="hud relative overflow-hidden rounded-lg border border-ledger/40 bg-surface px-6 py-12 sm:px-10 md:px-12 md:py-14">
        {/* 背景：网格 + 右下橙色辉光 */}
        <div aria-hidden className="bg-tech-grid pointer-events-none absolute inset-0 opacity-70" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_70%_at_85%_60%,rgba(255,106,31,0.18),transparent_70%)]"
        />

        <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <SectionHead label="§4 — Open Source" title={t.oneMore.title} sub={t.oneMore.desc} />
            <ul className="mt-6 flex flex-wrap gap-2">
              {t.oneMore.modules.map((m, i) => (
                <li key={m} className="chip border-ledger/40 bg-ledger-soft px-2 py-1 text-ledger">
                  <span className="text-dim">0{i + 1}</span> {m}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/contributing" className="btn-primary group w-full px-6 py-3 sm:w-auto">
                {t.oneMore.cta.replace(/\s*▸\s*$/, '')}
                <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
              <a
                href="https://github.com/ziqi-jin/agent-to-trust/blob/master/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary w-full font-mono text-[13px] sm:w-auto"
              >
                CONTRIBUTING.md
                <ArrowUpRight size={14} />
              </a>
              <a
                href="https://reeftavern.cc/market"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary w-full font-mono text-[13px] sm:w-auto"
              >
                {t.oneMore.tavern}
              </a>
            </div>
          </div>
          <ModuleCubes3D />
        </div>
      </div>
    </section>
  );
}
