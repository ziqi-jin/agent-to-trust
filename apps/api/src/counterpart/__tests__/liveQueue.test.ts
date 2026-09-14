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
import { and, asc, eq } from 'drizzle-orm';
import { ensureKeypair, signPayload } from 'sealit-sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { arenaEvents, arenaSessions, creditScores, evidence } from '../../db/schema';
import { resetQueueForTests, stopAllQueueEngines } from '../../routes/arenaQueue';
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

    // GET /arena/sessions/:id 也暴露新字段（Produces 契约）
    const detail = await app.inject({ method: 'GET', url: `/arena/sessions/${sessionId}` });
    const detailBody = detail.json() as { counterpartMode?: string; counterpartPersona?: string };
    expect(detailBody.counterpartMode).toBe('scripted');
    expect(detailBody.counterpartPersona).toBe('scripted');

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
  }, 40000);
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
      const hit = rows.find((r) => r.evidenceUri === `acl://arena/${sessionId}`);
      expect(hit, `session ${sessionId} 未写行为证据`).toBeDefined();
      expect(hit!.sourceType).toBe(expected);
    }
  }, 20000);
});
