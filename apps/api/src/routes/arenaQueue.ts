/**
 * /arena/queue — 准入队列 + 自动撮合（Phase 2 · T12）。
 *
 * spec §4 申请制：`acl join`（无 --session）→ 本队列排队 → 撮合 → sessionId → 会话循环。
 *
 * 撮合策略（Node 单线程，enqueue 同步段完成，无竞态）：
 *   - 队列已有 waiting 且合格者 → 两人互为对手（先入=buyer，后入=seller），立即建会话
 *   - 单人排队超过 QUEUE_SOLO_WAIT_MS（默认 12s）→ 配平台脚本买家（先手 OFFER），
 *     保证单个开发者 join 即有对手可打——冷启动关键
 *
 * 门槛（与行为榜资格同源）：最近考场分 ≥ ARENA_GATE_SCORE（冷启动 400，先放低让人能进来玩）且有 real-benchmark 证据。
 *
 * 平台对家引擎：平台持独立 Ed25519 密钥（持久化在 PLATFORM_KEY_DIR 卷，重启不丢，
 * 防同名异钥 403），推事件走 app.inject 完整安全链（验签 / seq 单调 / nonce 一次性全部生效）。
 * 引擎语义（用户=seller，平台=buyer 先手）：
 *   OFFER(80) → 用户 ACCEPT → 催交付 NEGOTIATE → 用户 DELIVER → VERIFY_RESULT(pass,onTime)
 *   → SETTLE；用户 NEGOTIATE → 重发同价 OFFER（≤3 轮，超限 REJECT）；用户 REJECT → 退出。
 */

import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ensureKeypair, signPayload } from 'sealit-sdk';
import { arenaEvents, arenaSessions, creditScores, evidence, testQueue } from '../db/schema';
import { upsertAgentIdentity } from '../services/agentIdentity';

/** 准入门槛：最近考场分须达此线（与行为榜资格同源，simulation.ts 榜单2过滤用同一常量）。冷启动 400：门槛放低，更多 agent 进得来。 */
export const ARENA_GATE_SCORE = 400;

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
    return '未通过考场门槛：请先跑 npx sealit-sdk test 拿到真实考场成绩，或完成酒馆真实交易（行为榜同源资格）';
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
): Promise<string> {
  const id = `as-${randomUUID().slice(0, 8)}`;
  await app.db.insert(arenaSessions).values({
    id,
    scenario: '标准交易',
    taskSpec: { item: '演示商品（自动撮合场）', quality: 'standard' },
    budget: 100,
    buyerAgentId,
    sellerAgentId,
  });
  return id;
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
  await db.insert(testQueue).values({ ticket, agentId, lane });
  return { ticket };
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
    const sessionId = await createMatchSession(app, rows[i].agentId, rows[i + 1].agentId);
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
      const sessionId = await createMatchSession(app, identity.agentId, solo.agentId);
      await markAdmitted(app.db, solo.ticket, sessionId);
      // 引擎异步跑，不阻塞 tick
      void runPlatformBuyer(app, sessionId, identity.agentId, keys);
    } catch (e) {
      console.error(`[arenaQueue] 排队放行（平台撮合）失败 ticket=${solo.ticket}:`, (e as Error).message);
      // 保守：留在 waiting，下一轮 tick 重试
    }
  }
}

/* ------------------------------------------------------------------ */
/* 平台脚本买家引擎（buyer 先手，规则确定，非 LLM）                      */
/* ------------------------------------------------------------------ */

