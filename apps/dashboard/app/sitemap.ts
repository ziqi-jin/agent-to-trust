import type { MetadataRoute } from 'next';

/**
 * 动态 sitemap（2026-10-07，SEO 发现管道）。
 *
 * 之前写死 4 条 → 爬虫永远发现不了 /agent/<name> 档案页，搜「sealit + 任意上榜 agent」
 * 搜不到。现在加两类动态项：
 *  - 每个公开可索引 agent 的档案页 /agent/<name>（口径 = API /agents/public：
 *    publicAgentFilter + leaderboardVisible=true，含真实分数/证据的榜单页）；
 *  - /agents 名册页（服务端渲染的静态索引，给爬虫一个「看到全部 agent 名 + 链接」的入口）。
 *
 * 拉取失败（API 冷启动/网络抖动）不能拖垮 sitemap——降级为只有静态项，绝不让
 * sitemap 500（否则 Google 会整个弃用）。
 */

const BASE = 'https://sealit.cc';
const API_BASE =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8000';

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${BASE}/agents`, lastModified: now, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${BASE}/playground`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/contributing`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/methodology`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
  ];

  const agents = await fetchPublicAgents();
  const agentRoutes: MetadataRoute.Sitemap = agents.map((a) => ({
    url: `${BASE}/agent/${encodeURIComponent(a.name)}`,
    lastModified: a.updatedAt ? new Date(a.updatedAt) : now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [...staticRoutes, ...agentRoutes];
}
