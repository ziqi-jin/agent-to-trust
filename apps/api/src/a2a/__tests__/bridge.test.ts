/**
 * Task 6 集成测试：A2A 双向桥（内核事件 ↔ A2A 世界往返 + 验签注入）。
 *
 * 覆盖：
 *   1. happy path：对家事件 → 桥发 A2A → 结构化 OFFER 回复 → 桥签名注入（201）→ 事件表新增 + 签名有效。
 *   2. 文本档兜底：回复「接受」→ 注入 ACCEPT。
 *   3. 解析失败（乱码）→ 不注入 + invalid_rounds +1。
 *   4. 连续失败达阈值 → 桥退出（不无限循环）。
 *   5. 终局事件（SETTLE/REJECT）→ 桥退出（对家终局 / 用户回 REJECT 注入终局 两路）。
 *   6. 安全底线：伪造无签名/坏签名注入被内核拒绝，事件表无新增（桥走的必须是验签链）。
 *
 * 只用 acl_test 库；用户 agent 用假 fetchImpl 注入（不真发网络）。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { ensureKeypair, signPayload, verifyPayload } from 'sealit-sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { arenaEvents } from '../../db/schema';
import type { AclAgentCard } from '../card';
import { runA2aBridge, type A2aBridgeStats } from '../bridge';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');
if (TEST_URL.includes('://acl:acl@localhost:5432/acl') && !TEST_URL.includes('acl_test')) {
  throw new Error('拒绝在非 acl_test 库上跑 bridge 测试（生产库会被 TRUNCATE）');
}

interface Keypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

let app: FastifyInstance;
let db: Database;
const dirs: string[] = [];

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await truncate();
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncate();
});

async function truncate(): Promise<void> {
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
}

function newKeys(): Keypair {
  const dir = mkdtempSync(join(tmpdir(), 't6-bridge-'));
  dirs.push(dir);
  return ensureKeypair(dir);
}

function makeCard(): AclAgentCard {
  return {
    name: 'A2A User Agent',
    description: 'a negotiation agent',
    url: 'https://user.example/a2a',
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{ id: 'negotiate', tags: ['negotiation'] }],
    'x-acl': { arenaReady: true },
  } as AclAgentCard;
}

async function registerAgent(name: string, pubkey: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/arena/register', payload: { name, pubkey } });
  expect(res.statusCode).toBe(201);
  return res.json().agentId as string;
}

async function createSession(buyerAgentId: string, sellerAgentId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/arena/sessions',
    payload: { scenario: '标准交易', buyerAgentId, sellerAgentId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function readEvents(sessionId: string) {
  return db.select().from(arenaEvents).where(eq(arenaEvents.sessionId, sessionId)).orderBy(asc(arenaEvents.seq));
}

/** 以对家（buyer）身份签名推一条事件；seq 自动取当前 max+1。 */
async function pushSigned(
  sessionId: string,
  agentId: string,
  keys: Keypair,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const events = await readEvents(sessionId);
  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq), 0);
  const envelope = {
    sessionId,
    seq: maxSeq + 1,
    type,
    fromAgent: agentId,
    payload,
    nonce: `t6-${randomUUID()}`,
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

/** 假 fetch：返回固定 parts（模拟用户 agent 的 A2A 回复）。 */
function fetchReturning(parts: unknown[], status = 200): { fn: typeof fetch; calls: () => number } {
  let n = 0;
  const fn = (async () => {
    n += 1;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ jsonrpc: '2.0', id: 'r', result: { parts } }),
    };
  }) as unknown as typeof fetch;
  return { fn, calls: () => n };
}

async function runBridge(
  sessionId: string,
  platformAgentId: string,
  keys: Keypair,
  fetchImpl: typeof fetch,
  extra: Partial<{ maxRounds: number; failStreakLimit: number; pollMs: number; maxWaitMs: number }> = {},
): Promise<A2aBridgeStats> {
  const stats: A2aBridgeStats = {
    rounds: 0,
    invalidRounds: 0,
    failStreak: 0,
    injected: 0,
    exitReason: null,
  };
  await runA2aBridge(app, {
    sessionId,
    platformAgentId,
    keys,
    card: makeCard(),
    fetchImpl,
    pollMs: 5,
    onStats: (s) => Object.assign(stats, s),
    ...extra,
  });
  return stats;
}

