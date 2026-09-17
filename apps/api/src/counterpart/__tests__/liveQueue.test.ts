/**
 * Task 7 集成测试：对家模式落库 + arenaQueue 集成（模式/人格）+ 结算双口径。
 *
 * 断言：
 *   1. mode 缺省 → 会话 counterpart_mode='scripted'、counterpart_persona='scripted'，
 *      且脚本引擎事件流与旧 runPlatformBuyer 字节级一致（OFFER 80 → …）。
 *   2. POST /arena/queue 带非法 mode → 400。
 *   3. mode:'live' 但缺 DEEPSEEK_API_KEY（显式 delete）→ 会话仍建，降级 counterpart_mode='scripted'，
 *      返回体含 degraded:true（引擎侧降级不阻塞撮合）。
 *   4. arenaSettle 双口径：live → source_type='arena-behavior-live'；scripted → 'arena-behavior'。
 *
 * 复用 arenaQueue.test.ts 的清库 + makeQualifiedAgent 模式；QUEUE_SOLO_WAIT_MS=20 触发 solo。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { ensureKeypair, signPayload } from 'agent-to-trust';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { arenaEvents, arenaSessions, creditScores, evidence, testQueue } from '../../db/schema';
import { promoteWaiting, resetQueueForTests, stopAllQueueEngines } from '../../routes/arenaQueue';
import { settleSession } from '../../services/arenaSettle';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');
if (TEST_URL.includes('://acl:acl@localhost:5432/acl') && !TEST_URL.includes('acl_test')) {
  throw new Error('拒绝在非 acl_test 库上跑 liveQueue 测试（生产库会被 TRUNCATE）');
}

let app: FastifyInstance;
let db: Database;
let platformDir: string;
const dirs: string[] = [];
const savedKey = process.env.DEEPSEEK_API_KEY;

beforeAll(async () => {
  // Ruling 3 断言要求：live 模式在「缺 key」时降级。显式删除，杜绝环境里的真 key 触发真实 LLM 调用。
  delete process.env.DEEPSEEK_API_KEY;
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  platformDir = mkdtempSync(join(tmpdir(), 't7-platform-'));
  dirs.push(platformDir);
  process.env.PLATFORM_KEY_DIR = platformDir;
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
});

afterAll(() => {
  stopAllQueueEngines();
  delete process.env.PLATFORM_KEY_DIR;
  delete process.env.QUEUE_SOLO_WAIT_MS;
  if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = savedKey;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(() => {
  resetQueueForTests();
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function registerAgent(name: string, pubkey: string): Promise<string> {
  const reg = await app.inject({ method: 'POST', url: '/arena/register', payload: { name, pubkey } });
  expect(reg.statusCode).toBe(201);
  return reg.json().agentId as string;
}

/** 合格身份：外部钥注册 + real-benchmark 证据 + 高中场分（门槛只查这两项）。 */
async function makeQualifiedAgent(name: string, pubkey: string, score = 800): Promise<string> {
  const agentId = await registerAgent(name, pubkey);
  await db.insert(evidence).values({
    id: `ev-${randomUUID().slice(0, 8)}`,
    agentId,
    dimension: 'capability',
    source: 'real-benchmark',
    sourceType: 'benchmark',
    result: 'success',
    value: 0.9,
  });
  await db.insert(creditScores).values({
    id: `cs-${randomUUID().slice(0, 8)}`,
    agentId,
    score,
    modelVersion: 'test',
  });
  return agentId;
}

async function enqueue(name: string, pubkey: string, extra: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/arena/queue', payload: { name, pubkey, ...extra } });
}

async function waitForSession(ticket: string, timeoutMs = 8000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await app.inject({ method: 'GET', url: `/arena/queue/${ticket}` });
    const body = st.json() as { status: string; sessionId?: string };
    if (body.status === 'matched' && body.sessionId) return body.sessionId;
    await sleep(50);
  }
  throw new Error('等待撮合超时');
}

async function readEvents(sessionId: string) {
  return db
    .select()
    .from(arenaEvents)
    .where(eq(arenaEvents.sessionId, sessionId))
    .orderBy(asc(arenaEvents.seq));
}

async function waitForEventType(sessionId: string, type: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = await readEvents(sessionId);
    if (events.some((e) => e.type === type)) return events;
    await sleep(150);
  }
  throw new Error(`等待事件 ${type} 超时`);
}

