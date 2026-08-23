import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DIMENSIONS, isDimension, type Dimension, type Source } from '@acl/core';
import { agents, evidence } from '../db/schema';

interface EvidenceBody {
  dimension?: string;
  source?: string;
  sourceType?: string;
  issuer?: string;
  result?: string;
  value?: number;
  severity?: number;
  evidenceUri?: string;
  payloadHash?: string;
}

export async function evidenceRoutes(app: FastifyInstance) {
  app.post('/agents/:id/evidence', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as EvidenceBody;

    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });

    if (!body.dimension || !isDimension(body.dimension)) {
      return reply.code(422).send({ error: `非法维度：${body.dimension}。可选：${DIMENSIONS.join(', ')}` });
    }
    const result = body.result ?? 'success';
    if (!['success', 'failure', 'partial'].includes(result)) {
      return reply.code(422).send({ error: `非法 result：${result}。可选：success | failure | partial` });
    }

    const [created] = await app.db
      .insert(evidence)
      .values({
        id: randomUUID(),
        agentId: id,
        dimension: body.dimension as Dimension,
        source: (body.source ?? 'simulation') as Source,
        sourceType: body.sourceType ?? 'simulation',
        issuer: body.issuer ?? null,
        result: result as 'success' | 'failure' | 'partial',
        value: body.value ?? null,
        severity: body.severity ?? null,
        evidenceUri: body.evidenceUri ?? null,
        payloadHash: body.payloadHash ?? null,
      })
      .returning();
    return reply.code(201).send(created);
  });

  app.get('/agents/:id/evidence', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });
    return app.db.query.evidence.findMany({
      where: eq(evidence.agentId, id),
      orderBy: (e, { asc }) => [asc(e.createdAt)],
    });
  });

  app.get('/evidence/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ev = await app.db.query.evidence.findFirst({ where: eq(evidence.id, id) });
    if (!ev) return reply.code(404).send({ error: `Evidence 不存在：${id}` });
    return ev;
  });
}

