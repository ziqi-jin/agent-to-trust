/**
 * 酒馆 agent 身份映射（S4-B M2 批 1）。
 *
 * 酒馆（tavern 仓）交易证据将经 POST /ingest/trade-evidence 推入（端点后续任务建）。
 * 身份规则：identity = agentRef（伪 pubkey `tavern-agent-<ref>` 承载，密钥即身份的酒馆变体）。
 *
 * 复用 services/agentIdentity.ts（upsertAgentIdentity）的分支模式：
 * - 按 pubkey（即 agentRef）找既有 → 同一酒馆 agent：改名/续期，id 永不变；
 * - 展示名被他 agent 持有 → 保旧名（零写入，返回持有者 id，与 name-taken 同语义；
 *   调用方可比对该 id 与 tavernExternalId(agentRef) 识别撞名）；
 * - 全新 → 落库，verificationLevel 只用 'basic'（硬红线，绝不伪装 verified）。
 *
 * agentId = ext-tavern-<slug8>-<hash8>：确定性派生自 agentRef，可离线推算。
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { agents } from '../db/schema';

/** 伪 pubkey：酒馆 agent 不持真实密钥，以 agentRef 派生固定标识承载"密钥即身份"。 */
export function tavernPubkey(agentRef: string): string {
  return `tavern-agent-${agentRef}`;
}

/** 展示名：`${agentName}·酒馆`。 */
export function tavernDisplayName(agentName: string): string {
  return `${agentName}·酒馆`;
}

/**
 * ext-tavern-<slug>-<hash8>：
 * slug = agentRef 去 uuid 连字符前 8 位（空则 'x'）；
 * hash8 = sha256('tavern:' + agentRef) 前 8 位 hex。
 */
export function tavernExternalId(agentRef: string): string {
  const slug = agentRef.replace(/-/g, '').slice(0, 8) || 'x';
  const hash8 = createHash('sha256').update(`tavern:${agentRef}`).digest('hex').slice(0, 8);
  return `ext-tavern-${slug}-${hash8}`;
}

/**
 * 酒馆身份 upsert 契约（T7-8 评审 I1/I2，2026-09-06）：
 * - 新 ref 撞名（下方路径 2）：返回持有者 id，调用方可经 `agentId !== tavernExternalId(agentRef)` 检测。
 * - 改名撞名（路径 1 内）：返回自身 id 且静默保留旧展示名——**经返回值不可检测**。
 *   M2 端点消费方改名后必须回读 name 确认是否生效。
 * - agentRef 等价 bearer 凭证（pubkey/agentId 均确定性派生自它）：M2 端点必须从已认证的
 *   agent key 服务端解出 ref，绝不信客户端自报，否则 Sybil/冒名成本为零。
 */
export async function upsertTavernAgent(
  db: Database,
  agentRef: string,
  agentName: string,
): Promise<{ agentId: string }> {
  const pubkey = tavernPubkey(agentRef);
  const name = tavernDisplayName(agentName);
  const agentId = tavernExternalId(agentRef);

  // 1) 按 pubkey（= agentRef）找既有：同一酒馆 agent，id 永不变
  const byPubkey = await db.query.agents.findFirst({ where: eq(agents.pubkey, pubkey) });
  if (byPubkey) {
    if (byPubkey.name !== name) {
      // 改名前先查目标展示名是否被他 agent 持有
      const holder = await db.query.agents.findFirst({ where: eq(agents.name, name) });
      if (!holder) {
        // 改名 → id 不变、展示名更新
        await db
          .update(agents)
          .set({ name, lastSeenAt: new Date() })
          .where(eq(agents.id, byPubkey.id));
      } else if (holder.id !== byPubkey.id) {
        // 改名撞名 → 保旧名：他 agent 不动，本 agent 也保留旧名，返回本 agent id。
        // 与改名成功同返回值，调用方不可检测；M2 需回读 name 确认（见函数头契约）。
        await db
          .update(agents)
          .set({ lastSeenAt: new Date() })
          .where(eq(agents.id, byPubkey.id));
        return { agentId: byPubkey.id };
      }
    } else {
      await db
        .update(agents)
        .set({ lastSeenAt: new Date() })
        .where(eq(agents.id, byPubkey.id));
    }
    return { agentId: byPubkey.id };
  }

  // 2) 展示名被他 agent 持有 → 撞名，保旧名：零写入，返回持有者 id（name-taken 同语义）
  const holder = await db.query.agents.findFirst({ where: eq(agents.name, name) });
  if (holder) {
    return { agentId: holder.id };
  }

  // 3) 全新酒馆 agent：确定性 id + 伪 pubkey + basic（硬红线）
  await db
    .insert(agents)
    .values({
      id: agentId,
      name,
      owner: null,
      status: 'active',
      verificationLevel: 'basic',
      pubkey,
      lastSeenAt: new Date(),
    })
    .onConflictDoNothing();
  return { agentId };
}
