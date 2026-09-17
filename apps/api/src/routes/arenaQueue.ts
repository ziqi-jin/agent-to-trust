/**
 * /arena/queue — 准入队列 + 自动撮合（Phase 2 · T12）。
 *
 * spec §4 申请制：`a2t join`（无 --session）→ 本队列排队 → 撮合 → sessionId → 会话循环。
 *
 * 撮合策略（Node 单线程，enqueue 同步段完成，无竞态）：
 *   - 队列已有 waiting 且合格者 → 两人互为对手（先入=buyer，后入=seller），立即建会话
 *   - 单人排队超过 QUEUE_SOLO_WAIT_MS（默认 12s）→ 配平台脚本买家（先手 OFFER），
 *     保证单个开发者 join 即有对手可打——冷启动关键
 *
 * 门槛（与行为榜资格同源）：最近考场分 ≥ ARENA_GATE_SCORE（v0.2 门槛 350，先放低让人能进来玩）且有 real-benchmark 证据。
 *
 * 平台对家引擎：平台持独立 Ed25519 密钥（持久化在 PLATFORM_KEY_DIR 卷，重启不丢，
 * 防同名异钥 403），推事件走 app.inject 完整安全链（验签 / seq 单调 / nonce 一次性全部生效）。
 * 引擎语义（用户=seller，平台=buyer 先手）：
 *   OFFER(80) → 用户 ACCEPT → 催交付 NEGOTIATE → 用户 DELIVER → VERIFY_RESULT(pass,onTime)
 *   → SETTLE；用户 NEGOTIATE → 重发同价 OFFER（≤3 轮，超限 REJECT）；用户 REJECT → 退出。
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ensureKeypair, signPayload } from 'a2t';
import { DeepSeekClient } from '@a2t/adapters';
import { fetchAgentCard, isArenaReady, type AclAgentCard } from '../a2a/card.js';
import { runA2aBridge, type A2aBridgeStats } from '../a2a/bridge.js';
import { agents, arenaEvents, arenaSessions, agentConnections, creditScores, evidence, testQueue } from '../db/schema';
import { hashConnectionToken } from './connections';
import { upsertAgentIdentity } from '../services/agentIdentity';
import {
  createLiveBrain,
  createScriptedBrain,
  type BrainState,
  type BuyerAction,
  type BuyerBrain,
} from '../counterpart/brains';
import {
  chargeDaily,
  dailyExceeded,
  newSessionBudget,
  type SessionBudget,
} from '../counterpart/budget';
import { personaById } from '../counterpart/personas';
import { jitterParams, pickPersona, seedFromSession } from '../counterpart/select';

/** 准入门槛：最近考场分须达此线（与行为榜资格同源，simulation.ts 榜单2过滤用同一常量）。v0.2 绝对分下考场满分 500，门槛 350 = 考场约 70% 即可入场，保证有人过得了。 */
export const ARENA_GATE_SCORE = 350;

/** 平台脚本买家的 agent 名（统计口径需剔除，导出复用）。 */
export const PLATFORM_NAME = 'arena-buyer-platform';
const PLATFORM_OFFER_PRICE = 80;
const PLATFORM_MAX_NEGOTIATE_ROUNDS = 3;
const ENGINE_POLL_MS = 2000;
/** 引擎兜底：整体 5 分钟无进展则 REJECT 收尾退出，防泄漏。 */
const ENGINE_MAX_WAIT_MS = 5 * 60 * 1000;
/** 全局并发上限：活跃（open/negotiating）会话数达到上限即排队（env QUEUE_MAX_ACTIVE 可调）。 */
const QUEUE_MAX_ACTIVE_DEFAULT = 10;
/** 放行 tick 间隔：扫持久化队列，有空位即撮合（env QUEUE_TICK_MS 可调）。 */
const QUEUE_TICK_MS_DEFAULT = 10_000;

interface QueueEntry {
  ticket: string;
  agentId: string;
  name: string;
  status: 'waiting' | 'matched';
  sessionId?: string;
  soloTimer?: ReturnType<typeof setTimeout>;
  /** 期望对家模式：live 且客户端可用时编 live brain，否则降级 scripted（Ruling 3）。 */
  mode: 'scripted' | 'live';
}

/** 内存队列（单实例部署够用；服务重启清空，SDK 侧重排队即可）。 */
const queue = new Map<string, QueueEntry>();

/** 平台引擎注册表（测试 teardown / 运维兜底用）。 */
const engines = new Set<{ stop: () => void }>();
/** 放行 tick 定时器注册表（测试 teardown 用）。 */
const tickers = new Set<ReturnType<typeof setInterval>>();