/** 等某类事件计数达到 n（脚本引擎 2s 轮询，慢于普通 waitForEventType 单次出现）。 */
async function waitForEventCount(sessionId: string, type: string, n: number, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = await readEvents(sessionId);
    if (events.filter((e) => e.type === type).length >= n) return events;
    await sleep(150);
  }
  throw new Error(`等待事件 ${type} 达到 ${n} 次超时`);
}

/** 以 seller（真实用户 agent）身份签名推一条事件；seq 自动取当前 max+1。 */
async function pushAsSeller(
  sessionId: string,
  sellerAgentId: string,
  keys: { publicKeyPem: string; privateKeyPem: string },
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const events = await readEvents(sessionId);
  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq), 0);
  const envelope = {
    sessionId,
    seq: maxSeq + 1,
    type,
    fromAgent: sellerAgentId,
    payload,
    nonce: `t7-${randomUUID()}`,
    ts: Date.now(),
  };
  const sig = signPayload(keys.privateKeyPem, envelope);
  const res = await app.inject({
    method: 'POST',
    url: `/arena/sessions/${sessionId}/events`,
    payload: { ...envelope, sig, pubkey: keys.publicKeyPem },
  });
  expect(res.statusCode, `推 ${type} 失败：${res.body}`).toBe(201);
}

async function sessionRow(sessionId: string) {
  const [row] = await db.select().from(arenaSessions).where(eq(arenaSessions.id, sessionId));
  return row;
}

describe('Task 7 — mode 缺省（scripted）路径', () => {
  it('缺省 mode → scripted 会话 + 人格 scripted + 旧脚本引擎事件流字节级不变', async () => {
    process.env.QUEUE_SOLO_WAIT_MS = '20';
    const dir = mkdtempSync(join(tmpdir(), 't7-agent-'));
    dirs.push(dir);
    const keys = ensureKeypair(dir);
    const name = `t7-scripted-${randomUUID().slice(0, 6)}`;
    const sellerAgentId = await makeQualifiedAgent(name, keys.publicKeyPem);

    const res = await enqueue(name, keys.publicKeyPem);
    expect(res.statusCode).toBe(201);
    const ticket = res.json().ticket as string;
    const sessionId = await waitForSession(ticket);

    const session = await sessionRow(sessionId);
    expect(session.counterpartMode).toBe('scripted');
    expect(session.counterpartPersona).toBe('scripted');
    expect(session.counterpartTokens).toBe(0);

    // GET /arena/sessions/:id 暴露 mode，但**对局中剥离 persona/seed**（防底牌泄露，T10 复核）
    const detail = await app.inject({ method: 'GET', url: `/arena/sessions/${sessionId}` });
    const detailBody = detail.json() as {
      status?: string;
      counterpartMode?: string;
      counterpartPersona?: string;
      counterpartSeed?: string;
    };
    expect(detailBody.status).not.toBe('settled');
    expect(detailBody.counterpartMode).toBe('scripted');
    expect(detailBody.counterpartPersona).toBeUndefined();
    expect(detailBody.counterpartSeed).toBeUndefined();

    // 引擎开价：OFFER 80（旧 runPlatformBuyer 首事件）
    await waitForEventType(sessionId, 'OFFER');
    let events = await readEvents(sessionId);
    expect(events[0].seq).toBe(1);
    expect(events[0].type).toBe('OFFER');
    expect(events[0].fromAgent).toContain('arena-buyer-platform');
    expect((events[0].payload as { price?: number }).price).toBe(80);
    expect((events[0].payload as { note?: string }).note).toBe('平台一口价，接受即交付');

    // 用户 ACCEPT → 引擎催交付 NEGOTIATE
    await pushAsSeller(sessionId, sellerAgentId, keys, 'ACCEPT', {});
    await waitForEventType(sessionId, 'NEGOTIATE');
    events = await readEvents(sessionId);
    const neg = events.find((e) => e.type === 'NEGOTIATE')!;
    expect((neg.payload as { note?: string }).note).toBe('已接受报价，请交付');

    // 用户 DELIVER → 引擎 VERIFY_RESULT(pass,onTime) + SETTLE
    await pushAsSeller(sessionId, sellerAgentId, keys, 'DELIVER', { note: '交付完成' });
    await waitForEventType(sessionId, 'SETTLE');

    events = await readEvents(sessionId);
    // 旧路径事件序列：OFFER → ACCEPT → NEGOTIATE → DELIVER → VERIFY_RESULT → SETTLE
    expect(events.map((e) => e.type)).toEqual([
      'OFFER',
      'ACCEPT',
      'NEGOTIATE',
      'DELIVER',
      'VERIFY_RESULT',
      'SETTLE',
    ]);
    const verify = events.find((e) => e.type === 'VERIFY_RESULT')!;
    expect(verify.payload).toMatchObject({ verdict: 'pass', onTime: true, note: '平台验收通过' });
    const settle = events.find((e) => e.type === 'SETTLE')!;
    expect((settle.payload as { note?: string }).note).toBe('平台对家确认结算');
    expect((await sessionRow(sessionId)).status).toBe('settled');

    // 终局后详情重新带出 persona（防对局中泄露、终局披露，门槛开合双向）
    const settledDetail = await app.inject({ method: 'GET', url: `/arena/sessions/${sessionId}` });
    const settledBody = settledDetail.json() as { counterpartPersona?: string; counterpartSeed?: string };
    expect(settledBody.counterpartPersona).toBe('scripted');
    expect(typeof settledBody.counterpartSeed).toBe('string');
  }, 40000);
});