async function runPlatformBuyer(
  app: FastifyInstance,
  sessionId: string,
  platformAgentId: string,
  keys: { publicKeyPem: string; privateKeyPem: string },
): Promise<void> {
  let stopped = false;
  const handle = { stop: () => { stopped = true; } };
  engines.add(handle);

  let nextSeq = 1;
  let maxSeenSeq = 0;
  let negotiateRounds = 0;
  let accepted = false;

  const push = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    const envelope = {
      sessionId,
      seq: nextSeq,
      type,
      fromAgent: platformAgentId,
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
    if (!(await push('OFFER', { price: PLATFORM_OFFER_PRICE, note: '平台一口价，接受即交付' }))) {
      return;
    }

    const deadline = Date.now() + ENGINE_MAX_WAIT_MS;
    while (!stopped && Date.now() < deadline) {
      await sleep(ENGINE_POLL_MS);
      if (stopped) return;

      const fresh = await app.db
        .select()
        .from(arenaEvents)
        .where(and(eq(arenaEvents.sessionId, sessionId), gt(arenaEvents.seq, maxSeenSeq)))
        .orderBy(asc(arenaEvents.seq));

      for (const e of fresh) {
        maxSeenSeq = Math.max(maxSeenSeq, e.seq);
        nextSeq = Math.max(nextSeq, e.seq + 1);
        if (e.fromAgent === platformAgentId) continue; // 自己的回放

        if (e.type === 'ACCEPT' && !accepted) {
          accepted = true;
          // 催交付：给 seller 一个明确的"该 DELIVER 了"信号事件
          if (!(await push('NEGOTIATE', { note: '已接受报价，请交付' }))) return;
        } else if (e.type === 'DELIVER') {
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
        } else if (e.type === 'NEGOTIATE' || e.type === 'OFFER') {
          // 用户继续谈价（或反向报价）：重发一口价，超限 REJECT
          negotiateRounds += 1;
          if (negotiateRounds > PLATFORM_MAX_NEGOTIATE_ROUNDS) {
            await push('REJECT', { reason: '平台一口价，磋商超限，终止' });
            return;
          }
          if (
            !(await push('OFFER', {
              price: PLATFORM_OFFER_PRICE,
              note: `价格不变（磋商 ${negotiateRounds}/${PLATFORM_MAX_NEGOTIATE_ROUNDS}）`,
            }))
          ) {
            return;
          }
        } else if (e.type === 'REJECT' || e.type === 'SETTLE') {
          return; // 用户终止 / 用户抢先结算
        }
        // VERIFY_RESULT/其他：buyer 侧不该收到，忽略
      }
    }
    // 兜底超时：REJECT 收尾（会话仍 open/negotiating 时生效）
    await push('REJECT', { reason: '平台对家等待超时，收尾退出' });
  } finally {
    engines.delete(handle);
  }
}

/** 单人排队超时 → 配平台买家。 */
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
    const sessionId = await createMatchSession(app, identity.agentId, entry.agentId);
    entry.status = 'matched';
    entry.sessionId = sessionId;
    entry.soloTimer = undefined;
    // 引擎异步跑，不阻塞队列响应
    void runPlatformBuyer(app, sessionId, identity.agentId, keys);
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
      return reply.code(201).send({ ticket: existing.ticket, status: 'waiting' });
    }

    // 满载或 exam lane：持久化排队（重启不丢，FIFO 由 tick 放行）
    const maxActive = Number(process.env.QUEUE_MAX_ACTIVE ?? QUEUE_MAX_ACTIVE_DEFAULT);
    const active = await activeSessionCount(app.db);
    if (lane === 'exam' || active >= maxActive) {
      const { ticket } = await enqueueWaitingRow(app.db, agentId, lane);
      const { position, waitingAhead } = await queuePosition(app.db, ticket);
      return reply.code(201).send({ ticket, status: 'waiting', lane, position, waitingAhead });
    }

    const ticket = `aq-${randomUUID().slice(0, 8)}`;
    const entry: QueueEntry = { ticket, agentId, name: name.trim(), status: 'waiting' };
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
      const sessionId = await createMatchSession(app, partner.agentId, entry.agentId);
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
      return reply.code(201).send({ ticket, status: 'matched', sessionId });
    }

    // 单人：QUEUE_SOLO_WAIT_MS 后配平台脚本买家
    const soloWait = Number(process.env.QUEUE_SOLO_WAIT_MS ?? 12000);
    const timer = setTimeout(() => {
      void soloMatchPlatform(app, entry);
    }, soloWait);
    timer.unref?.(); // 不阻止进程退出
    entry.soloTimer = timer;

    return reply.code(201).send({ ticket, status: 'waiting' });
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
