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
 *   S5-T3/B3：confidential 单（event.confidential=true）全部证据改落 source='real-confidential'
 *   （0.5 档，明细类统一降权——公众可验证性打折，证据权重同步打折）；
 * - 五维映射 mapEventToDimension：
 *     delivered → {delivery, success}
 *     confirmed → {economic, success}；带 negotiation 轨迹时另落一条 negotiation 派生行（S5-T3）
 *     rejected  → {delivery, failure}；带 negotiation 轨迹 = 谈判期拒单（流拍）→
 *                 {negotiation, partial} 只记录不重罚（S5-T3/A4：谈判破裂是正常市场行为）
 *     delivery_failed → {reliability, failure}
 *     delivery_failed+signature_invalid → {integrity, failure}（毒丸：覆盖默认 reliability）
 *     negotiation_expired → {negotiation, partial}（S5-T3：offer 72h 死局，流拍只记录）
 *   A4 红线：流拍（rejected 带轨迹 / negotiation_expired）绝不进 reliability/delivery 扣分；
 *   虚假报价/接受后拒履约仍由 delivery_failed 现有路径承担，本批不新增惩罚路径；
 * - S5-T3 派生行：confirmed + negotiation 轨迹 → 主行 economic 不变，另落
 *   negotiation 维度实战证据（id = `${event.id}#negotiation`，确定性派生 id → 重推幂等）；
 *   outcome=settled → success（达成率）；expired/rejected → partial（流拍中性记录）。
 * - 评分：accepted 落库后按 agentRef 去重调 computeAndPersist（routes/scores.ts，只调用不修改）；
 *   computeAndPersist(app, agentId) 只消费 app.db，这里传 { db } 最小适配其签名；
 * - 身份：每事件 upsertTavernAgent(agentRef, agentName)（T8 服务）；
 *   撞名时 upsert 返回持名者 id（agentId !== tavernExternalId(ref) 可检测）——按返回 id 落库
 *   （T7-8 评审注记：M2 联调如需更严撞名语义另行裁定）。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Dimension, EvidenceResult, Source } from '@a2t/core';
import type { Database } from '../db/client';
import { evidence } from '../db/schema';
import { upsertTavernAgent } from './tavernIdentity';
import { computeAndPersist } from '../routes/scores';

// S5-T3：谈判轨迹事件体（A3 完整面 / B4 聚合面）。zod 非 strict：未知键剥离不拒。
export const NegotiationOutcomeSchema = z.enum(['settled', 'expired', 'rejected']);

/** 完整轨迹面（public/unlisted 单，A3） */
export const NegotiationDetailSchema = z.object({
  rounds: z.number().int().min(1).max(10_000),
  outcome: NegotiationOutcomeSchema,
  initialPrice: z.number().int().min(0),
  finalPrice: z.number().int().min(0),
  responseMsP50: z.number().min(0),
  concessionPattern: z.string().min(1).max(500),
});

/** 聚合面（confidential 单，B4：报价序列是商业机密；承诺哈希在事件顶层） */
export const NegotiationAggregateSchema = z.object({
  rounds: z.number().int().min(1).max(10_000),
  outcome: NegotiationOutcomeSchema,
});

// union 先试完整面：聚合面缺明细字段必然落到第二支，互斥可辨
export const NegotiationSchema = z.union([NegotiationDetailSchema, NegotiationAggregateSchema]);
export type NegotiationEvidenceEvent = z.infer<typeof NegotiationSchema>;