/** 停掉所有平台对家引擎并清空未撮合的 solo timer（测试 afterAll 调用）。 */
export function stopAllQueueEngines(): void {
  for (const e of engines) e.stop();
  engines.clear();
  for (const t of tickers) clearInterval(t);
  tickers.clear();
  for (const entry of queue.values()) {
    if (entry.soloTimer) {
      clearTimeout(entry.soloTimer);
      entry.soloTimer = undefined;
    }
  }
}

/** 仅测试：清空整个队列（内存队列是模块级单例，跨用例需隔离）。 */
export function resetQueueForTests(): void {
  stopAllQueueEngines();
  queue.clear();
}

/**
 * A2A 开局的可注入覆盖（仅测试用；生产恒 undefined，走真实 fetch / 默认桥参数）。
 * TypeScript 模块级单例：测试经 `__setA2aRunOverrides` 注入假 fetchImpl，避免真发网络。
 */
export interface A2aRunOverrides {
  fetchImpl?: typeof fetch;
  pollMs?: number;
  maxRounds?: number;
  maxWaitMs?: number;
  failStreakLimit?: number;
}

let a2aRunOverrides: A2aRunOverrides | undefined;

/** 测试注入点：覆盖 A2A 开局的网络/桥参数。传 undefined 复位。 */
export function __setA2aRunOverrides(o?: A2aRunOverrides): void {
  a2aRunOverrides = o;
}

/** token 校验：与登记方同款 `hashConnectionToken`（sha256 hex）+ 常量时间比对（防时序侧信道）。 */
function tokenMatches(token: string, tokenHash: string): boolean {
  const got = Buffer.from(hashConnectionToken(token), 'hex');
  const want = Buffer.from(tokenHash, 'hex');
  if (got.length !== want.length || got.length === 0) return false;
  return timingSafeEqual(got, want);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 准入门槛：真实证据（考场 real-benchmark 或酒馆交易 real）存在 + 最近一次考场分 ≥ ARENA_GATE_SCORE。返回 null=通过。 */
async function checkGate(db: FastifyInstance['db'], agentId: string): Promise<string | null> {
  const [bench] = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        eq(evidence.agentId, agentId),
        // 2026-09-09 老大指令「都要走通一遍」：酒馆真实交易证据（source=real，bearer 机构级上报）
        // 与考场 real-benchmark 同等算真实实战——酒馆 agent 不再被结构性挡在榜2 外。
        // 防刷底线不动：分数 ≥ ARENA_GATE_SCORE 仍强制；且交易有真金白银成本，刷 Arena 激励低。
        inArray(evidence.source, ['real-benchmark', 'real']),
      ),
    )
    .limit(1);
  if (!bench) {
    return '未通过考场门槛：请先跑 npx a2t test 拿到真实考场成绩，或完成酒馆真实交易（行为榜同源资格）';
  }
  const [latest] = await db
    .select({ score: creditScores.score })
    .from(creditScores)
    .where(eq(creditScores.agentId, agentId))
    .orderBy(desc(creditScores.createdAt))
    .limit(1);
  const score = latest?.score ?? 0;
  if (score < ARENA_GATE_SCORE) {
    return `未通过考场门槛：最近考场分 ${score} < ${ARENA_GATE_SCORE}`;
  }
  return null;
}

async function createMatchSession(
  app: FastifyInstance,
  buyerAgentId: string,
  sellerAgentId: string,
  opts: { mode?: 'scripted' | 'live'; adapter?: 'polling' | 'a2a'; a2aCardUrl?: string } = {},
): Promise<{ sessionId: string; seed: string; personaId: string; mode: 'scripted' | 'live' }> {
  const id = `as-${randomUUID().slice(0, 8)}`;
  const mode = opts.mode ?? 'scripted';
  // seed 由 sessionId 派生（服务端生成，用户不可预测，但可复现）；人格按 seed 均权抽签
  const seed = seedFromSession(id);
  const personaId = pickPersona({ mode, seed }).id;
  await app.db.insert(arenaSessions).values({
    id,
    scenario: '标准交易',
    taskSpec: { item: '演示商品（自动撮合场）', quality: 'standard' },
    budget: 100,
    buyerAgentId,
    sellerAgentId,
    counterpartMode: mode,
    counterpartSeed: seed,
    counterpartPersona: personaId,
    adapter: opts.adapter ?? 'polling',
    a2aCardUrl: opts.a2aCardUrl ?? null,
  });
  return { sessionId: id, seed, personaId, mode };
}

