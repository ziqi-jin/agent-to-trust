import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { agents, creditScores } from '../db/schema';
import { createRateLimiter } from '../services/rateLimit';
import { tavernExternalId } from '../services/tavernIdentity';

interface AgentBody {
  name?: string;
  owner?: string;
  capabilities?: string[];
}

/** body 白名单：source 现仅 'tavern'（判别符，扩源再放宽）；refs≤100。 */
const ScoresByExternalBody = z.object({
  source: z.literal('tavern'),
  refs: z.array(z.string().min(1)).max(100),
});

export async function agentsRoutes(app: FastifyInstance) {
  app.post('/agents', async (req, reply) => {
    const body = (req.body ?? {}) as AgentBody;
    if (!body.name || typeof body.name !== 'string') {
      return reply.code(400).send({ error: 'name 必填' });
    }
    const existing = await app.db.query.agents.findFirst({ where: eq(agents.name, body.name) });
    if (existing) {
      return reply.code(409).send({ error: `Agent 名称已存在：${body.name}` });
    }
    const [created] = await app.db
      .insert(agents)
      .values({
        id: randomUUID(),
        name: body.name,
        owner: body.owner ?? null,
        capabilities: body.capabilities ?? null,
      })
      .returning();
    return reply.code(201).send(created);
  });

  app.get('/agents', async () => {
    return app.db.query.agents.findMany({ orderBy: (a, { desc }) => [desc(a.createdAt)] });
  });

  app.get('/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });
    return agent;
  });

  // POST /agents/scores-by-external — 批量公开读（S4-B M2 批 2，plan §Task 11）。
  //
  // 酒馆 web SSR 批量拉信用分（tavern 仓 Task 14 fetchTavernCreditScores 消费方）：
  // body {source:'tavern', refs: string[]}（refs≤100，超出 400）→ inArray 按
  // externalId 查 agents → join 各 agent latest credit_scores →
// { results: ({externalId, agentId, name, score, adjustedScore, confidence, evidenceCount, badgeUrl}|null)[] }，
  // 序与 refs 严格一致，未知 ref → null 占位。限流 60/min/IP（公开读桶，plan §Task 12 同款）。
  //
  // 契约锚点：
  // - externalId ≡ agents.id（T8 身份映射：酒馆 agent 主键即 ext-tavern-*，无独立列）；
  //   2026-09-06 裁决：tavern source 下 refs 传酒馆原始 uuid 亦可——字面未命中时按
  //   tavernIdentity.tavernExternalId 推导兜底（推导权威单处在 ACL 仓，零漂移）；
  // - badgeUrl 为根相对路径 /credit/api/badge/{agentId}.svg（badge.ts 头注释的公开嵌入
  //   格式，酒馆 web 同域 <img> 直接可用）；
  // - source 现仅收 'tavern'（前向兼容判别符，扩源时再放宽）；
  // - 公开读：无认证（与 GET /agents/:id/score、/badge 同级），refs≤100 防扫库放大。
  const scoresByExternalLimited = createRateLimiter({ max: 60, windowMs: 60_000 });
  app.post('/agents/scores-by-external', async (req, reply) => {
    if (scoresByExternalLimited(req as FastifyRequest)) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    }
    const parsed = ScoresByExternalBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'body 不合法：' + (parsed.error.issues[0]?.message ?? '') });
    }
    const { refs, source } = parsed.data;
    if (refs.length === 0) return reply.code(200).send({ results: [] });

    const found = await app.db.query.agents.findMany({ where: inArray(agents.id, refs) });
    const byId = new Map(found.map((a) => [a.id, a]));

    // 2026-09-06 裁决兜底（方案乙，T17 E2E 联调缺口修复）：agents.id =
    // ext-tavern-<slug8>-<hash8>（services/tavernIdentity 确定性推导），酒馆调用方
    // （v2 web lib/credit.ts）传酒馆原始 uuid（agentRef）时字面未命中 → 推导一次再查，
    // 命中即用；推导仍未命中 → null 占位（契约不变）。幂等：推导值恰在 refs 里时
    // 走 byId 字面命中，不重复查询。非 tavern source 被 schema z.literal 门拒（400），
    // 永不进入推导；source 守卫为 schema 将来放宽时的防御。
    if (source === 'tavern') {
      const missDerived = [
        ...new Set(refs.filter((r) => !byId.has(r)).map((r) => tavernExternalId(r))),
      ].filter((id) => !byId.has(id));
      if (missDerived.length > 0) {
        const extra = await app.db.query.agents.findMany({
          where: inArray(agents.id, missDerived),
        });
        for (const a of extra) byId.set(a.id, a);
        found.push(...extra);
      }
    }

    // join latest scores：同 leaderboard 口径（createdAt 降序取每 agent 首条）
    const latestScores = await app.db.query.creditScores.findMany({
      where: inArray(
        creditScores.agentId,
        found.map((a) => a.id),
      ),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
    const latestByAgent = new Map<string, (typeof creditScores.$inferSelect)>();
    for (const s of latestScores) if (!latestByAgent.has(s.agentId)) latestByAgent.set(s.agentId, s);

    const results = refs.map((ref) => {
      const agent =
        byId.get(ref) ??
        (source === 'tavern' ? byId.get(tavernExternalId(ref)) : undefined);
      if (!agent) return null;
      const score = latestByAgent.get(agent.id) ?? null;
      return {
        externalId: agent.id,
        agentId: agent.id,
        name: agent.name,
        score: score?.score ?? null,
        adjustedScore: score?.adjustedScore ?? null,
        confidence: score?.confidence ?? null,
        // 证据条数 = 评分行 evidenceRefs 长度（scores.ts 同口径）；临时评级判定（<5）用
        evidenceCount: score?.evidenceRefs?.length ?? 0,
        badgeUrl: `/credit/api/badge/${agent.id}.svg`,
      };
    });
    return reply.code(200).send({ results });
  });
}
