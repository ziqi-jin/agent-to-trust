import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DIMENSIONS, isDimension, type Dimension, type Source } from '@acl/core';
import { agents, evidence } from '../db/schema';
import { computeAndPersist, serialize } from './scores';

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

/**
 * source 白名单（D3，2026-09-09 13:17 老大拍板）：本端点只收 'simulation'。
 * 原先 `source: body.source ?? 'simulation'` 无白名单，可传 source=real
 * （SOURCE_WEIGHTS.real = 1.0）无鉴权灌分，绕过验签。
 * 真实证据必须走 POST /ingest/results（Ed25519 验签链路）。
 * 扩源（如未来允许 benchmark 自报）再放宽——单处常量，防口径漂移。
 */
const ALLOWED_EVIDENCE_SOURCES = new Set(['simulation']);

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

    // D3（0909 拍板）：source 白名单——只收 simulation，堵无鉴权灌分。
    const source = body.source ?? 'simulation';
    if (!ALLOWED_EVIDENCE_SOURCES.has(source)) {
      return reply.code(400).send({
        error:
          `非法 source：${source}。本端点只收 simulation；` +
          'source=real 的证据请走 POST /ingest/results（Ed25519 验签链路），参考文档 /docs',
      });
    }

    const [created] = await app.db
      .insert(evidence)
      .values({
        id: randomUUID(),
        agentId: id,
        dimension: body.dimension as Dimension,
        source: source as Source,
        sourceType: body.sourceType ?? 'simulation',
        issuer: body.issuer ?? null,
        result: result as 'success' | 'failure' | 'partial',
        value: body.value ?? null,
        severity: body.severity ?? null,
        evidenceUri: body.evidenceUri ?? null,
        payloadHash: body.payloadHash ?? null,
      })
      .returning();
    // 交易/事件 → 分数自动更新：插入 evidence 后立刻重算该 agent 信用分
    const score = await computeAndPersist(app, id);
    return reply.code(201).send({ evidence: created, score: serialize(score) });
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