/** 造一个 buyer(对家) + seller(A2A 平台侧身份) 会话，返回全部句柄。 */
async function makeFixture() {
  const counterpartKeys = newKeys();
  const platformKeys = newKeys();
  const tag = randomUUID().slice(0, 6);
  const buyerId = await registerAgent(`t6-counterpart-${tag}`, counterpartKeys.publicKeyPem);
  const sellerId = await registerAgent(`t6-a2a-${tag}`, platformKeys.publicKeyPem);
  const sessionId = await createSession(buyerId, sellerId);
  return { counterpartKeys, platformKeys, buyerId, sellerId, sessionId };
}

describe('Task 6 — A2A 双向桥', () => {
  it('1. happy path：结构化 OFFER 回复 → 签名注入被内核接受（201）+ 事件入库且签名有效', async () => {
    const { counterpartKeys, platformKeys, buyerId, sellerId, sessionId } = await makeFixture();
    await pushSigned(sessionId, buyerId, counterpartKeys, 'OFFER', { price: 80 });

    const { fn, calls } = fetchReturning([
      { kind: 'data', data: { aclAction: { type: 'OFFER', price: 75 } } },
    ]);
    const stats = await runBridge(sessionId, sellerId, platformKeys, fn, { maxRounds: 1 });

    expect(calls()).toBe(1);
    expect(stats.injected).toBe(1);

    const events = await readEvents(sessionId);
    expect(events.length).toBe(2);
    const injected = events[1];
    expect(injected.seq).toBe(2);
    expect(injected.type).toBe('OFFER');
    expect(injected.fromAgent).toBe(sellerId);
    expect(injected.payload).toEqual({ price: 75 });

    // 签名有效：用对家公钥验平台侧注入的信封
    const envelope = {
      sessionId,
      seq: 2,
      type: 'OFFER',
      fromAgent: sellerId,
      payload: { price: 75 },
      nonce: injected.nonce,
      ts: injected.ts.getTime(),
    };
    expect(verifyPayload(platformKeys.publicKeyPem, envelope, injected.sig)).toBe(true);
  });

  it('2. 文本档兜底：回复「接受」→ 注入 ACCEPT', async () => {
    const { counterpartKeys, platformKeys, buyerId, sellerId, sessionId } = await makeFixture();
    await pushSigned(sessionId, buyerId, counterpartKeys, 'OFFER', { price: 80 });

    const stats = await runBridge(sessionId, sellerId, platformKeys, fetchReturning([{ kind: 'text', text: '接受' }]).fn, {
      maxRounds: 1,
    });

    expect(stats.injected).toBe(1);
    const events = await readEvents(sessionId);
    expect(events.length).toBe(2);
    expect(events[1].type).toBe('ACCEPT');
    expect(events[1].fromAgent).toBe(sellerId);
  });

  it('3. 解析失败（乱码）→ 不注入 + invalid_rounds +1', async () => {
    const { counterpartKeys, platformKeys, buyerId, sellerId, sessionId } = await makeFixture();
    await pushSigned(sessionId, buyerId, counterpartKeys, 'OFFER', { price: 80 });

    const stats = await runBridge(
      sessionId,
      sellerId,
      platformKeys,
      fetchReturning([{ kind: 'text', text: '嗯嗯，再看看 zzz' }]).fn,
      { maxRounds: 1 },
    );

    expect(stats.invalidRounds).toBe(1);
    expect(stats.injected).toBe(0);
    const events = await readEvents(sessionId);
    expect(events.length).toBe(1); // 仅有对家 OFFER，桥未注入
  });

  it('4. 连续失败达阈值 → 桥退出（不无限循环）', async () => {
    const { counterpartKeys, platformKeys, buyerId, sellerId, sessionId } = await makeFixture();
    // 两条对家事件，保证有两次 A2A 往返机会
    await pushSigned(sessionId, buyerId, counterpartKeys, 'OFFER', { price: 80 });
    await pushSigned(sessionId, buyerId, counterpartKeys, 'NEGOTIATE', { price: 70 });

    const started = Date.now();
    const stats = await runBridge(sessionId, sellerId, platformKeys, fetchReturning([], 500).fn, {
      failStreakLimit: 2,
      maxRounds: 100,
      maxWaitMs: 60_000,
    });

    expect(Date.now() - started).toBeLessThan(5_000); // 早于全局超时，靠阈值退出
    expect(stats.exitReason).toBe('fail-streak');
    expect(stats.failStreak).toBeGreaterThanOrEqual(2);
    expect(stats.injected).toBe(0);
  });

  it('5a. 对家终局（REJECT）→ 桥退出且不打扰用户 agent', async () => {
    const { counterpartKeys, platformKeys, buyerId, sellerId, sessionId } = await makeFixture();
    await pushSigned(sessionId, buyerId, counterpartKeys, 'REJECT', { reason: '对家终止' });

    const { fn, calls } = fetchReturning([{ kind: 'text', text: '接受' }]);
    const stats = await runBridge(sessionId, sellerId, platformKeys, fn, { maxRounds: 5 });

    expect(stats.exitReason).toBe('reject');
    expect(calls()).toBe(0); // 终局事件不翻 A2A
    expect((await readEvents(sessionId)).length).toBe(1);
  });

  it('5b. 用户回 REJECT → 桥注入终局事件后退出 + 会话变 failed', async () => {
    const { counterpartKeys, platformKeys, buyerId, sellerId, sessionId } = await makeFixture();
    await pushSigned(sessionId, buyerId, counterpartKeys, 'OFFER', { price: 80 });

    const stats = await runBridge(
      sessionId,
      sellerId,
      platformKeys,
      fetchReturning([{ kind: 'data', data: { aclAction: { type: 'REJECT', reason: '太贵' } } }]).fn,
      { maxRounds: 5 },
    );

    expect(stats.exitReason).toBe('reject');
    const events = await readEvents(sessionId);
    expect(events.length).toBe(2);
    expect(events[1].type).toBe('REJECT');
    const detail = await app.inject({ method: 'GET', url: `/arena/sessions/${sessionId}` });
    expect((detail.json() as { status: string }).status).toBe('failed');
  });

  it('6. 安全底线：伪造无签名/坏签名注入被内核拒绝，事件表无新增', async () => {
    const { counterpartKeys, platformKeys, buyerId, sellerId, sessionId } = await makeFixture();
    await pushSigned(sessionId, buyerId, counterpartKeys, 'OFFER', { price: 80 });
    const before = await readEvents(sessionId);
    const seq = before.reduce((m, e) => Math.max(m, e.seq), 0) + 1;

    const base = {
      sessionId,
      seq,
      type: 'ACCEPT',
      fromAgent: sellerId,
      payload: {},
      nonce: `forge-${randomUUID()}`,
      ts: Date.now(),
    };

    // (a) 缺 sig → 400
    const noSig = await app.inject({
      method: 'POST',
      url: `/arena/sessions/${sessionId}/events`,
      payload: { ...base, pubkey: platformKeys.publicKeyPem },
    });
    expect(noSig.statusCode).toBeGreaterThanOrEqual(400);
    expect(noSig.statusCode).toBeLessThan(500);

    // (b) 坏签名 → 401
    const badSig = await app.inject({
      method: 'POST',
      url: `/arena/sessions/${sessionId}/events`,
      payload: { ...base, sig: 'deadbeef', pubkey: platformKeys.publicKeyPem },
    });
    expect(badSig.statusCode).toBeGreaterThanOrEqual(400);
    expect(badSig.statusCode).toBeLessThan(500);

    // (c) 用别人私钥签（声明 seller 公钥）→ 401
    const wrongKeySig = signPayload(counterpartKeys.privateKeyPem, base);
    const wrongKey = await app.inject({
      method: 'POST',
      url: `/arena/sessions/${sessionId}/events`,
      payload: { ...base, sig: wrongKeySig, pubkey: platformKeys.publicKeyPem },
    });
    expect(wrongKey.statusCode).toBeGreaterThanOrEqual(400);
    expect(wrongKey.statusCode).toBeLessThan(500);

    // 三次伪造都没落库
    const after = await readEvents(sessionId);
    expect(after.length).toBe(before.length);
  });
});