describe('Task 7 — 脚本磋商轮次路径（Ruling 1 保真）', () => {
  it('NEGOTIATE 重发一口价并按 r/max 计数；超限 REJECT 后引擎收尾退出、无重复事件', async () => {
    process.env.QUEUE_SOLO_WAIT_MS = '20';
    const dir = mkdtempSync(join(tmpdir(), 't7-agent-'));
    dirs.push(dir);
    const keys = ensureKeypair(dir);
    const name = `t7-rounds-${randomUUID().slice(0, 6)}`;
    const sellerAgentId = await makeQualifiedAgent(name, keys.publicKeyPem);

    const res = await enqueue(name, keys.publicKeyPem);
    expect(res.statusCode).toBe(201);
    const sessionId = await waitForSession(res.json().ticket as string);
    await waitForEventType(sessionId, 'OFFER');

    // 第 1 轮谈价：OFFER(80) → 用户 NEGOTIATE(60) → 引擎 OFFER（价格不变 1/3，价仍 80）
    await pushAsSeller(sessionId, sellerAgentId, keys, 'NEGOTIATE', { price: 60 });
    let events = await waitForEventCount(sessionId, 'OFFER', 2);
    expect(events.map((e) => e.type).slice(0, 3)).toEqual(['OFFER', 'NEGOTIATE', 'OFFER']);
    const offer2 = events.find((e, i) => e.type === 'OFFER' && i > 0)!;
    expect((offer2.payload as { price?: number }).price).toBe(80);
    expect((offer2.payload as { note?: string }).note).toBe('价格不变（磋商 1/3）');

    // 第 2、3 轮：仍重发一口价
    await pushAsSeller(sessionId, sellerAgentId, keys, 'NEGOTIATE', { price: 50 });
    await waitForEventCount(sessionId, 'OFFER', 3);
    events = await readEvents(sessionId);
    expect((events.filter((e) => e.type === 'OFFER')[2].payload as { note?: string }).note).toBe(
      '价格不变（磋商 2/3）',
    );
    await pushAsSeller(sessionId, sellerAgentId, keys, 'NEGOTIATE', { price: 40 });
    await waitForEventCount(sessionId, 'OFFER', 4);

    // 第 4 轮超限 → REJECT（磋商超限）；会话 failed；引擎收尾退出，不再推重复 REJECT / onTimeout
    await pushAsSeller(sessionId, sellerAgentId, keys, 'NEGOTIATE', { price: 30 });
    await waitForEventType(sessionId, 'REJECT');
    // 会话变 failed 后，引擎应已 return（再等一轮轮询周期确认无新事件）
    await sleep(2500);
    events = await readEvents(sessionId);
    const rejects = events.filter((e) => e.type === 'REJECT');
    expect(rejects).toHaveLength(1);
    expect((rejects[0].payload as { reason?: string }).reason).toBe('平台一口价，磋商超限，终止');
    expect(events.filter((e) => e.type === 'SETTLE')).toHaveLength(0);
    expect((await sessionRow(sessionId)).status).toBe('failed');
  }, 60000);
});

