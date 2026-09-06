/**
 * tradeEvidence — 酒馆交易证据摄入服务（S4-B M2 批 1，plan §Task 9）。
 *
 * 酒馆市场把交易事件打成信封（docs/fixtures/trade-evidence-v1.json 为两侧契约 fixture，
 * 漂移即红）推到 /ingest/trade-evidence（routes/tradeEvidence.ts，plan §Task 10）。
 *
 * 语义（plan 原文，binding）：
 * - zod 白名单：EventSchema/EnvelopeSchema 逐字段白名单；
 * - 信封脏（reporter/version/events 结构不对）→ throw（路由转 400）；
 * - 毒丸：单事件 zod fail → rejected[]{id,error}，好事件照收——不因坏事件拒绝整批；
 * - 幂等：evidence.id = 酒馆事件 uuid，insert onConflictDoNothing → 重复 id 落 duplicates，
 *   不重复入库（evidence 表 append-only）；
 * - 来源：source='real'（SOURCE_WEIGHTS['real']=1.0，T7 校正过），issuer='tavern-market'；
 * - 五维映射 mapEventToDimension：
 *     delivered → {delivery, success}
 *     confirmed → {economic, success}
 *     rejected  → {delivery, failure}
 *     delivery_failed → {reliability, failure}
 *     delivery_failed+signature_invalid → {integrity, failure}（毒丸：覆盖默认 reliability）
 * - 评分：accepted 落库后按 agentRef 去重调 computeAndPersist（routes/scores.ts，只调用不修改）；
 *   computeAndPersist(app, agentId) 只消费 app.db，这里传 { db } 最小适配其签名；
 * - 身份：每事件 upsertTavernAgent(agentRef, agentName)（T8 服务）；
 *   撞名时 upsert 返回持名者 id（agentId !== tavernExternalId(ref) 可检测）——按返回 id 落库
 *   （T7-8 评审注记：M2 联调如需更严撞名语义另行裁定）。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Dimension } from '@acl/core';
import type { Database } from '../db/client';
import { evidence } from '../db/schema';
import { upsertTavernAgent } from './tavernIdentity';
import { computeAndPersist } from '../routes/scores';

export const EventSchema = z.object({
  id: z.string().uuid(),
  agentRef: z.string().min(1).max(64),
  agentName: z.string().min(1).max(64),
  orderRef: z.string().min(1).max(64),
  type: z.enum(['delivered', 'confirmed', 'rejected', 'delivery_failed']),
  reason: z.enum(['signature_invalid', 'timeout', 'unreachable', 'bad_status']).optional(),
  occurredAt: z.coerce.date(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/** 完整线上契约（含逐事件 schema）。 */
export const EnvelopeSchema = z.object({
  reporter: z.literal('tavern-market'),
  reporterVersion: z.string(),
  evidenceSchemaVersion: z.number().int().min(1),
  events: z.array(EventSchema).max(100),
});

/**
 * 信封骨架：入口用它做"信封脏 → throw/400"的白名单校验，
 * 事件体留给 EventSchema 逐条 safeParse（毒丸语义：坏事件不炸整批）。
 * 派生自 EnvelopeSchema，字段定义只有一份。
 */
export const EnvelopeSkeletonSchema = EnvelopeSchema.omit({ events: true }).extend({
  events: z.array(z.unknown()).max(100),
});

export type TradeEvidenceEvent = z.infer<typeof EventSchema>;
export type TradeEvidenceEnvelope = z.infer<typeof EnvelopeSchema>;
export type IngestTradeEvidenceResult = {
  accepted: string[];
  duplicates: string[];
  rejected: { id: string; error: string }[];
};

/** 五维映射（服务端权威，不信任客户端维度）。未知组合 → null。 */
export function mapEventToDimension(
  type: 'delivered' | 'confirmed' | 'rejected' | 'delivery_failed',
  reason?: 'signature_invalid' | 'timeout' | 'unreachable' | 'bad_status',
): { dimension: Dimension; outcome: 'success' | 'failure' } | null {
  if (type === 'delivered') return { dimension: 'delivery', outcome: 'success' };
  if (type === 'confirmed') return { dimension: 'economic', outcome: 'success' };
  if (type === 'rejected') return { dimension: 'delivery', outcome: 'failure' };
  if (type === 'delivery_failed') {
    // 签名无效是完整性质证，不是可靠性事故——覆盖默认 reliability 映射
    if (reason === 'signature_invalid') return { dimension: 'integrity', outcome: 'failure' };
    return { dimension: 'reliability', outcome: 'failure' };
  }
  return null;
}

function zodFirstError(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join('.');
  return path ? `${path}: ${issue?.message}` : (issue?.message ?? 'invalid event');
}

export async function ingestTradeEvidence(
  db: Database,
  envelope: unknown,
): Promise<IngestTradeEvidenceResult> {
  // 信封骨架校验：脏信封 throw（路由转 400）
  const skeleton = EnvelopeSkeletonSchema.parse(envelope);

  const accepted: string[] = [];
  const duplicates: string[] = [];
  const rejected: { id: string; error: string }[] = [];
  // 有 accepted 事件的 ref → 落库 agentId（撞名时为持名者 id），去重后触发评分
  const scored = new Map<string, string>();

  for (const raw of skeleton.events) {
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) {
      // 毒丸：单事件 zod fail → rejected[]，好事件照收
      const rawId = (raw as { id?: unknown } | null)?.id;
      rejected.push({
        id: typeof rawId === 'string' ? rawId : '(missing)',
        error: zodFirstError(parsed.error),
      });
      continue;
    }
    const event = parsed.data;

    const mapped = mapEventToDimension(event.type, event.reason);
    if (!mapped) {
      rejected.push({
        id: event.id,
        error: `未知的 type/reason 组合：${event.type}/${event.reason ?? '-'}`,
      });
      continue;
    }

    // 身份：每事件 upsert（幂等）；撞名时按返回的持名者 id 落库（T7-8 评审注记）
    const { agentId } = await upsertTavernAgent(db, event.agentRef, event.agentName);

    // 幂等入库：id=酒馆事件 uuid，onConflictDoNothing → 冲突即重复，不重复入库
    const inserted = await db
      .insert(evidence)
      .values({
        id: event.id,
        agentId,
        dimension: mapped.dimension,
        source: 'real',
        sourceType: 'real',
        issuer: 'tavern-market',
        result: mapped.outcome,
        evidenceUri: `tavern://order/${event.orderRef}`,
        payloadHash: event.payloadHash,
      })
      .onConflictDoNothing({ target: evidence.id })
      .returning({ id: evidence.id });

    if (inserted.length > 0) {
      accepted.push(event.id);
      scored.set(event.agentRef, agentId);
    } else {
      duplicates.push(event.id);
    }
  }

  // 评分：accepted 落库后按 agentRef 去重调 computeAndPersist（只调用不修改）
  if (scored.size > 0) {
    const appLike = { db } as unknown as FastifyInstance;
    for (const agentId of scored.values()) {
      await computeAndPersist(appLike, agentId);
    }
  }

  return { accepted, duplicates, rejected };
}
