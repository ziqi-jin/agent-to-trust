/**
 * POST /ingest/agent-visibility — 酒馆 agent 榜单可见性同步端点（T6，老大 2026-09-08 17:00 拍板）。
 *
 * 酒馆服务端在两个时机调用（随注册传 ACL + 注册后可改，设计冻结条款 5/7）：
 * - agent 注册时（POST /v1/agents 落库后）：ref 未知 → 建号（确定性 id + 伪 pubkey + basic，
 *   信用数据采集不受影响），注册时选择的榜单偏好直接落库，不等到首单证据；
 * - owner 在设置页开关时：既有 ref → 只更新 leaderboard_visible。
 *
 * 复用 routes/tradeEvidence.ts 的信任锚与限流骨架（同一机构级 bearer =
 * ACL_TRADE_INGEST_TOKEN，timing-safe 比较；120 批/10min/IP 内存桶）。身份变更
 * 语义在 services/tavernIdentity.setTavernAgentVisibility（撞名 name-taken 零写入）。
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { setTavernAgentVisibility } from '../services/tavernIdentity';

/** 内存限流（tradeEvidence.ts 同模式）：按 IP，120 批 / 10 分钟。 */
const RATE_LIMIT = { max: 120, windowMs: 10 * 60_000 };
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let nextSweepAt = 0;

/** timing-safe 比较；长度不等时也做一次等长比较，避免长度侧信道（tradeEvidence.ts 同款）。 */
function bearerMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function limited(req: FastifyRequest): boolean {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
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

/** body 白名单：source 判别符（scores-by-external 同款）；批 ≤100（与 trade-evidence 信封同上限）。 */
const VisibilityBody = z.object({
  source: z.literal('tavern'),
  agents: z
    .array(
      z.object({
        ref: z.string().min(1).max(64),
        name: z.string().min(1).max(64),
        leaderboardVisible: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
});

export async function agentVisibilityRoutes(app: FastifyInstance) {
  app.post('/ingest/agent-visibility', async (req, reply) => {
    // 0) 限流（120 批/10min/IP）
    if (limited(req)) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    }

    // 1) bearer 认证（唯一认证边界，trade-evidence 同锚）：env 缺失/空 = 全部 401
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

    // 2) body 白名单（脏 body → 400 整批拒；与 trade-evidence 的毒丸语义不同——
    //    这里没有逐条事实入库，批小且无幂等表，整批校验语义最简单）
    const parsed = VisibilityBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'body 不合法：' + (parsed.error.issues[0]?.message ?? '') });
    }

    // 3) 逐条同步身份可见性（撞名 → name-taken 占位，不失败整批）
    const results = [] as Array<{
      ref: string;
      agentId: string;
      status: 'updated' | 'created' | 'name-taken';
    }>;
    for (const item of parsed.data.agents) {
      const { agentId, status } = await setTavernAgentVisibility(
        app.db,
        item.ref,
        item.name,
        item.leaderboardVisible,
      );
      results.push({ ref: item.ref, agentId, status });
    }
    return reply.code(200).send({ results });
  });
}