describe('Task 7 — 持久排队路径保留 mode（评审 Important 回归）', () => {
  it('满载入队：mode 落库不丢，放行按 live 建会话（修复前放行只能默认脚本）', async () => {
    process.env.QUEUE_MAX_ACTIVE = '1';
    process.env.DEEPSEEK_API_KEY = 't7-fake-key';
    try {
      // 造一个 active 会话占满并发位 → 后续 enqueue 走持久排队（enqueueWaitingRow）
      await db.insert(arenaSessions).values({
        id: `as-t7-busy-${randomUUID().slice(0, 6)}`,
        scenario: '占位',
        status: 'open',
        buyerAgentId: 'busy-b',
        sellerAgentId: 'busy-s',
      });
      const dir = mkdtempSync(join(tmpdir(), 't7-agent-'));
      dirs.push(dir);
      const keys = ensureKeypair(dir);
      const name = `t7-persist-${randomUUID().slice(0, 6)}`;
      await makeQualifiedAgent(name, keys.publicKeyPem);

      const res = await enqueue(name, keys.publicKeyPem, { mode: 'live' });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe('waiting');
      expect(res.json().degraded).toBe(false); // 有 key → 不降级
      const ticket = res.json().ticket as string;

      const [q] = await db.select().from(testQueue).where(eq(testQueue.ticket, ticket));
      expect(q.mode).toBe('live'); // ← 修复前此处为默认 'scripted'（mode 在入队时丢失）

      // 腾出并发位后放行：会话必须按 live + llm-* 人格建立
      process.env.QUEUE_MAX_ACTIVE = '2';
      await promoteWaiting(app);
      const [session] = await db
        .select()
        .from(arenaSessions)
        .where(ne(arenaSessions.sellerAgentId, 'busy-s'))
        .orderBy(desc(arenaSessions.createdAt))
        .limit(1);
      expect(session.counterpartMode).toBe('live');
      expect(session.counterpartPersona).toMatch(/^llm-/);
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.QUEUE_MAX_ACTIVE;
      stopAllQueueEngines();
    }
  }, 30000);
});

describe('Task 7 — mode 校验', () => {
  it("POST /arena/queue 带非法 mode → 400（仅支持 'scripted'|'live'）", async () => {
    const dir = mkdtempSync(join(tmpdir(), 't7-agent-'));
    dirs.push(dir);
    const keys = ensureKeypair(dir);
    const name = `t7-badmode-${randomUUID().slice(0, 6)}`;
    await makeQualifiedAgent(name, keys.publicKeyPem);

    const res = await enqueue(name, keys.publicKeyPem, { mode: 'bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('mode');
  });
});

describe('Task 7 — live 降级（Ruling 3）', () => {
  it("mode:'live' 但缺 DEEPSEEK_API_KEY → 会话仍建、降级 scripted、返回 degraded:true", async () => {
    process.env.QUEUE_SOLO_WAIT_MS = '20';
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 't7-agent-'));
    dirs.push(dir);
    const keys = ensureKeypair(dir);
    const name = `t7-degraded-${randomUUID().slice(0, 6)}`;
    await makeQualifiedAgent(name, keys.publicKeyPem);

    const res = await enqueue(name, keys.publicKeyPem, { mode: 'live' });
    expect(res.statusCode).toBe(201);
    expect(res.json().degraded).toBe(true);
    expect(res.json().status).toBe('waiting');
    const ticket = res.json().ticket as string;

    // 降级不阻塞撮合：solo 超时后照常配平台买家
    const sessionId = await waitForSession(ticket);
    const session = await sessionRow(sessionId);
    expect(session.counterpartMode).toBe('scripted');
    expect(session.counterpartPersona).toBe('scripted');
    await waitForEventType(sessionId, 'OFFER');
  }, 40000);
});

