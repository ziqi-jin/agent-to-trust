/**
 * /arena — Arena 市场会话与 ACL 协议事件流（Phase 2）。
 *
 * 会话 = 两个 agent 的回合制交易场景。事件 envelope（被签名的载荷）：
 *   { sessionId, seq, type, fromAgent, payload, nonce, ts }
 *   + sig（Ed25519 canonical-json）+ pubkey（声明身份）
 *
 * 安全校验链：type 白名单 → 会话状态 → 角色校验 → 密钥绑定（agent 注册 pubkey）
 *   → 验签 → seq 会话内单调 → nonce 全局一次性（唯一索引兜底）。
 * 长轮询：GET ?after=seq&wait=秒 —— 无新事件挂起，至多 min(wait,30)s。
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { verifyPayload } from 'sealit-sdk';
import { COUNTERPART_THEORY, type CounterpartTheoryKey } from '@acl/core';
import { agents, arenaEvents, arenaSessions } from '../db/schema';
import { upsertAgentIdentity } from '../services/agentIdentity';
import { settleSession } from '../services/arenaSettle';
import { sweepStaleSessions } from '../services/arenaSweep';

const EVENT_TYPES = new Set([
  'OFFER',
  'NEGOTIATE',
  'ACCEPT',
  'REJECT',
  'DELIVER',
  'VERIFY_RESULT',
  'SETTLE',
]);

/** 长轮询等待者：sessionId → resolvers（进程内；单实例部署够用）。 */
const waiters = new Map<string, Set<() => void>>();

function notifyWaiters(sessionId: string): void {
  const set = waiters.get(sessionId);
  if (!set) return;
  const pending = [...set];
  set.clear();
  waiters.delete(sessionId);
  for (const resolve of pending) resolve();
}

interface WaiterHandle {
  promise: Promise<void>;
  /** 摘除自己（超时/主动放弃时调用），避免 resolver 永久留在 set 里。 */
  cancel: () => void;
}

function registerWaiter(sessionId: string): WaiterHandle {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  let set = waiters.get(sessionId);
  if (!set) {
    set = new Set();
    waiters.set(sessionId, set);
  }
  set.add(resolve);
  return {
    promise,
    cancel: () => {
      const s = waiters.get(sessionId);
      if (!s) return;
      s.delete(resolve);
      if (s.size === 0) waiters.delete(sessionId);
    },
  };
}

/** 仅测试用：观测长轮询等待者（审计 A6 泄漏回归）。 */
export function __debugWaiterCounts(): Record<string, number> {
  return Object.fromEntries([...waiters].map(([k, v]) => [k, v.size]));
}