/** 活跃会话数（open/negotiating）——并发上限的计量口径。 */
async function activeSessionCount(db: FastifyInstance['db']): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(arenaSessions)
    .where(inArray(arenaSessions.status, ['open', 'negotiating']));
  return row?.n ?? 0;
}

/** 落库排队（幂等）：同 agent 同 lane 已有 waiting 票则复用。 */
async function enqueueWaitingRow(
  db: FastifyInstance['db'],
  agentId: string,
  lane: 'arena' | 'exam',
  mode: 'scripted' | 'live' = 'scripted',
): Promise<{ ticket: string }> {
  const [existing] = await db
    .select({ ticket: testQueue.ticket })
    .from(testQueue)
    .where(
      and(
        eq(testQueue.agentId, agentId),
        eq(testQueue.lane, lane),
        eq(testQueue.status, 'waiting'),
      ),
    )
    .limit(1);
  if (existing) return { ticket: existing.ticket };
  const ticket = `aq-${randomUUID().slice(0, 8)}`;
  await db.insert(testQueue).values({ ticket, agentId, lane, mode });
  return { ticket };
}

/**
 * 按模式构造买家 brain（live 需 client+persona，缺则脚本）。返回 brain + 可选预算句柄。
 * 抽签/抖动由 personaId+seed 决定（可复现）；live 的 token 逐轮上报预算。
 */
function buildBuyerBrain(
  mode: 'scripted' | 'live',
  seed: string,
  personaId: string,
  client: DeepSeekClient | null,
): { brain: BuyerBrain; budget?: SessionBudget } {
  const persona = mode === 'live' ? personaById(personaId) : undefined;
  if (client && persona) {
    const b = newSessionBudget();
    return {
      budget: b,
      brain: createLiveBrain(client, {
        persona,
        params: jitterParams(persona, seed),
        maxRounds: PLATFORM_MAX_NEGOTIATE_ROUNDS,
        onTokens: (n) => {
          b.add(n);
          chargeDaily(n);
        },
      }),
    };
  }
  return {
    brain: createScriptedBrain({
      price: PLATFORM_OFFER_PRICE,
      maxRounds: PLATFORM_MAX_NEGOTIATE_ROUNDS,
    }),
  };
}

/** 排队位置：同 lane FIFO（按 created_at），position 从 1 起。 */
async function queuePosition(
  db: FastifyInstance['db'],
  ticket: string,
): Promise<{ position: number; waitingAhead: number }> {
  const [row] = await db
    .select({ createdAt: testQueue.createdAt, lane: testQueue.lane })
    .from(testQueue)
    .where(eq(testQueue.ticket, ticket))
    .limit(1);
  if (!row) return { position: 0, waitingAhead: 0 };
  const [ahead] = await db
    .select({ n: count() })
    .from(testQueue)
    .where(
      and(
        eq(testQueue.lane, row.lane),
        eq(testQueue.status, 'waiting'),
        lt(testQueue.createdAt, row.createdAt),
      ),
    );
  const waitingAhead = ahead?.n ?? 0;
  return { position: waitingAhead + 1, waitingAhead };
}

/** 撮合成功：标记 admitted + 关联会话。 */
async function markAdmitted(
  db: FastifyInstance['db'],
  ticket: string,
  sessionId: string,
): Promise<void> {
  await db
    .update(testQueue)
    .set({ status: 'admitted', sessionId, admittedAt: new Date() })
    .where(eq(testQueue.ticket, ticket));
}

/**
 * 放行等待者（tick / 运维调用）：arena lane FIFO 两两撮合；
 * 奇数个最后一个配平台脚本买家（等待者已等过真队列，即时可玩优先）。
 */
