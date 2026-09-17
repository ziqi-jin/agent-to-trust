/**
 * A2A 双向桥（Task 6）：内核与 A2A 世界之间的**双向翻译器**（防腐层）。
 *
 * 桥是对家引擎的替身：内核照旧发/收事件，桥在中间做
 * `内核事件 → A2A message → 用户 agent → 回复 → 签名 → 注入内核`。
 *
 * **内核零改动**：本模块只读 `arena_events`、只经既有公开入口
 * `POST /arena/sessions/:id/events`（`app.inject`）注入事件，复用与
 * `arenaQueue.runBuyerEngine` 同构的「轮询 → 翻译 → push 签名信封」循环。
 *
 * 行为（spec §2 数据流 + §7 P0）：
 *  1. 轮询内核事件：取 `seq > maxSeenSeq` 且 `fromAgent !== platformAgentId` 的事件（对家侧）。
 *  2. 翻 A2A 打用户：`toA2aMessage` 造自包含文本 → `sendA2aMessage(card, msg, { token })`。
 *     `contextId`/`taskId` 用 sessionId 派生的稳定值。
 *  3. 收回复：发送失败（超时/http/parse）→ 计连续失败；回复解析不出动作 → 无效回合（不注入，本地计数）。
 *     `ok:true` → `fromParsedAction` → 包签名信封（与 arenaQueue 同构）→ `app.inject` 注入。
 *  4. 终局退出：对家 SETTLE/REJECT → 退出；注入 REJECT/SETTLE → 退出；回合超限/全局超时 → 退出；
 *     连续失败达阈值 → 退出（对应降级链；best-effort 推 REJECT 收尾）。
 *  5. 失败不得抛穿：全流程 try/catch 收敛，最终 resolve。
 *
 * 安全底线：注入走完整验签链（Ed25519 + pubkey 绑定 + seq 单调 + nonce 一次性）。
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { signPayload } from 'agent-to-trust';
import { arenaEvents } from '../db/schema';
import { parseA2aAction } from './actions.js';
import type { AclAgentCard } from './card.js';
import { sendA2aMessage, type A2aPart } from './client.js';
import { fromParsedAction, toA2aMessage, type KernelEvent } from './wire.js';

/** 轮询间隔（默认 2s，与对家引擎一致；测试可注入 `pollMs` 调小）。 */
export const A2A_BRIDGE_POLL_MS = 2000;
/** 最大处理回合数（防无界循环；测试可注入 `maxRounds`）。 */
export const A2A_MAX_ROUNDS = 20;
/** 对端 A2A agent 连续失败阈值（超限即降级退出）。 */
export const A2A_FAIL_STREAK_LIMIT = 3;
/** 全局等待上限（兜底收尾，防泄漏）。 */
export const A2A_BRIDGE_MAX_WAIT_MS = 5 * 60 * 1000;

/** 桥退出原因。 */
export type A2aBridgeExitReason =
  | 'settle'
  | 'reject'
  | 'max-rounds'
  | 'timeout'
  | 'fail-streak'
  | 'inject-failed'
  | 'error';

/** 桥运行统计（P0 无内核计数时本地汇报）。 */
export interface A2aBridgeStats {
  /** 已处理的入站回合数（= 发出的 A2A 请求数，含失败/无效回合）。 */
  rounds: number;
  /** 无效回合数（回复解析不出动作 → 未注入）。 */
  invalidRounds: number;
  /** 当前连续失败计数。 */
  failStreak: number;
  /** 成功注入内核的事件数。 */
  injected: number;
  /** 退出原因（运行中为 null）。 */
  exitReason: A2aBridgeExitReason | null;
}

export interface A2aBridgeOpts {
  sessionId: string;
  /** 桥代表的内核 agent（A2A 用户侧身份）；注入事件的 `fromAgent`。 */
  platformAgentId: string;
  /** 该身份的 Ed25519 密钥（照 arenaQueue 的 keys 形状）。 */
  keys: { publicKeyPem: string; privateKeyPem: string };
  /** 用户 A2A agent 的 Agent Card（`fetchAgentCard` 产出）。 */
  card: AclAgentCard;
  /** 可选 Bearer token。 */
  token?: string;

