/**
 * POST /ingest/trade-evidence — 酒馆交易证据摄入端点（S4-B M2 批 1，plan §Task 10）。
 *
 * 骨架照 routes/ingest.ts（复用其内存桶限流模式，ingest.ts 本体零改动）：
 * 限流（120 批/10min/IP）→ bearer 与 ACL_TRADE_INGEST_TOKEN timing-safe 比较
 * （env 缺失/空 = 全部 401，per-request 读取支持免重启轮换）→
 * versionAtLeast(1) → 信封骨架校验（reporter/version/events 结构，失败 400）→
 * ingestTradeEvidence（毒丸：单事件 zod fail 落 rejected[]，好事件照收）→
 * 200 {accepted, duplicates, rejected}。
 *
 * 认证边界（T7-8 评审 I2）：bearer 是唯一认证边界；agentRef 属受信数据
 * （由酒馆市场服务端上报），本端点不做 ref 逐条验证，高熵化演进另行裁定。
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { EnvelopeSkeletonSchema } from '../services/tradeEvidence';
import { ingestTradeEvidence } from '../services/tradeEvidence';

/** 内存限流（MVP，ingest.ts 同模式）：按 IP，120 批 / 10 分钟。 */
const RATE_LIMIT = { max: 120, windowMs: 10 * 60_000 };
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let nextSweepAt = 0;

/** timing-safe 比较；长度不等时也做一次等长比较，避免长度侧信道。 */
function bearerMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** versionAtLeast(1)：evidenceSchemaVersion 必须为 ≥1 整数（信封演进门槛）。 */
function versionAtLeast1(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function limited(req: FastifyRequest): boolean {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  // 机会性清理过期 key（T9-10 评审修复：防长期运行内存随 IP 数缓涨；
  // 仅本文件——ingest.ts 同款缺陷不动，M2 硬化专项统一处理）
  if (now >= nextSweepAt) {
    nextSweepAt = now + RATE_LIMIT.windowMs;
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt < now) rateBuckets.delete(key);
    }
  }
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
  } else if (bucket.count >= RATE_LIMIT.max) {
    return true;
  } else {
    bucket.count += 1;
  }
  return false;
}

export async function tradeEvidenceRoutes(app: FastifyInstance) {
  app.post('/ingest/trade-evidence', async (req, reply) => {
    // 0) 限流（120 批/10min/IP）
    if (limited(req)) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    }

    // 1) bearer 认证（唯一认证边界）：env 缺失/空 = 全部 401
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: '缺少 bearer 凭证' });
    }
    const expected = process.env.ACL_TRADE_INGEST_TOKEN;
    if (!expected) {
      return reply.code(401).send({ error: '服务端未配置摄入凭证' });
    }
    if (!bearerMatches(auth.slice('Bearer '.length), expected)) {
      return reply.code(401).send({ error: 'bearer 凭证无效' });
    }

    const body = req.body as Record<string, unknown> | undefined;

    // 2) 版本门槛：versionAtLeast(1)
    if (!versionAtLeast1(body?.evidenceSchemaVersion)) {
      return reply.code(400).send({ error: 'evidenceSchemaVersion 必须为 ≥1 的整数' });
    }

    // 3) 信封骨架校验（reporter literal / reporterVersion / events≤100）→ 400；
    //    事件体内容不在信封层拒绝，留给服务层毒丸语义
    const skeleton = EnvelopeSkeletonSchema.safeParse(body);
    if (!skeleton.success) {
      return reply.code(400).send({ error: '信封不合法：' + (skeleton.error.issues[0]?.message ?? '') });
    }

    // 4) 摄入（毒丸：坏事件 rejected[]，好事件照收；脏信封防御性 400）
    try {
      const result = await ingestTradeEvidence(app.db, body);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: '信封不合法：' + (error.issues[0]?.message ?? '') });
      }
      throw error;
    }
  });
}
