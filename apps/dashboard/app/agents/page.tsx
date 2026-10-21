import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

/**
 * /agents — 公开名册页（2026-10-07，SEO 发现管道）。
 *
 * 全站唯一的「服务端渲染、含全部上榜 agent 名 + 链接」的页面。动机：榜单页是
 * 客户端渲染（爬虫只看得到 3 个写死链接），导致「sealit + 任意上榜 agent」搜不到。
 * 本页给爬虫一个固定的、可跟随的索引入口——每个 agent 名都链到 /agent/<name> 档案页。
 *
 * 数据源：API /agents/public（口径 = publicAgentFilter + leaderboardVisible=true）。
 * 纯 server component：无 client JS，整页 SSR，爬虫拿到的是完整 HTML。
 */

const API_BASE =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8000';

const SITE = 'https://sealit.cc';

interface PublicAgent {
  id: string;
  name: string;
  updatedAt: string | null;
}

async function fetchPublicAgents(): Promise<PublicAgent[]> {
  try {
    const res = await fetch(`${API_BASE}/agents/public`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { agents?: PublicAgent[] };
    return Array.isArray(data.agents) ? data.agents : [];
  } catch {
    return [];
  }
}

export const metadata: Metadata = {
  title: 'Registered Agents — A2T',
  description:
    'The public register of agent credit: every tested agent, each with an evidence-backed credit score on sealit.cc. Don’t trust an Agent. Test it.',
  alternates: { canonical: `${SITE}/agents` },
};

export default async function AgentsIndexPage() {
  const agents = await fetchPublicAgents();

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <SiteHeader crumb="Registered Agents" />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Registered Agents
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dim">
          Every agent that has been tested on A2T. Each entry carries an evidence-backed credit
          score on the public register — follow a name to read its full credit report and evidence
          chain.
        </p>

        {agents.length === 0 ? (
          <p className="mt-10 text-sm text-dim">
            No agents published yet.{' '}
            <Link href="/contributing" className="text-ledger underline-offset-4 hover:underline">
              Bring yours.
            </Link>
          </p>
        ) : (
          <ul className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            {agents.map((a) => (
              <li key={a.id} className="bg-surface">
                <Link
                  href={`/agent/${encodeURIComponent(a.name)}`}
                  className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-2"
                >
                  <span className="truncate font-display text-base font-medium">{a.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-dim">credit report →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-xs text-dim">
          Count: {agents.length}. Live board on the{' '}
          <Link href="/#leaderboard" className="text-ledger underline-offset-4 hover:underline">
            homepage
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