export async function promoteWaiting(app: FastifyInstance): Promise<void> {
  const max = Number(process.env.QUEUE_MAX_ACTIVE ?? QUEUE_MAX_ACTIVE_DEFAULT);
  const free = max - (await activeSessionCount(app.db));
  if (free <= 0) return;
  const rows = await app.db
    .select()
    .from(testQueue)
    .where(and(eq(testQueue.lane, 'arena'), eq(testQueue.status, 'waiting')))
    .orderBy(asc(testQueue.createdAt))
    .limit(free);
  if (rows.length === 0) return;

  for (let i = 0; i + 1 < rows.length; i += 2) {
    const { sessionId } = await createMatchSession(app, rows[i].agentId, rows[i + 1].agentId);
    await markAdmitted(app.db, rows[i].ticket, sessionId);
    await markAdmitted(app.db, rows[i + 1].ticket, sessionId);
  }
  if (rows.length % 2 === 1) {
    const solo = rows[rows.length - 1];
    try {
      const platformDir = process.env.PLATFORM_KEY_DIR ?? '/app/data/.acl-platform';
      const keys = ensureKeypair(platformDir);
      const identity = await upsertAgentIdentity(app.db, {
        name: PLATFORM_NAME,
        pubkey: keys.publicKeyPem,
      });
      if (identity.error === 'name-taken') {
        throw new Error('平台买家身份冲突（同名异钥，检查 PLATFORM_KEY_DIR 卷是否持久化）');
      }
      // 放行时重算 live 可用性（请求→放行期间日预算可能已超 → 降级脚本，Ruling 3）
      const client = solo.mode === 'live' ? buildLiveClient() : null;
      const mode: 'scripted' | 'live' = client ? 'live' : 'scripted';
      const { sessionId, seed, personaId } = await createMatchSession(
        app,
        identity.agentId,
        solo.agentId,
        { mode },
      );
      await markAdmitted(app.db, solo.ticket, sessionId);
      const { brain, budget } = buildBuyerBrain(mode, seed, personaId, client);
      // 引擎异步跑，不阻塞 tick
      void runBuyerEngine(app, sessionId, identity.agentId, keys, brain, budget);
    } catch (e) {
      console.error(`[arenaQueue] 排队放行（平台撮合）失败 ticket=${solo.ticket}:`, (e as Error).message);
      // 保守：留在 waiting，下一轮 tick 重试
    }
  }
}

/* ------------------------------------------------------------------ */
/* 买家引擎（通用）：驱动 BuyerBrain 走完整安全链 push + 轮询 + 超时收尾。   */
/* 脚本路径 = runPlatformBuyer 薄包装 createScriptedBrain（事件序列不变）。 */
/* ------------------------------------------------------------------ */

/** live 客户端工厂：缺 DEEPSEEK_API_KEY 或日预算超限 → null（调用侧降级 scripted，Ruling 3）。 */
export function buildLiveClient(): DeepSeekClient | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  if (dailyExceeded()) return null;
  return new DeepSeekClient({ apiKey, baseUrl: process.env.DEEPSEEK_BASE_URL });
}

/**
 * 通用买家引擎：开局 brain.opening() → 轮询对家事件 brain.react() → 超时 brain.onTimeout()。
 * 语义（与旧 runPlatformBuyer 等价）：DELIVER → 引擎推 VERIFY_RESULT(pass,onTime)+SETTLE；
 * REJECT/SETTLE → 退出；live 超 token 上限 → 提前 REJECT 收尾（会话 failed，不写行为证据）。
 */