  /** 注入 fetch（测试不真发网络）。 */
  fetchImpl?: typeof fetch;
  /** 轮询间隔覆盖（测试调小）。 */
  pollMs?: number;
  /** 回合上限覆盖。 */
  maxRounds?: number;
  /** 连续失败阈值覆盖（测试调小）。 */
  failStreakLimit?: number;
  /** 全局等待上限覆盖。 */
  maxWaitMs?: number;
  /** 统计回调（每次状态更新触发一次）。 */
  onStats?: (stats: A2aBridgeStats) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 跑一条 A2A 桥循环：轮询对家事件 → 翻 A2A → 解析回复 → 签名注入内核。
 * 终局/超时/连续失败即退出。**绝不抛穿**（内部错误收敛，最终 resolve）。
 */
export async function runA2aBridge(app: FastifyInstance, opts: A2aBridgeOpts): Promise<void> {
  const {
    sessionId,
    platformAgentId,
    keys,
    card,
    token,
    fetchImpl,
    pollMs = A2A_BRIDGE_POLL_MS,
    maxRounds = A2A_MAX_ROUNDS,
    failStreakLimit = A2A_FAIL_STREAK_LIMIT,
    maxWaitMs = A2A_BRIDGE_MAX_WAIT_MS,
    onStats,
  } = opts;

  const stats: A2aBridgeStats = {
    rounds: 0,
    invalidRounds: 0,
    failStreak: 0,
    injected: 0,
    exitReason: null,
  };
  const report = (): void => {
    try {
      onStats?.({ ...stats });
    } catch {
      /* 观测回调异常不影响桥 */
    }
  };

  let nextSeq = 1;
  let maxSeenSeq = 0;
  const history: KernelEvent[] = [];
  /** 已注入事件的 seq → 当时 A2A 往返轮次（供自己事件回放时正确归轮）。 */
  const roundBySeq = new Map<number, number>();
  const contextId = `acl-${sessionId}`;
  const deadline = Date.now() + maxWaitMs;

  /**
   * 与 arenaQueue 同构：包签名信封 → app.inject 注入；非 201 即安全失败（不抛）。
   * 409（seq 冲突）时**重读事件校准 nextSeq 后重试一次**（有界），仅在重试仍失败时判注入失败；
   * 非 409 错误直接安全失败。
   */
  const push = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    const attempt = async (): Promise<{ ok: true } | { ok: false; conflict: boolean }> => {
      try {
        const seq = nextSeq;
        const envelope = {
          sessionId,
          seq,
          type,
          fromAgent: platformAgentId,
          payload,
          nonce: `bridge-${randomUUID()}`,
          ts: Date.now(),
        };
        const sig = signPayload(keys.privateKeyPem, envelope);
        const res = await app.inject({
          method: 'POST',
          url: `/arena/sessions/${sessionId}/events`,
          payload: { ...envelope, sig, pubkey: keys.publicKeyPem },
        });
        if (res.statusCode === 201) {
          nextSeq = seq + 1;
          roundBySeq.set(seq, stats.rounds);
          return { ok: true };
        }
        // 409：会话已终结 / seq 冲突；其他错误同样安全退出
        return { ok: false, conflict: res.statusCode === 409 };
      } catch {
        return { ok: false, conflict: false };
      }
    };

    let result = await attempt();
    if (result.ok) return true;
    if (result.conflict) {
      // seq 竞争（对家/旁路事件抢先占号）→ 重读事件校准 nextSeq，再试一次（有界）
      try {
        const evs = await app.db
          .select()
          .from(arenaEvents)
          .where(eq(arenaEvents.sessionId, sessionId));
        for (const ev of evs) {
          maxSeenSeq = Math.max(maxSeenSeq, ev.seq);
          nextSeq = Math.max(nextSeq, ev.seq + 1);
        }
        result = await attempt();
        if (result.ok) return true;
      } catch {
        /* 重读失败 → 放弃，按注入失败处理 */
      }
    }
    return false;
  };

