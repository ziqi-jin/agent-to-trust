/**
 * GET /badge/:agentId.svg — README 徽章（增长飞轮核心）。
 *
 * 一行嵌入：[![A2T](https://reeftavern.cc/credit/api/badge/<agentId>.svg)](报告页 URL)
 * 动态生成：分数 + verified 徽标；60s 缓存。
 */
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { agents, creditScores } from '../db/schema';
import { createRateLimiter } from '../services/rateLimit';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function badgeSvg(label: string, value: string, accent: string): string {
  const labelW = 36;
  const valueW = Math.ceil(12 + value.length * 7.4);
  const w = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" role="img" aria-label="A2T: ${esc(value)}">
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
  // 公开读限流 60/min/IP（S4-B M2 批 2，plan §Task 12；统一内存桶）。
  // 徽章是 README 外链热路径，裸奔时单 IP 可无限刷库。
  const badgeLimited = createRateLimiter({ max: 60, windowMs: 60_000 });

  async function renderBadge(reply: FastifyReply, agent: typeof agents.$inferSelect | undefined) {
    if (!agent) {
      reply.type('image/svg+xml').header('cache-control', 'no-store');
      return badgeSvg('A2T', 'agent not found', '#64748b');
    }
    const score = await app.db.query.creditScores.findFirst({
      where: eq(creditScores.agentId, agent.id),
      orderBy: [desc(creditScores.createdAt)],
    });
    const verified = agent.verificationLevel === 'verified';
    const value =
      score?.score != null ? `score ${score.score}${verified ? ' · verified' : ''}` : 'untested';
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=60');
    return badgeSvg('A2T', value, verified ? '#f59e0b' : '#94a3b8');
  }

  // 按 agentId（内部 id，从报告页/详情页复制）
  app.get('/badge/:agentId.svg', async (req, reply) => {
    if (badgeLimited(req)) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    }
    const { agentId } = req.params as { agentId: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    return renderBadge(reply, agent);
  });

  // 按注册名（0907 走查 C2：README 徽章示例改用可读名字，抄了就能用；同名取最新注册）
  app.get('/badge/name/:name.svg', async (req, reply) => {
    if (badgeLimited(req)) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    }
    const { name } = req.params as { name: string };
    const agent = await app.db.query.agents.findFirst({
      where: eq(agents.name, name),
      orderBy: [desc(agents.createdAt)],
    });
    return renderBadge(reply, agent);
  });
}