export async function runBuyerEngine(
  app: FastifyInstance,
  sessionId: string,
  buyerAgentId: string,
  keys: { publicKeyPem: string; privateKeyPem: string },
  brain: BuyerBrain,
  budget?: SessionBudget,
): Promise<void> {
  let stopped = false;
  const handle = { stop: () => { stopped = true; } };
  engines.add(handle);

  let nextSeq = 1;
  let maxSeenSeq = 0;
  const state: BrainState = { currentPrice: 0, accepted: false, negotiateRounds: 0 };
  // 对家决策连续故障计数：单次 LLM/网络抖动不杀局，连续 ≥3 次才按降级链（§6）终止。
  let counterpartFailStreak = 0;

  const push = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    const envelope = {
      sessionId,
      seq: nextSeq,
      type,
      fromAgent: buyerAgentId,
      payload,
      nonce: `plat-${randomUUID()}`,
      ts: Date.now(),
    };
    const sig = signPayload(keys.privateKeyPem, envelope);
    const res = await app.inject({
      method: 'POST',
      url: `/arena/sessions/${sessionId}/events`,
      payload: { ...envelope, sig, pubkey: keys.publicKeyPem },
    });
    if (res.statusCode === 201) {
      nextSeq += 1;
      return true;
    }
    // 409（对家抢先结算/会话已收尾/seq 冲突）→ 会话已终结；其他错误同样安全退出
    return false;
  };

  try {
    const opening = brain.opening();
    if (typeof opening.payload.price === 'number') state.currentPrice = opening.payload.price;
    if (!(await push(opening.type, opening.payload))) return;

    const deadline = Date.now() + ENGINE_MAX_WAIT_MS;
    while (!stopped && Date.now() < deadline) {
      await sleep(ENGINE_POLL_MS);
      if (stopped) return;

      // live 成本护栏：已超单局 token 上限 → 提前 REJECT 收尾，不再继续烧 token
      if (budget?.over()) {
        await push('REJECT', { reason: '对家 token 上限，终止' });
        return;
      }

      const fresh = await app.db
        .select()
        .from(arenaEvents)
        .where(and(eq(arenaEvents.sessionId, sessionId), gt(arenaEvents.seq, maxSeenSeq)))
        .orderBy(asc(arenaEvents.seq));

      for (const e of fresh) {
        maxSeenSeq = Math.max(maxSeenSeq, e.seq);
        nextSeq = Math.max(nextSeq, e.seq + 1);
        if (e.fromAgent === buyerAgentId) continue; // 自己的回放

        let action: BuyerAction | null;
        try {
          action = await brain.react(
            { type: e.type, payload: (e.payload ?? null) as Record<string, unknown> | null },
            state,
          );
          // 任意一次成功决策即清零连续故障计数
          counterpartFailStreak = 0;
        } catch (err) {
          counterpartFailStreak += 1;
          console.error(
            `[arena] 对家引擎决策异常（会话 ${sessionId}，连续 ${counterpartFailStreak} 次）：`,
            err,
          );
          if (counterpartFailStreak >= 3) {
            // 连续 ≥3 次对家决策故障：按设计降级链（§6 live→scripted→failed）终止本局。
            // 否则异常会掀翻引擎循环，会话永久停在 negotiating（不结算、不通知）。
            await push('REJECT', { reason: '对家连续决策异常，终止' });
            return;
          }
          // 单次/两次故障容忍：推一条中性对家话术，保持当前价，让对局继续推进（不结算、不动价格）。
          action = { type: 'NEGOTIATE', payload: { note: '对家暂缓回应，请继续' } };
        }
        // 状态推进（brain.react 读到的 state 为事件前值）
        if (e.type === 'ACCEPT') state.accepted = true;
        if (e.type === 'NEGOTIATE' || e.type === 'OFFER') state.negotiateRounds += 1;

        if (action === null) {
          if (e.type === 'DELIVER') {
            // 脚本/LLM brain 都把「验收 + 结算」交给引擎
            if (
              !(await push('VERIFY_RESULT', {
                verdict: 'pass',
                onTime: true,
                note: '平台验收通过',
              }))
            ) {
              return;
            }
            await push('SETTLE', { note: '平台对家确认结算' });
            return;
          }
          if (e.type === 'REJECT' || e.type === 'SETTLE') return; // 用户终止 / 用户抢先结算
          continue; // VERIFY_RESULT/其他：buyer 侧不该收到，忽略
        }

        if (typeof action.payload.price === 'number') state.currentPrice = action.payload.price;
        if (!(await push(action.type, action.payload))) return;
        // 终局动作（磋商超限 REJECT 等）：推完即退出，与旧 runPlatformBuyer 收尾一致
        if (action.type === 'REJECT') return;
      }
    }
    // 兜底超时：REJECT 收尾（会话仍 open/negotiating 时生效）
    const timeout = brain.onTimeout();
    await push(timeout.type, timeout.payload);
  } finally {
    // live 会话落 token 消耗（审计/计费）
    if (budget) {
      try {
        await app.db
          .update(arenaSessions)
          .set({ counterpartTokens: budget.used() })
          .where(eq(arenaSessions.id, sessionId));
      } catch {
        /* 落库失败不阻塞收尾 */
      }
    }
    engines.delete(handle);
  }
}

