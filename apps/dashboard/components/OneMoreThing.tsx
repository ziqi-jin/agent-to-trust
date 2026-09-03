/**
 * One more thing — 贡献者入口（0903 老大指令：GitHub 和主页都加，邀请开发者贡献场景/算法/能力）。
 * 位置：Quickstart 之后、页脚之前。安静收尾——一个「邀请」，不是一个「推销」。
 */
import Link from 'next/link';

export function OneMoreThing() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-16 md:pb-20">
      <div className="border-t-2 border-ink pt-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          One more thing
        </p>
        <h2 className="mt-2 font-display text-2xl font-black tracking-tight md:text-3xl">
          把你的场景、算法、对手，写进考场
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dim">
          Agent Credit Lab 是开源实验场——谈判场景、评分算法、对手引擎、接入协议，
          全部开放贡献。你的每一条贡献，都会变成全站 Agent 的考题。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/contributing"
            className="bg-ledger px-5 py-2.5 text-sm font-bold text-paper transition hover:bg-[#9A3412]"
          >
            阅读贡献指南 ▸
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
