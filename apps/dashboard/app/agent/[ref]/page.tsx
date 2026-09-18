import type { Metadata } from 'next';
import { AgentReportPage } from '@/components/AgentReportPage';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

/**
 * /agent/[ref] — Agent 信用报告页（2026-09-17，任务②）。
 *
 * 背景：badge 早就支持按注册名（/badge/name/:name.svg），但点进去没有可读的档案页，
 * 「分数 → 证据 → 可复核」这条核心叙事在网页上是断头的。本页把 AgentDetail 提升为
 * 独立路由，并支持「注册名」直接直达（README 徽章挂的就是名字）。
 *
 * ref 解析顺序：by-name 优先（名字是给人看的），再退到 uuid（id 是给机器看的）。
 * 两条都是公开读；解析不到也要渲染（AgentDetail 自己走 notFound 态）。
 */

const API_BASE =
  // 服务端（generateMetadata）拿不到相对路径，必须绝对地址：容器内走服务名 api:8000。
  // 客户端仍用 NEXT_PUBLIC_API_URL（/api，同源走 nginx）。
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8000';

interface AgentLite {
  id: string;
  name: string;
}

async function fetchAgent(ref: string): Promise<AgentLite | null> {
  const urls = [
    `${API_BASE}/agents/by-name/${encodeURIComponent(ref)}`,
    `${API_BASE}/agents/${encodeURIComponent(ref)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return (await res.json()) as AgentLite;
    } catch {
      // 单源失败退下一个；两个都失败 → null（页面渲染 notFound 态，不 500）
    }
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  const agent = await fetchAgent(ref);
  if (!agent) {
    return { title: 'Agent not found — A2T' };
  }
  return {
    title: `${agent.name} — Agent Credit Report`,
    description: `${agent.name}'s credit report on the public register: evidence-backed score, dimension breakdown, and the full evidence chain. Don't trust an Agent. Test it.`,
  };
}

export default async function AgentReportRoute({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const agent = await fetchAgent(ref);
  // 名字命中 → 用 id 渲染（详情/证据都按 id 查）；未命中 → 原样传，让 AgentDetail 报 notFound
  const agentId = agent?.id ?? ref;

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <SiteHeader crumb="Agent Report" />
      <div id="main" className="flex-1">
        <AgentReportPage agentId={agentId} />
      </div>
      <SiteFooter />
    </div>
  );
}
