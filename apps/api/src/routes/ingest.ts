/**
 * /ingest/results — SDK 考场结果上报（真实数据接入主入口）。
 *
 * 流程：限流 → 防重放（时间窗 + nonce 表）→ 验签（Ed25519 canonical-json）→
 * 题集版本校验 → caseId 白名单（服务端权威维度映射，不信任客户端）→
 * upsert agent（pubkey 绑定，同名不同钥拒绝）→
 * 证据落库（source=real-benchmark，append-only）→ 触发评分重算。
 *
 * 红线：真实数据 source=real-benchmark；verificationLevel 只到 basic（签名有效），
 * verified 必须由抽样复算（reverify）升级，绝不伪装。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Dimension } from '@acl/core';
import {
  DIMENSION_MAP,
  NEGOTIATION_SCENARIOS,
  loadSuite,
  verifyPayload,
} from '@acl/sdk';
import { evidence, ingestNonces } from '../db/schema';
import { reverifyAgent } from '../services/reverify';
import { upsertAgentIdentity } from '../services/agentIdentity';
import { computeAndPersist } from './scores';

const MIN_BENCHMARK_VERSION = '1.0.0';
const RATE_LIMIT = { max: 60, windowMs: 10 * 60_000 };
const TIMESTAMP_WINDOW_MS = 10 * 60_000;

/** caseId → 评分维度（服务端权威映射）。 */
const CASE_DIMENSION: Record<string, Dimension> = (() => {
  const m: Record<string, Dimension> = {};
  for (const c of loadSuite()) m[c.id] = DIMENSION_MAP[c.dimension] as Dimension;
  for (const s of NEGOTIATION_SCENARIOS) m[s.id] = 'negotiation';
  return m;
})();

function versionAtLeast(v: string, min: string): boolean {
  const parse = (s: string) => s.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const [a, b, c] = parse(v);
  const [x, y, z] = parse(min);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
}

/** 内存限流（MVP）：按 IP，60 次 / 10 分钟。 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export async function ingestRoutes(app: FastifyInstance) {
  app.post('/ingest/results', async (req, reply) => {
    // 0) 限流
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    } else if (bucket.count >= RATE_LIMIT.max) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    } else {
      bucket.count += 1;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: '缺少请求体' });
    }
    const {
      agentName,
      agentEndpoint,
      agentModel,
      agentVersion,
      benchmarkVersion,
      results,
      pubkey,
      nonce,
      timestamp,
      signature,
    } = body as Record<string, never> & {
      agentName?: unknown;
      agentEndpoint?: unknown;
      agentModel?: unknown;
      agentVersion?: unknown;
      benchmarkVersion?: unknown;
      results?: unknown;
      pubkey?: unknown;
      nonce?: unknown;
      timestamp?: unknown;
      signature?: unknown;
    };

    // 1) 必填字段
    if (typeof agentName !== 'string' || !agentName.trim()) {
      return reply.code(400).send({ error: 'agentName 必填' });
    }
    if (!Array.isArray(results) || results.length === 0) {
      return reply.code(400).send({ error: 'results 必填且非空' });
    }
    if (typeof benchmarkVersion !== 'string') {
      return reply.code(400).send({ error: 'benchmarkVersion 必填' });
    }
    if (typeof pubkey !== 'string' || !pubkey.includes('BEGIN PUBLIC KEY')) {
      return reply.code(400).send({ error: 'pubkey 必填（PEM）' });
    }
    if (typeof nonce !== 'string' || typeof timestamp !== 'number' || typeof signature !== 'string') {
      return reply.code(400).send({ error: 'nonce/timestamp/signature 必填' });
    }

    // 2) 时间窗（防重放之一）
    if (Math.abs(Date.now() - timestamp) > TIMESTAMP_WINDOW_MS) {
      return reply.code(409).send({ error: 'timestamp 超出允许窗口' });
    }

    // 3) nonce 一次性（防重放之二）
    try {
      await app.db.insert(ingestNonces).values({ nonce });
    } catch {
      return reply.code(409).send({ error: 'nonce 已使用（疑似重放）' });
    }

    // 4) 验签（除 signature 外全部字段参与，canonical-json）
    const { signature: _sig, ...payload } = body;
    if (!verifyPayload(pubkey, payload, signature)) {
      return reply.code(401).send({ error: '签名验证失败' });
    }

    // 5) 题集版本
    if (!versionAtLeast(benchmarkVersion, MIN_BENCHMARK_VERSION)) {
      return reply.code(422).send({ error: `题集版本过低（最低 ${MIN_BENCHMARK_VERSION}）` });
    }

    // 6) caseId 白名单 + 数值合法性（服务端权威，不信任客户端维度）
    for (const r of results as Array<Record<string, unknown>>) {
      const caseId = typeof r.caseId === 'string' ? r.caseId : '';
      const dim = CASE_DIMENSION[caseId];
      if (!dim) {
        return reply.code(422).send({ error: `未知 caseId：${caseId || '(空)'}` });
      }
      if (typeof r.value !== 'number' || r.value < 0 || r.value > 1) {
        return reply.code(422).send({ error: `value 越界：${caseId}` });
      }
      if (r.result !== 'success' && r.result !== 'partial' && r.result !== 'failure') {
        return reply.code(422).send({ error: `result 非法：${caseId}` });
      }
    }

    // 7) upsert agent（密钥即身份；与 Arena register 共用同一身份体系）
    const cleanName = (agentName as string).trim();
    const identity = await upsertAgentIdentity(app.db, {
      name: cleanName,
      pubkey,
      endpoint: typeof agentEndpoint === 'string' ? agentEndpoint : undefined,
      model: typeof agentModel === 'string' ? agentModel : undefined,
      version: typeof agentVersion === 'string' ? agentVersion : undefined,
    });
    if (identity.error === 'name-taken') {
      return reply.code(403).send({ error: '该 agent 名称已被其他密钥绑定' });
    }
    const agentId = identity.agentId;

    // 8) 证据落库（append-only，source=real-benchmark）
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(results))
      .digest('hex');
    for (const r of results as Array<{ caseId: string; value: number; result: string }>) {
      await app.db.insert(evidence).values({
        id: randomUUID(),
        agentId,
        dimension: CASE_DIMENSION[r.caseId],
        source: 'real-benchmark',
        sourceType: 'real-benchmark',
        issuer: 'sdk',
        result: r.result,
        value: r.value,
        evidenceUri: `acl://benchmark/${r.caseId}`,
        payloadHash,
      });
    }

    // 9) 触发评分重算
    const score = await computeAndPersist(app, agentId);

    // 10) 异步抽样复算（不阻塞响应；endpoint 模式才可能升级 verified）
    void reverifyAgent(app, agentId).catch(() => {});

    return reply.send({
      agentId,
      verified: false,
      verificationLevel: 'basic',
      score: score?.score ?? null,
    });
  });
}
