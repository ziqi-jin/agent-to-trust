import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Dimension, type Source } from '@acl/core';
import { computeScore, type EvidencePoint } from '@acl/scoring';
import { agents, creditScores, evidence, scoreSnapshots } from '../db/schema';

function serialize(s: typeof creditScores.$inferSelect) {
  return {
    agentId: s.agentId,
    score: s.score,
    adjustedScore: s.adjustedScore,
    confidence: s.confidence,
    freshnessDays: s.freshnessDays,
    modelVersion: s.modelVersion,
    dimensions: s.dimensions,
    evidenceCount: (s.evidenceRefs ?? []).length,
    evidenceRefs: s.evidenceRefs,
    computedAt: s.createdAt,
  };
}

async function computeAndPersist(app: FastifyInstance, agentId: string) {
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
  app.post('/agents/:id/score', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });
    const created = await computeAndPersist(app, id);
    return serialize(created);
  });

  app.get('/agents/:id/score', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });
    const latest = await app.db.query.creditScores.findFirst({
      where: eq(creditScores.agentId, id),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
    if (!latest) return serialize(await computeAndPersist(app, id));
    return serialize(latest);
  });
}
