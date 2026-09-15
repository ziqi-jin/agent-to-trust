/**
 * Arena 结算：SETTLE 事件入库后，把行为证据写进 evidence
 * （source='arena'，append-only），并用现有评分引擎重算双方信用分。
 *
 * 证据依据：会话内最后一个 VERIFY_RESULT 的 payload { verdict: 'pass'|'fail', onTime }。
 *   seller → delivery：pass+onTime → success/1；pass+迟到 → partial/0.5；fail → failure/0（severity 3）
 *   buyer  → reliability：pass → success/1；fail → partial/0.5（争议解决但流程受损）
 */

import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { arenaEvents, arenaSessions, evidence } from '../db/schema';
import { computeAndPersist } from '../routes/scores';

/**
 * 证据 `source_type` 三档口径（spec §4.3，两轴正交）：
 *   scripted               + 任意 adapter → 'arena-behavior'
 *   live                   + adapter='a2a' → 'arena-behavior-a2a'
 *   live                   + 其他（polling/null/undefined）→ 'arena-behavior-live'
 * 向后兼容：老会话无 adapter（null/undefined）仍产出 'arena-behavior-live'。
 */
export function sourceTypeFor(
  counterpartMode: string | null | undefined,
  adapter: string | null | undefined,
): 'arena-behavior' | 'arena-behavior-live' | 'arena-behavior-a2a' {
  if (counterpartMode !== 'live') return 'arena-behavior';
  return adapter === 'a2a' ? 'arena-behavior-a2a' : 'arena-behavior-live';
}

export async function settleSession(
  app: FastifyInstance,
  sessionId: string,
  settleSeq: number,
): Promise<void> {
  const [session] = await app.db
    .select()
    .from(arenaSessions)
    .where(eq(arenaSessions.id, sessionId));
  if (!session) return;

  const [verify] = await app.db
    .select()
    .from(arenaEvents)
    .where(and(eq(arenaEvents.sessionId, sessionId), eq(arenaEvents.type, 'VERIFY_RESULT')))
    .orderBy(desc(arenaEvents.seq))
    .limit(1);

  const payload = (verify?.payload ?? {}) as { verdict?: string; onTime?: boolean };
  const fail = payload.verdict === 'fail';
  const onTime = payload.onTime !== false;

  const rows: Array<typeof evidence.$inferInsert> = [];
  // 三档口径（Task 9）：scripted / live+polling / live+a2a 正交映射（spec §4.3）。
  const sourceType = sourceTypeFor(session.counterpartMode, session.adapter);
  const base = {
    source: 'arena',
    sourceType,
    issuer: 'arena-engine',
    evidenceUri: `acl://arena/${sessionId}`,
  };

  if (session.sellerAgentId) {
    rows.push({
      id: `ev-arena-${sessionId}-s-${settleSeq}`,
      agentId: session.sellerAgentId,
      dimension: 'delivery',
      ...base,
      result: fail ? 'failure' : onTime ? 'success' : 'partial',
      value: fail ? 0 : onTime ? 1 : 0.5,
      severity: fail ? 3 : null,
    });
  }
  if (session.buyerAgentId) {
    rows.push({
      id: `ev-arena-${sessionId}-b-${settleSeq}`,
      agentId: session.buyerAgentId,
      dimension: 'reliability',
      ...base,
      result: fail ? 'partial' : 'success',
      value: fail ? 0.5 : 1,
    });
  }

  if (rows.length > 0) {
    await app.db.insert(evidence).values(rows).onConflictDoNothing();
  }
  for (const agentId of [session.buyerAgentId, session.sellerAgentId]) {
    if (agentId) await computeAndPersist(app, agentId);
  }
}
