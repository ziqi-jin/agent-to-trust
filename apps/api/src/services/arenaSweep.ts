/**
 * Arena 悬空会话兜底清扫（T10 收官缺口，2026-09-10）。
 *
 * 根因：状态机推进只由 agent 事件驱动（SETTLE → settled、REJECT → failed），
 * SDK 驱动中途退出后 open/negotiating 会话永久悬空——平台侧没有任何超时兜底
 * （deadline 列存在但驱动从未设置，T10 的 9 个狗粮会话实锤）。
 *
 * 清扫规则：
 *   - deadline 已过 → failed（deadline 是权威）
 *   - 无 deadline 且最后活动（最后事件 ts，无事件则 created_at）早于 TTL → failed
 *
 * failed 不走 settleSession：不写证据、不动分数——行为证据只来自真实 SETTLE。
 * 插入平台 TIMEOUT 事件留痕：sig='platform' 明确平台署名，nonce 全局唯一防重。
 */

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { arenaEvents, arenaSessions } from '../db/schema';

export const DEFAULT_SWEEP_TTL_MINUTES = 30;

export async function sweepStaleSessions(
  app: FastifyInstance,
  opts: { ttlMinutes?: number; now?: Date } = {},
): Promise<string[]> {
  const ttlMinutes =
    opts.ttlMinutes ?? Number(process.env.ARENA_SESSION_TTL_MINUTES ?? DEFAULT_SWEEP_TTL_MINUTES);
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - ttlMinutes * 60_000);

  // 最后活动 = 最后事件 ts；无事件则用 created_at
  const lastActivity = sql`coalesce(
    (select max(${arenaEvents.ts}) from ${arenaEvents} where ${arenaEvents.sessionId} = ${arenaSessions.id}),
    ${arenaSessions.createdAt}
  )`;

  const candidates = await app.db
    .select({ id: arenaSessions.id })
    .from(arenaSessions)
    .where(
      and(
        inArray(arenaSessions.status, ['open', 'negotiating']),
        sql`(${arenaSessions.deadline} is not null and ${arenaSessions.deadline} < ${now})
       or (${arenaSessions.deadline} is null and ${lastActivity} < ${staleBefore})`,
      ),
    );

  const swept: string[] = [];
  for (const { id } of candidates) {
    // 事务：状态守卫更新 + TIMEOUT 事件原子落库（seq 冲突则整体回滚，下轮重扫）
    const ok = await app.db.transaction(async (tx) => {
      const [{ maxSeq }] = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${arenaEvents.seq}), 0)` })
        .from(arenaEvents)
        .where(eq(arenaEvents.sessionId, id));
      const updated = await tx
        .update(arenaSessions)
        .set({ status: 'failed' })
        .where(
          and(eq(arenaSessions.id, id), inArray(arenaSessions.status, ['open', 'negotiating'])),
        )
        .returning({ id: arenaSessions.id });
      if (updated.length === 0) return false;
      await tx.insert(arenaEvents).values({
        id: `ae-${randomUUID()}`,
        sessionId: id,
        seq: maxSeq + 1,
        type: 'TIMEOUT',
        fromAgent: 'platform-engine',
        payload: { reason: 'stale-session' },
        sig: 'platform',
        nonce: `platform-timeout-${id}`,
        ts: now,
      });
      return true;
    });
    if (ok) swept.push(id);
  }
  return swept;
}