describe('Task 7 — arenaSettle 双口径', () => {
  it("live 会话写 source_type='arena-behavior-live'；scripted 写 'arena-behavior'", async () => {
    const buyerDir = mkdtempSync(join(tmpdir(), 't7-buyer-'));
    const sellerDir = mkdtempSync(join(tmpdir(), 't7-seller-'));
    dirs.push(buyerDir, sellerDir);
    const buyerAgentId = await registerAgent(
      `t7-settle-b-${randomUUID().slice(0, 6)}`,
      ensureKeypair(buyerDir).publicKeyPem,
    );
    const sellerAgentId = await registerAgent(
      `t7-settle-s-${randomUUID().slice(0, 6)}`,
      ensureKeypair(sellerDir).publicKeyPem,
    );

    for (const mode of ['live', 'scripted'] as const) {
      const sessionId = `as-t7-${mode}-${randomUUID().slice(0, 6)}`;
      await db.insert(arenaSessions).values({
        id: sessionId,
        scenario: '标准交易',
        status: 'negotiating',
        buyerAgentId,
        sellerAgentId,
        counterpartMode: mode,
      });
      await db.insert(arenaEvents).values({
        id: `ae-${randomUUID()}`,
        sessionId,
        seq: 1,
        type: 'VERIFY_RESULT',
        fromAgent: buyerAgentId,
        payload: { verdict: 'pass', onTime: true },
        sig: 'test',
        nonce: `t7-nonce-${randomUUID()}`,
        ts: new Date(),
      });
      await settleSession(app, sessionId, 1);

      const rows = await db
        .select()
        .from(evidence)
        .where(and(eq(evidence.agentId, sellerAgentId), eq(evidence.source, 'arena')));
      const expected = mode === 'live' ? 'arena-behavior-live' : 'arena-behavior';
      const hit = rows.find((r) => r.evidenceUri === `a2t://arena/${sessionId}`);
      expect(hit, `session ${sessionId} 未写行为证据`).toBeDefined();
      expect(hit!.sourceType).toBe(expected);
    }
  }, 20000);
});

describe('Task 12 — live 引擎故障收敛（终局评审修复）', () => {
  it('单次模型抛错 → 容忍不终止；连续 3 次 → REJECT 收尾、会话 failed', async () => {
    const origFetch = (globalThis as { fetch?: unknown }).fetch;
    process.env.DEEPSEEK_API_KEY = 'test-bogus-key';
    process.env.QUEUE_SOLO_WAIT_MS = '20';
    // 模型调用直接抛错，模拟 LLM/网络故障（密闭，不走真网）
    (globalThis as { fetch?: unknown }).fetch = async () => {
      throw new Error('boom');
    };
    try {
      const dir = mkdtempSync(join(tmpdir(), 't12-fault-'));
      dirs.push(dir);
      const keys = ensureKeypair(dir);
      const name = `t12-fault-${randomUUID().slice(0, 6)}`;
      await makeQualifiedAgent(name, keys.publicKeyPem);

      const res = await enqueue(name, keys.publicKeyPem, { mode: 'live' });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { degraded?: boolean }).degraded).toBe(false);
      const sessionId = await waitForSession(res.json().ticket as string);

      const session = await sessionRow(sessionId);
      expect(session.counterpartMode).toBe('live');
      expect(String(session.counterpartPersona)).toMatch(/^llm-/);

      // 开价不调模型；推一条 NEGOTIATE 触发模型调用 → 第 1 次抛错 → 引擎容忍（不 REJECT、不 failed）
      await waitForEventType(sessionId, 'OFFER');
      await pushAsSeller(sessionId, session.sellerAgentId!, keys, 'NEGOTIATE', { price: 60 });
      // 引擎每轮推一条中性 NEGOTIATE 兜底 → NEGOTIATE 计数达 2 表示第 1 次故障已被容忍处理
      await waitForEventCount(sessionId, 'NEGOTIATE', 2);
      let events = await readEvents(sessionId);
      expect(events.filter((e) => e.type === 'REJECT')).toHaveLength(0);
      expect((await sessionRow(sessionId)).status).not.toBe('failed');

      // 逐条推（每次等引擎处理完），连续第 2 次故障 → 仍容忍
      await pushAsSeller(sessionId, session.sellerAgentId!, keys, 'NEGOTIATE', { price: 55 });
      await waitForEventCount(sessionId, 'NEGOTIATE', 4);
      expect((await sessionRow(sessionId)).status).not.toBe('failed');

      // 连续第 3 次故障 → 达到阈值 → REJECT 收尾、会话 failed
      await pushAsSeller(sessionId, session.sellerAgentId!, keys, 'NEGOTIATE', { price: 50 });

      events = await waitForEventType(sessionId, 'REJECT', 15000);
      const reject = events.find((e) => e.type === 'REJECT')!;
      expect((reject.payload as { reason?: string }).reason).toBe('对家连续决策异常，终止');
      expect((await sessionRow(sessionId)).status).toBe('failed');
      expect(events.some((e) => e.type === 'SETTLE')).toBe(false);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = origFetch;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.QUEUE_SOLO_WAIT_MS;
    }
  }, 60000);
});