export const EventSchema = z.object({
  id: z.string().uuid(),
  agentRef: z.string().min(1).max(64),
  agentName: z.string().min(1).max(64),
  orderRef: z.string().min(1).max(64),
  type: z.enum(['delivered', 'confirmed', 'rejected', 'delivery_failed', 'negotiation_expired']),
  reason: z.enum(['signature_invalid', 'timeout', 'unreachable', 'bad_status']).optional(),
  occurredAt: z.coerce.date(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  // S5-T1 推送时本就带 confidential/commitmentHash（此前靠非 strict 放行未读）；
  // S5-T3 打分要读 confidential 决定降权档 → 显式入契约
  confidential: z.boolean().optional(),
  commitmentHash: z.string().min(1).max(128).optional(),
  // S5-T3（A3/B4）：谈判轨迹——完整面或聚合面
  negotiation: NegotiationSchema.optional(),
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

/**
 * 五维映射（服务端权威，不信任客户端维度）。未知组合 → null。
 * S5-T3/A4：流拍只记录——rejected 带谈判轨迹 = 谈判期拒单（正常市场行为），
 * 改落 negotiation/partial，不再按交付失败重罚；negotiation_expired 同理。
 */
export function mapEventToDimension(
  type: 'delivered' | 'confirmed' | 'rejected' | 'delivery_failed' | 'negotiation_expired',
  reason?: 'signature_invalid' | 'timeout' | 'unreachable' | 'bad_status',
  negotiation?: NegotiationEvidenceEvent,
): { dimension: Dimension; outcome: EvidenceResult } | null {
  if (type === 'delivered') return { dimension: 'delivery', outcome: 'success' };
  if (type === 'confirmed') return { dimension: 'economic', outcome: 'success' };
  if (type === 'rejected') {
    if (negotiation) return { dimension: 'negotiation', outcome: 'partial' }; // 流拍不重罚
    return { dimension: 'delivery', outcome: 'failure' }; // 交付后质量拒单（维持原映射）
  }
  if (type === 'delivery_failed') {
    // 签名无效是完整性质证，不是可靠性事故——覆盖默认 reliability 映射
    if (reason === 'signature_invalid') return { dimension: 'integrity', outcome: 'failure' };
    return { dimension: 'reliability', outcome: 'failure' };
  }
  if (type === 'negotiation_expired') {
    return { dimension: 'negotiation', outcome: 'partial' }; // offer 72h 死局：流拍只记录
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

    const mapped = mapEventToDimension(event.type, event.reason, event.negotiation);
    if (!mapped) {
      rejected.push({
        id: event.id,
        error: `未知的 type/reason 组合：${event.type}/${event.reason ?? '-'}`,
      });
      continue;
    }

    // 身份：每事件 upsert（幂等）；撞名时按返回的持名者 id 落库（T7-8 评审注记）
    const { agentId } = await upsertTavernAgent(db, event.agentRef, event.agentName);

    // S5-T3/B3：confidential 单明细类证据统一降权 0.5（公开单 real=1.0）
    const source: Source = event.confidential === true ? 'real-confidential' : 'real';

    // 幂等入库：id=酒馆事件 uuid，onConflictDoNothing → 冲突即重复，不重复入库
    const inserted = await db
      .insert(evidence)
      .values({
        id: event.id,
        agentId,
        dimension: mapped.dimension,
        source,
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

    // S5-T3 / 审计 B5【P2】：confirmed + 谈判轨迹 → 另落 negotiation 维度实战证据
    // （economic 主行不变）。派生行独立 upsert，不依赖主行本次是否 inserted：
    // 历史事件重推时主行进 duplicates，但派生行可能因功能上线/丢失而缺失，必须能补回。
    // 确定性派生 id → 重推幂等；outcome=settled → success（达成），expired/rejected → partial（流拍中性）。
    if (event.type === 'confirmed' && event.negotiation) {
      await db
        .insert(evidence)
        .values({
          id: `${event.id}#negotiation`,
          agentId,
          dimension: 'negotiation',
          source,
          sourceType: 'real',
          issuer: 'tavern-market',
          result: event.negotiation.outcome === 'settled' ? 'success' : 'partial',
          evidenceUri: `tavern://order/${event.orderRef}`,
          payloadHash: event.payloadHash,
        })
        .onConflictDoNothing({ target: evidence.id });
    }
  }

  // 评分：accepted 落库后按 agentRef 去重调 computeAndPersist（只调用不修改）
  if (scored.size > 0) {
    // 契约锚点（T9-10 评审）：computeAndPersist 只消费 app.db —— appLike 仅承诺 db
    // 字段，不承诺 FastifyInstance 其余能力（路由/装饰器/日志均不可用，也不需要）。
    const appLike = { db } as unknown as FastifyInstance;
    for (const agentId of scored.values()) {
      await computeAndPersist(appLike, agentId);
    }
  }

  return { accepted, duplicates, rejected };
}
