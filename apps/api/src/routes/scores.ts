import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Dimension, type Source } from '@acl/core';
import {
  badgesFromDimensions,
  computeScore,
  realEvidenceCounts,
  REAL_EVIDENCE_SOURCES,
  type Badge,
  type EvidencePoint,
} from '@acl/scoring';
import { agents, creditScores, evidence, scoreSnapshots } from '../db/schema';
import { createRateLimiter } from '../services/rateLimit';

/**
 * 详情页勋章（2026-09-13 老大走查补）：与榜单行**同一口径**（@acl/scoring.badgesFromDimensions），
 * 只认真实证据（REAL_EVIDENCE_SOURCES），时效由 freshnessDays 推算；客户端不得自报。
 */
async function badgesForAgent(
  app: FastifyInstance,
  agentId: string,
  s: { dimensions: unknown; freshnessDays: number | null },
): Promise<Badge[]> {
  const rows = await app.db.query.evidence.findMany({
    where: and(
      eq(evidence.agentId, agentId),
      inArray(evidence.source, [...REAL_EVIDENCE_SOURCES]),
    ),
  });
  const dims = (s.dimensions ?? []) as Array<{ dimension: string; score: number | null }>;
  return badgesFromDimensions(dims, realEvidenceCounts(rows), s.freshnessDays);
}

export function serialize(s: typeof creditScores.$inferSelect) {
  return {
    agentId: s.agentId,
    score: s.score,
    adjustedScore: s.adjustedScore,
    confidence: s.confidence,
    coverage: s.coverage,
    freshnessDays: s.freshnessDays,
    modelVersion: s.modelVersion,
    dimensions: s.dimensions,
    evidenceCount: (s.evidenceRefs ?? []).length,
    evidenceRefs: s.evidenceRefs,
    computedAt: s.createdAt,
  };
}

export async function computeAndPersist(app: FastifyInstance, agentId: string) {
  const rows = await app.db.query.evidence.findMany({ where: eq(evidence.agentId, agentId) });
  const points: EvidencePoint[] = rows.map((e) => ({
    dimension: e.dimension as Dimension,
    source: e.source as Source,
    sourceType: e.sourceType,
    result: e.result as 'success' | 'failure' | 'partial',
    value: e.value ?? undefined,
    timestamp: e.createdAt,
  }));
  const result = computeScore(points);

  const [created] = await app.db
    .insert(creditScores)
    .values({
      id: randomUUID(),
      agentId,
      score: result.score,
      adjustedScore: result.adjustedScore,
      confidence: result.confidence,
      coverage: result.coverage,
      freshnessDays: result.freshnessDays,
      modelVersion: result.modelVersion,
      dimensions: result.dimensions as unknown as Record<string, unknown>[],
      evidenceRefs: rows.map((r) => r.id),
    })
    .returning();

  await app.db.insert(scoreSnapshots).values({
    id: randomUUID(),
    agentId,
    score: result.score,
    modelVersion: result.modelVersion,
  });

  return created;
}

export async function scoresRoutes(app: FastifyInstance) {
  // 公开读限流 60/min/IP（S4-B M2 批 2，plan §Task 12；统一内存桶）。只限 GET，
  // POST（评分触发写路径）不在此桶内。computeAndPersist 本体零改动（红线）。
  const scoreReadLimited = createRateLimiter({ max: 60, windowMs: 60_000 });

  app.post('/agents/:id/score', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });
    const created = await computeAndPersist(app, id);
    return { ...serialize(created), badges: await badgesForAgent(app, id, created) };
  });

  app.get('/agents/:id/score', async (req, reply) => {
    if (scoreReadLimited(req)) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    }
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });
    const latest = await app.db.query.creditScores.findFirst({
      where: eq(creditScores.agentId, id),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
    const s = latest ?? (await computeAndPersist(app, id));
    return { ...serialize(s), badges: await badgesForAgent(app, id, s) };
  });
}
