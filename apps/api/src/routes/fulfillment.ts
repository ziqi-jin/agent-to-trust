/**
 * Self-reported task claims.
 *
 * The signer owns the claim. A repeated submission of the same task and the
 * same content is idempotent. A different story for the same task id conflicts
 * and does not create a second row. Nothing here is written into evidence, so
 * baseline-v0.3 does not move. The stored assurance is always self-reported;
 * a signature proves the key signed the claim, not that the task happened.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { canonicalJson, sha256Hex, SIGNATURE_DOES_NOT_PROVE, SIGNATURE_MEANS } from '@a2t/core';
import { verifyPayload } from 'agent-to-trust';
import { agents, fulfillmentRecords, ingestNonces, provenanceInstances } from '../db/schema';
import { createRateLimiter } from '../services/rateLimit';

const TIMESTAMP_WINDOW_MS = 10 * 60_000;
const limited = createRateLimiter({ max: 30, windowMs: 60_000 });
const readLimited = createRateLimiter({ max: 120, windowMs: 60_000 });
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const OUTCOMES = new Set(['success', 'failure', 'partial']);

export async function fulfillmentRoutes(app: FastifyInstance) {
  app.post('/fulfillment', async (req, reply) => {
    if (limited(req)) return reply.code(429).send({ error: '请求过于频繁，稍后再试', code: 'rate-limited' });
    const opened = await openSigned(app, req.body, reply);
    if (!opened) return;
    if (opened.action !== 'submit-fulfillment') {
      return reply.code(400).send({ error: 'action 必须是 submit-fulfillment', code: 'action' });
    }
    for (const key of ['assurance', 'verified', 'countsTowardScore', 'score', 'dimension']) {
      if (key in opened.body) {
        return reply.code(400).send({
          error: '不能把自称的任务结果标成已核验或计入信用分',
          code: 'assurance-not-offered',
        });
      }
    }
    const taskId = opened.body.taskId;
    const outcome = opened.body.outcome;
    const summary = opened.body.summary;
    if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) {
      return reply.code(400).send({ error: 'taskId 必填', code: 'task-id' });
    }
    if (typeof outcome !== 'string' || !OUTCOMES.has(outcome)) {
      return reply.code(400).send({ error: 'outcome 必须是 success、failure 或 partial', code: 'outcome' });
    }
    if (typeof summary !== 'string' || summary.trim().length === 0 || summary.trim().length > 280) {
      return reply.code(400).send({ error: 'summary 必填且不超过 280 字', code: 'summary' });
    }
    if (/[\u0000-\u001f]/.test(summary)) {
      return reply.code(400).send({ error: 'summary 含有控制字符', code: 'summary' });
    }
    let instanceId: string | null = null;
    if (opened.body.instanceId !== undefined && opened.body.instanceId !== null) {
      if (typeof opened.body.instanceId !== 'string') {
        return reply.code(400).send({ error: 'instanceId 非法', code: 'instance' });
      }
      const instance = await app.db.query.provenanceInstances.findFirst({
        where: eq(provenanceInstances.id, opened.body.instanceId),
      });
      if (!instance || instance.agentId !== opened.agentId) {
        return reply.code(403).send({ error: 'instance 不属于签名身份', code: 'not-owner' });
      }
      instanceId = instance.id;
    }
    const cleanSummary = summary.trim();
    const payloadHash = sha256Hex(
      canonicalJson({ taskId, outcome, summary: cleanSummary, instanceId }),
    );
    const row = {
      id: `ful-${randomUUID()}`,
      agentId: opened.agentId,
      instanceId,
      taskId,
      outcome,
      summary: cleanSummary,
      payloadHash,
      assurance: 'self-reported' as const,
      countsTowardScore: false,
    };
    try {
      await app.db.insert(fulfillmentRecords).values(row);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await app.db.query.fulfillmentRecords.findFirst({
        where: and(eq(fulfillmentRecords.agentId, opened.agentId), eq(fulfillmentRecords.taskId, taskId)),
      });
      if (existing && existing.payloadHash === payloadHash) {
        return reply.code(200).send(publicRecord(existing, true));
      }
      return reply.code(409).send({
        error: '同一 taskId 已有不同内容，拒绝覆盖，也不另记一笔信用',
        code: 'task-conflict',
        countsTowardScore: false,
      });
    }
    return reply.code(201).send(publicRecord(row, false));
  });

  app.get('/agents/:id/fulfillment', async (req, reply) => {
    if (readLimited(req)) return reply.code(429).send({ error: '请求过于频繁，稍后再试', code: 'rate-limited' });
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: 'agent 不存在', code: 'agent-not-found' });
    const rows = await app.db.query.fulfillmentRecords.findMany({
      where: eq(fulfillmentRecords.agentId, id),
    });
    return reply.send({
      agentId: id,
      assurance: 'self-reported',
      countsTowardScore: false,
      note: 'These are claims signed by the agent. They are not independently verified and they do not change baseline-v0.3.',
      signatureMeans: SIGNATURE_MEANS,
      doesNotProve: [...SIGNATURE_DOES_NOT_PROVE],
      records: rows.map((row) => publicRecord(row, false)),
    });
  });
}

function publicRecord(
  row: {
    id: string;
    agentId: string;
    instanceId: string | null;
    taskId: string;
    outcome: string;
    summary: string;
    assurance: string;
    countsTowardScore: boolean;
  },
  duplicate: boolean,
) {
  return {
    id: row.id,
    agentId: row.agentId,
    instanceId: row.instanceId,
    taskId: row.taskId,
    outcome: row.outcome,
    summary: row.summary,
    assurance: 'self-reported' as const,
    independentlyVerified: false as const,
    countsTowardScore: false as const,
    duplicate,
    signatureMeans: SIGNATURE_MEANS,
  };
}

function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && (current as { code?: string }).code === '23505') return true;
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function openSigned(
  app: FastifyInstance,
  raw: unknown,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<{ action: string; agentId: string; body: Record<string, unknown> } | null> {
  if (!raw || typeof raw !== 'object') {
    reply.code(400).send({ error: '缺少请求体', code: 'body' });
    return null;
  }
  const envelope = raw as Record<string, unknown>;
  const { action, pubkey, nonce, timestamp, signature, body } = envelope;
  if (typeof action !== 'string' || typeof pubkey !== 'string' || !pubkey.includes('BEGIN PUBLIC KEY')) {
    reply.code(400).send({ error: 'action 与 pubkey 必填', code: 'envelope' });
    return null;
  }
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) {
    reply.code(400).send({ error: 'nonce 必填', code: 'nonce' });
    return null;
  }
  if (typeof timestamp !== 'number' || typeof signature !== 'string' || !body || typeof body !== 'object' || Array.isArray(body)) {
    reply.code(400).send({ error: 'timestamp、signature、body 必填', code: 'envelope' });
    return null;
  }
  if (Math.abs(Date.now() - timestamp) > TIMESTAMP_WINDOW_MS) {
    reply.code(409).send({ error: 'timestamp 超出允许窗口', code: 'timestamp-window' });
    return null;
  }
  try {
    await app.db.insert(ingestNonces).values({ nonce });
  } catch {
    reply.code(409).send({ error: 'nonce 已使用（疑似重放）', code: 'replay' });
    return null;
  }
  const { signature: _sig, ...payload } = envelope;
  if (!verifyPayload(pubkey, payload, signature)) {
    reply.code(401).send({ error: '签名验证失败', code: 'bad-signature' });
    return null;
  }
  const agent = await app.db.query.agents.findFirst({ where: eq(agents.pubkey, pubkey) });
  if (!agent) {
    reply.code(403).send({ error: '签名钥尚未注册为身份', code: 'unregistered-key' });
    return null;
  }
  return { action, agentId: agent.id, body: body as Record<string, unknown> };
}