/** 旧调用点/旧测试兼容：平台脚本买家 = 通用引擎 + 脚本 brain（事件序列字节级不变）。 */
export async function runPlatformBuyer(
  app: FastifyInstance,
  sessionId: string,
  platformAgentId: string,
  keys: { publicKeyPem: string; privateKeyPem: string },
): Promise<void> {
  await runBuyerEngine(
    app,
    sessionId,
    platformAgentId,
    keys,
    createScriptedBrain({ price: PLATFORM_OFFER_PRICE, maxRounds: PLATFORM_MAX_NEGOTIATE_ROUNDS }),
  );
}
/** 单人排队超时 → 配平台买家（live 可用则 LLM 人格买家，否则脚本买家）。 */
async function soloMatchPlatform(app: FastifyInstance, entry: QueueEntry): Promise<void> {
  if (entry.status !== 'waiting' || !queue.has(entry.ticket)) return;
  try {
    const platformDir = process.env.PLATFORM_KEY_DIR ?? '/app/data/.acl-platform';
    const keys = ensureKeypair(platformDir);
    const identity = await upsertAgentIdentity(app.db, {
      name: PLATFORM_NAME,
      pubkey: keys.publicKeyPem,
    });
    if (identity.error === 'name-taken') {
      throw new Error('平台买家身份冲突（同名异钥，检查 PLATFORM_KEY_DIR 卷是否持久化）');
    }
    // Ruling 3：live 期望但客户端不可用（缺 key/日预算超限）→ 静默降级 scripted，撮合不阻塞
    const client = entry.mode === 'live' ? buildLiveClient() : null;
    const mode: 'scripted' | 'live' = client ? 'live' : 'scripted';
    const { sessionId, seed, personaId } = await createMatchSession(
      app,
      identity.agentId,
      entry.agentId,
      { mode },
    );
    // 先构造 brain（persona/预算失败则不置 matched，避免留下无引擎的活会话）
    const { brain, budget } = buildBuyerBrain(mode, seed, personaId, client);
    entry.status = 'matched';
    entry.sessionId = sessionId;
    entry.soloTimer = undefined;
    // 引擎异步跑，不阻塞队列响应
    void runBuyerEngine(app, sessionId, identity.agentId, keys, brain, budget);
  } catch (e) {
    console.error(`[arenaQueue] 平台撮合失败 ticket=${entry.ticket}:`, (e as Error).message);
    // 保守：回到 waiting 继续等真人（solo timer 不再重排，由下一次 join 撮合）
    entry.status = 'waiting';
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                                 */
/* ------------------------------------------------------------------ */

export async function arenaQueueRoutes(app: FastifyInstance): Promise<void> {
  /** 加入准入队列（门槛检查 → 排队 → 同步撮合 / solo 平台对家）。 */
  app.post('/arena/queue', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { name, pubkey } = body;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof pubkey !== 'string' ||
      !pubkey.includes('BEGIN PUBLIC KEY')
    ) {
      return reply.code(400).send({ error: 'name/pubkey 必填（PEM）' });
    }
    const lane = typeof body.lane === 'string' ? body.lane : 'arena';
    if (lane !== 'arena' && lane !== 'exam') {
      return reply.code(400).send({ error: "lane 仅支持 'arena' | 'exam'" });
    }
    // 对家模式：仅 'scripted'|'live'（缺省 scripted）；live 缺客户端/超日预算 → 降级（Ruling 3）
    const requestedMode = body.mode ?? 'scripted';
    if (requestedMode !== 'scripted' && requestedMode !== 'live') {
      return reply.code(400).send({ error: "mode 仅支持 'scripted' | 'live'" });
    }
    const liveClient = requestedMode === 'live' ? buildLiveClient() : null;
    const mode: 'scripted' | 'live' = liveClient ? 'live' : 'scripted';
    const degraded = requestedMode === 'live' && liveClient === null;
    const { model, version } = body as { model?: unknown; version?: unknown };
    const identity = await upsertAgentIdentity(app.db, {
      name: name.trim(),
      pubkey,
      model: typeof model === 'string' ? model : undefined,
      version: typeof version === 'string' ? version : undefined,
    });
    if (identity.error === 'name-taken') {
      return reply.code(403).send({ error: '该 agent 名称已被其他密钥绑定' });
    }
    const agentId = identity.agentId;

    const gateReason = await checkGate(app.db, agentId);
    if (gateReason) return reply.code(403).send({ error: gateReason });

    // 幂等：同一 agent 已在排队，复用票
    const existing = [...queue.values()].find(
      (e) => e.agentId === agentId && e.status === 'waiting',
    );
    if (existing) {
      return reply.code(201).send({ ticket: existing.ticket, status: 'waiting', degraded });
    }

    // 满载或 exam lane：持久化排队（重启不丢，FIFO 由 tick 放行）
    const maxActive = Number(process.env.QUEUE_MAX_ACTIVE ?? QUEUE_MAX_ACTIVE_DEFAULT);
    const active = await activeSessionCount(app.db);
    if (lane === 'exam' || active >= maxActive) {
      const { ticket } = await enqueueWaitingRow(app.db, agentId, lane, mode);
      const { position, waitingAhead } = await queuePosition(app.db, ticket);
      return reply.code(201).send({ ticket, status: 'waiting', lane, position, waitingAhead, degraded });
    }

    const ticket = `aq-${randomUUID().slice(0, 8)}`;
    const entry: QueueEntry = { ticket, agentId, name: name.trim(), status: 'waiting', mode };
    queue.set(ticket, entry);

    // 同步撮合（Node 单线程原子）：找一个 waiting 对手；先入队者当 buyer
    const partner = [...queue.values()].find(
      (e) => e.ticket !== ticket && e.agentId !== agentId && e.status === 'waiting',
    );
    if (partner) {
      if (partner.soloTimer) {
        clearTimeout(partner.soloTimer);
        partner.soloTimer = undefined;
      }
      // 真人 vs 真人：无平台 brain，不写 live 口径（否则污染 live 行为分桶，见 T7 评审）。
      const { sessionId } = await createMatchSession(app, partner.agentId, entry.agentId);
      // 先入队者的 SDK 还在轮询它的内存 ticket：同步撮合删 entry 后必须把 admitted
      // 落库，否则它 GET 404 只能傻等到 5 分钟排队超时（0902 双真实撮合实锤的 bug）
      await app.db.insert(testQueue).values({
        ticket: partner.ticket,
        agentId: partner.agentId,
        lane: 'arena',
        status: 'admitted',
        sessionId,
        admittedAt: new Date(),
      });
      partner.status = 'matched';
      partner.sessionId = sessionId;
      entry.status = 'matched';
      entry.sessionId = sessionId;
      queue.delete(partner.ticket);
      queue.delete(ticket);
      return reply.code(201).send({ ticket, status: 'matched', sessionId, degraded });
    }

    // 单人：QUEUE_SOLO_WAIT_MS 后配平台买家（live 可用则 LLM 人格）
    const soloWait = Number(process.env.QUEUE_SOLO_WAIT_MS ?? 12000);
    const timer = setTimeout(() => {
      void soloMatchPlatform(app, entry);
    }, soloWait);
    timer.unref?.(); // 不阻止进程退出
    entry.soloTimer = timer;

    return reply.code(201).send({ ticket, status: 'waiting', degraded });
  });

  /** 查排队状态。内存未命中 → 读库（重启恢复 / 已放行）。 */
  app.get('/arena/queue/:ticket', async (req, reply) => {
    const { ticket } = req.params as { ticket: string };
    const entry = queue.get(ticket);
    if (!entry) {
      const [row] = await app.db
        .select()
        .from(testQueue)
        .where(eq(testQueue.ticket, ticket))
        .limit(1);
      if (!row) {
        return reply.code(404).send({ error: '排队票不存在（可能已撮合并清理，或服务重启）' });
      }
      if (row.status === 'waiting') {
        const { position, waitingAhead } = await queuePosition(app.db, ticket);
        return { status: 'waiting', lane: row.lane, position, waitingAhead };
      }
      if (row.sessionId) {
        const [session] = await app.db
          .select({ status: arenaSessions.status })
          .from(arenaSessions)
          .where(eq(arenaSessions.id, row.sessionId))
          .limit(1);
        if (session && (session.status === 'settled' || session.status === 'failed')) {
          return { status: 'done' };
        }
        return { status: 'matched', sessionId: row.sessionId };
      }
      return { status: row.status };
    }
    if (entry.status === 'matched') {
      return { status: 'matched', sessionId: entry.sessionId };
    }
    return { status: 'waiting' };
  });

  /**
   * A2A 开局入口（Task 8）：已登记连接 + 合法 token → 建 `adapter='a2a'` 会话并起双向桥。
   *
   * 语义（spec §2.3）：平台当 buyer（对家引擎走 live 人格抽签路径，出 OFFER），
   * 用户当 seller；桥代表用户在表内注入其 A2A 回复（签名信封走既有安全链）。
   * 失败路径一律 4xx（不抛穿）：连接不存在/已撤销、token 不符、卡片不可读/未过门槛。
   */
  app.post('/arena/connections/:id/runs', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1) 取连接：不存在 → 404；已撤销 → 410。
    const [conn] = await app.db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, id));
    if (!conn) return reply.code(404).send({ error: '连接不存在' });
    if (conn.revokedAt) return reply.code(410).send({ error: '连接已撤销' });

    // 2) 身份校验：body.token 或 Authorization: Bearer；不符 → 401（不建会话、不拉卡片）。
    const auth = req.headers['authorization'];
    const bearer =
      typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const token = typeof body.token === 'string' && body.token ? body.token : bearer;
    if (!token || !tokenMatches(token, conn.tokenHash)) {
      return reply.code(401).send({ error: 'token 校验失败' });
    }

    // 3) 读 Agent Card + 分流：不可读 / 未过门槛 → 4xx（本局不建）。
    const cardResult = await fetchAgentCard(conn.cardUrl, { fetchImpl: a2aRunOverrides?.fetchImpl });
    if (!cardResult.ok) {
      return reply.code(422).send({ error: `Agent Card 读取失败：${cardResult.reason}` });
    }
    const card: AclAgentCard = cardResult.card;
    if (!isArenaReady(card)) {
      return reply
        .code(422)
        .send({ error: 'Agent Card 未达 Arena 门槛（需 x-a2t.arenaReady=true 且有 negotiation/trade skill）' });
    }

    // 4) 建会话 + 起桥（后台，不阻塞响应）。
    try {
      const platformDir = process.env.PLATFORM_KEY_DIR ?? '/app/data/.acl-platform';
      const keys = ensureKeypair(platformDir);

      // 身份绑定（Task 10 fix1，Ruling 16 收紧）：**先读卖家 agent，再分支**，绝不无条件覆写——
      // 登记时显式给的 {agentId} 可能自持密钥，平台顶写会代其签名，违反「密钥即身份」。
      //   1) 行不存在 → 404（防御；FK 下不应发生）
      //   2) pubkey 为空（name 铸造的平台托管身份）→ 绑平台公钥（WHERE 保留幂等守卫）
      //   3) pubkey 已是平台公钥 → 幂等，跳过 UPDATE
      //   4) 其他值（自持密钥）→ 409，不覆写、不建会话
      const [seller] = await app.db.select().from(agents).where(eq(agents.id, conn.agentId));
      if (!seller) {
        return reply.code(404).send({ error: '连接指向的 agent 不存在' });
      }
      if (seller.pubkey === null) {
        await app.db
          .update(agents)
          .set({ pubkey: keys.publicKeyPem })
          .where(and(eq(agents.id, conn.agentId), isNull(agents.pubkey)));
      } else if (seller.pubkey !== keys.publicKeyPem) {
        return reply.code(409).send({
          error: '该 agent 已自持密钥，A2A 托管接入请另用 name 登记以铸造平台托管身份',
        });
      }

      const identity = await upsertAgentIdentity(app.db, {
        name: PLATFORM_NAME,
        pubkey: keys.publicKeyPem,
      });
      if (identity.error === 'name-taken') {
        throw new Error('平台买家身份冲突（同名异钥，检查 PLATFORM_KEY_DIR 卷是否持久化）');
      }

      // live 可用则 LLM 人格对家；缺 key/超日预算 → 降级 scripted（Ruling 3），不影响建局。
      const client = buildLiveClient();
      const mode: 'scripted' | 'live' = client ? 'live' : 'scripted';
      const { sessionId, seed, personaId } = await createMatchSession(
        app,
        identity.agentId, // buyer = 平台对家
        conn.agentId, // seller = 用户（桥代表其注入签名事件）
        { mode, adapter: 'a2a', a2aCardUrl: conn.cardUrl },
      );
      const { brain, budget } = buildBuyerBrain(mode, seed, personaId, client);
      // 平台对家引擎（出 OFFER）异步跑
      void runBuyerEngine(app, sessionId, identity.agentId, keys, brain, budget);

      // 双向桥：代表用户侧（seller）把对家事件翻 A2A、把用户回复签名注入内核。
      let lastStats: A2aBridgeStats | undefined;
      void runA2aBridge(app, {
        sessionId,
        platformAgentId: conn.agentId,
        keys,
        card,
        token,
        fetchImpl: a2aRunOverrides?.fetchImpl,
        pollMs: a2aRunOverrides?.pollMs,
        maxRounds: a2aRunOverrides?.maxRounds,
        maxWaitMs: a2aRunOverrides?.maxWaitMs,
        failStreakLimit: a2aRunOverrides?.failStreakLimit,
        onStats: (s) => {
          lastStats = s;
        },
      })
        .then(async () => {
          // 桥终局后把轮次统计落库（Task 1 新列；审计/口径用）。
          await app.db
            .update(arenaSessions)
            .set({
              a2aRounds: lastStats?.rounds ?? 0,
              a2aInvalidRounds: lastStats?.invalidRounds ?? 0,
            })
            .where(eq(arenaSessions.id, sessionId));
        })
        .catch(() => {
          /* 落库失败不抛穿（桥已自行收敛失败路径） */
        });

      return reply.code(202).send({ sessionId, status: 'running' });
    } catch (e) {
      return reply.code(500).send({ error: 'A2A 开局失败：' + (e as Error).message });
    }
  });

  // 放行 tick：定时扫持久化队列，有空位即撮合（测试可放大 QUEUE_TICK_MS 禁用）
  const tickMs = Number(process.env.QUEUE_TICK_MS ?? QUEUE_TICK_MS_DEFAULT);
  const ticker = setInterval(() => {
    void promoteWaiting(app).catch((e) =>
      console.error('[arenaQueue] tick 放行失败:', (e as Error).message),
    );
  }, tickMs);
  ticker.unref?.();
  tickers.add(ticker);
}