  try {
    while (stats.rounds < maxRounds && Date.now() < deadline) {
      let fresh: Array<{
        seq: number;
        type: string;
        fromAgent: string;
        payload: unknown;
      }>;
      try {
        fresh = await app.db
          .select()
          .from(arenaEvents)
          .where(and(eq(arenaEvents.sessionId, sessionId), gt(arenaEvents.seq, maxSeenSeq)))
          .orderBy(asc(arenaEvents.seq));
      } catch (err) {
        console.error(`[a2a-bridge] 读事件失败（会话 ${sessionId}）：`, (err as Error).message);
        stats.exitReason = 'error';
        return;
      }

      if (fresh.length === 0) {
        await sleep(pollMs);
        continue;
      }

      let onlyOwn = true;
      for (const e of fresh) {
        maxSeenSeq = Math.max(maxSeenSeq, e.seq);
        nextSeq = Math.max(nextSeq, e.seq + 1);

        // 自己注入的回放：只入历史（供下轮摘要按「你」归属），不再翻 A2A 打用户 agent
        if (e.fromAgent === platformAgentId) {
          history.push({
            type: e.type,
            payload: e.payload,
            sessionId,
            seq: e.seq,
            round: roundBySeq.get(e.seq) ?? stats.rounds + 1,
            fromAgent: e.fromAgent,
          });
          continue;
        }
        onlyOwn = false;

        // 对家终局事件：桥退出，不再打扰用户 agent
        if (e.type === 'SETTLE' || e.type === 'REJECT') {
          stats.exitReason = e.type === 'SETTLE' ? 'settle' : 'reject';
          return;
        }

        if (stats.rounds >= maxRounds) {
          stats.exitReason = 'max-rounds';
          return;
        }
        stats.rounds += 1;

        // 轮次 = 桥自维护的 A2A 往返计数（Ruling 7）；**不**用内核 seq / 历史长度
        const round = stats.rounds;
        const historyBefore = history.slice();
        const kernelEvent: KernelEvent = {
          type: e.type,
          payload: e.payload ?? null,
          sessionId,
          seq: e.seq,
          round,
          fromAgent: e.fromAgent,
        };
        history.push({
          type: e.type,
          payload: e.payload,
          sessionId,
          seq: e.seq,
          round,
          fromAgent: e.fromAgent,
        });

        // 内核事件 → A2A 自包含消息 → 打用户 agent（selfAgentId=平台侧身份 → 历史按「你/对家」归属）
        const { text, metadata } = toA2aMessage(kernelEvent, historyBefore, { selfAgentId: platformAgentId });
        const taskId = `acl-${sessionId}-r${e.seq}`;
        const send = await sendA2aMessage(
          card,
          { contextId, taskId, text, metadata },
          { token, fetchImpl },
        );

        if (!send.ok) {
          // failStreak 按「入站事件」计（与 runBuyerEngine 同构：每个失败回合 +1），非按时间/网络调用计
          stats.failStreak += 1;
          report();
          if (stats.failStreak >= failStreakLimit) {
            // 降级链：对端连续无响应 → best-effort 推 REJECT 收尾，避免会话悬挂
            await push('REJECT', { reason: '对端 A2A agent 连续无响应，终止' });
            stats.exitReason = 'fail-streak';
            return;
          }
          continue;
        }
        stats.failStreak = 0;

        // A2A 回复 → 内核动作（传 parts → DELIVER 强制走 normalizeArtifact 校验闭合）
        const parsed = parseA2aAction({ parts: send.parts as unknown[] });
        const mapped = fromParsedAction(parsed, send.parts as A2aPart[]);
        if (!mapped) {
          stats.invalidRounds += 1;
          report();
          continue;
        }

        const ok = await push(mapped.type, mapped.payload as Record<string, unknown>);
        if (!ok) {
          stats.exitReason = 'inject-failed';
          return;
        }
        stats.injected += 1;
        report();

        // 用户侧终局动作：注入后退出
        if (mapped.type === 'REJECT' || mapped.type === 'SETTLE') {
          stats.exitReason = mapped.type === 'SETTLE' ? 'settle' : 'reject';
          return;
        }
      }

      // 本轮只读到自己的事件（无对家新事件）→ 让出，避免忙等
      if (onlyOwn) await sleep(pollMs);
    }

    stats.exitReason = Date.now() >= deadline ? 'timeout' : 'max-rounds';
  } catch (err) {
    // 兜底：任何未预期错误都不许抛穿调用方
    console.error(`[a2a-bridge] 桥异常（会话 ${sessionId}）：`, (err as Error).message);
    stats.exitReason = 'error';
  } finally {
    report();
  }
}
