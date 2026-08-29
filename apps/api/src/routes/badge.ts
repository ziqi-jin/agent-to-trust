/**
 * GET /badge/:agentId.svg — README 徽章（增长飞轮核心）。
 *
 * 一行嵌入：[![ACL](https://reeftavern.cc/credit/api/badge/<agentId>.svg)](报告页 URL)
 * 动态生成：分数 + verified 徽标；60s 缓存。
 */
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agents, creditScores } from '../db/schema';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function badgeSvg(label: string, value: string, accent: string): string {
  const labelW = 36;
  const valueW = Math.ceil(12 + value.length * 7.4);
  const w = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" role="img" aria-label="ACL: ${esc(value)}">
  <linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".25"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="28" rx="5"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="28" fill="#1b2740"/>
    <rect x="${labelW}" width="${valueW}" height="28" fill="#0d1526"/>
    <rect width="${w}" height="28" fill="url(#g)"/>
  </g>
  <g text-anchor="middle" font-family="JetBrains Mono,Consolas,monospace" font-size="12" font-weight="700">
    <text x="${labelW / 2}" y="18.5" fill="${accent}">${esc(label)}</text>
    <text x="${labelW + valueW / 2}" y="18.5" fill="#e2e8f0">${esc(value)}</text>
  </g>
</svg>`;
}

export async function badgeRoutes(app: FastifyInstance) {
  app.get('/badge/:agentId.svg', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    if (!agent) {
      reply.type('image/svg+xml').header('cache-control', 'no-store');
      return badgeSvg('ACL', 'agent not found', '#64748b');
    }
    const score = await app.db.query.creditScores.findFirst({
      where: eq(creditScores.agentId, agentId),
      orderBy: [desc(creditScores.createdAt)],
    });
    const verified = agent.verificationLevel === 'verified';
    const value =
      score?.score != null ? `score ${score.score}${verified ? ' · verified' : ''}` : 'untested';
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=60');
    return badgeSvg('ACL', value, verified ? '#f59e0b' : '#94a3b8');
  });
}