export async function arenaRoutes(app: FastifyInstance): Promise<void> {
  /** 创建会话（调度器/内部调用）。 */
  app.post('/arena/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { scenario, taskSpec, budget, deadline, buyerAgentId, sellerAgentId } = body;
    if (typeof scenario !== 'string' || !scenario.trim()) {
      return reply.code(400).send({ error: 'scenario 必填' });
    }
    const id = `as-${randomUUID().slice(0, 8)}`;
    await app.db.insert(arenaSessions).values({
      id,
      scenario,
      taskSpec: (taskSpec ?? null) as Record<string, unknown> | null,
      budget: typeof budget === 'number' ? budget : null,
      deadline: typeof deadline === 'string' ? new Date(deadline) : null,
      buyerAgentId: typeof buyerAgentId === 'string' ? buyerAgentId : null,
      sellerAgentId: typeof sellerAgentId === 'string' ? sellerAgentId : null,
    });
    return reply.code(201).send({ id, status: 'open' });
  });

  /** 身份注册（Arena 参与者凭钥加入；与考场同一身份体系）。 */
  app.post('/arena/register', async (req, reply) => {
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
    return reply.code(201).send({ agentId: identity.agentId, reused: identity.reused });
  });

  /** 会话详情 + 事件摘要。 */
  app.get('/arena/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [session] = await app.db.select().from(arenaSessions).where(eq(arenaSessions.id, id));
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    const events = await app.db
      .select({
        seq: arenaEvents.seq,
        type: arenaEvents.type,
        fromAgent: arenaEvents.fromAgent,
        ts: arenaEvents.ts,
      })
      .from(arenaEvents)
      .where(eq(arenaEvents.sessionId, id))
      .orderBy(asc(arenaEvents.seq));

    // 防对局中泄露人格：仅终局（settled/failed）才随详情带出人格对应的理论根。
    // 进行中（open/negotiating）一律不带，否则对手能读到自己的「底牌」。
    const isTerminal = session.status === 'settled' || session.status === 'failed';
    const personaKey = session.counterpartPersona as CounterpartTheoryKey | null;
    const theory = isTerminal && personaKey ? COUNTERPART_THEORY[personaKey] : undefined;
    const counterpartTheory = theory
      ? {
          key: personaKey,
          label: theory.label,
          anchor: theory.anchor,
          quote: theory.quote,
          source: theory.source,
        }
      : undefined;

    return { ...session, events, ...(counterpartTheory ? { counterpartTheory } : {}) };
  });

  /** 推事件：完整安全校验链后入库。 */
  app.post('/arena/sessions/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { type, fromAgent, seq, nonce, ts, sig, pubkey } = body;
    const payload = body.payload ?? null;

    if (
      typeof type !== 'string' ||
      typeof fromAgent !== 'string' ||
      typeof seq !== 'number' ||
      typeof nonce !== 'string' ||
      typeof ts !== 'number' ||
      typeof sig !== 'string' ||
      typeof pubkey !== 'string'
    ) {
      return reply.code(400).send({ error: 'type/fromAgent/seq/nonce/ts/sig/pubkey 必填' });
    }
    if (!EVENT_TYPES.has(type)) {
      return reply.code(400).send({ error: `type 必须是 ${[...EVENT_TYPES].join('/')}` });
    }

    const [session] = await app.db.select().from(arenaSessions).where(eq(arenaSessions.id, id));
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    if (session.status === 'settled' || session.status === 'failed') {
      return reply.code(409).send({ error: `会话已 ${session.status}，拒收新事件` });
    }
    if (fromAgent !== session.buyerAgentId && fromAgent !== session.sellerAgentId) {
      return reply.code(403).send({ error: 'fromAgent 不是会话参与者' });
    }

    // 密钥即身份：fromAgent 必须已注册且绑定提交的 pubkey
    const [agent] = await app.db.select().from(agents).where(eq(agents.id, fromAgent));
    if (!agent) return reply.code(403).send({ error: 'agent 未注册' });
    if (agent.pubkey !== pubkey) {
      return reply.code(401).send({ error: 'pubkey 与 agent 注册密钥不符' });
    }

    const envelope = { sessionId: id, seq, type, fromAgent, payload, nonce, ts };
    if (!verifyPayload(pubkey, envelope, sig)) {
      return reply.code(401).send({ error: '签名验证失败' });
    }

    // seq 会话内单调：必须等于当前最大 +1
    const [{ maxSeq }] = await app.db
      .select({ maxSeq: sql<number>`coalesce(max(${arenaEvents.seq}), 0)` })
      .from(arenaEvents)
      .where(eq(arenaEvents.sessionId, id));
    if (seq !== maxSeq + 1) {
      return reply.code(409).send({ error: `seq 不连续：期望 ${maxSeq + 1}，收到 ${seq}` });
    }

    try {
      await app.db.insert(arenaEvents).values({
        id: `ae-${randomUUID()}`,
        sessionId: id,
        seq,
        type,
        fromAgent,
        payload: payload as Record<string, unknown> | null,
        sig,
        nonce,
        ts: new Date(ts),
      });
    } catch (e) {
      // 唯一冲突（nonce 重放 / seq 并发）→ 409
      const code = (e as { code?: string }).code;
      if (code === '23505') return reply.code(409).send({ error: 'nonce 重放或 seq 冲突' });
      throw e;
    }

    // 状态机：首事件 → negotiating；REJECT → failed；SETTLE → settled
    const nextStatus =
      type === 'SETTLE'
        ? 'settled'
        : type === 'REJECT'
          ? 'failed'
          : session.status === 'open'
            ? 'negotiating'
            : session.status;
    if (nextStatus !== session.status) {
      await app.db
        .update(arenaSessions)
        .set({ status: nextStatus })
        .where(eq(arenaSessions.id, id));
    }

    notifyWaiters(id);
    if (type === 'SETTLE') {
      await settleSession(app, id, seq);
    }
    return reply.code(201).send({ ok: true, seq, type, sessionStatus: nextStatus });
  });

  /** 长轮询事件流：?after=已见最大seq&wait=秒。 */
  app.get('/arena/sessions/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { after?: string; wait?: string };
    const after = Number(q.after ?? 0) || 0;
    const wait = Math.min(Number(q.wait ?? 0) || 0, 30);

    const [session] = await app.db.select().from(arenaSessions).where(eq(arenaSessions.id, id));
    if (!session) return reply.code(404).send({ error: '会话不存在' });

    const fetchEvents = () =>
      app.db
        .select()
        .from(arenaEvents)
        .where(and(eq(arenaEvents.sessionId, id), gt(arenaEvents.seq, after)))
        .orderBy(asc(arenaEvents.seq));

    let events = await fetchEvents();
    if (events.length === 0 && wait > 0) {
      const waiter = registerWaiter(id);
      await Promise.race([
        waiter.promise,
        new Promise<void>((r) => setTimeout(r, wait * 1000)),
      ]);
      // 审计 A6【P2】：超时分支必须摘除自己的 resolver（set 空则删 Map 键），
      // 否则每次超时轮询都永久泄漏一个闭包（慢内存泄漏）。
      waiter.cancel();
      events = await fetchEvents();
    }
    return { events };
  });

  /** 平台引擎兜底：清扫悬空会话（deadline 已过 / 无 deadline 超 TTL）→ failed + TIMEOUT 事件留痕。 */
  app.post('/arena/sweep', async () => {
    const swept = await sweepStaleSessions(app);
    for (const id of swept) notifyWaiters(id);
    return { swept, count: swept.length };
  });
}
