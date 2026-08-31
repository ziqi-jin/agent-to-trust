/**
 * 排队队列持久化 + 并发上限测试：
 * - 满载：活跃会话数 ≥ QUEUE_MAX_ACTIVE → join 落库 waiting + 返回排队位置
 * - 位置：同 lane FIFO，position/waitingAhead 正确
 * - 重启恢复：内存队列清空后 GET ticket 仍返回 waiting（读库）
 * - 空位释放：promoteWaiting → 等待者被撮合（solo → 平台买家）
 * - exam lane：只排队不撮合（预留口子）
 * - 幂等：同 agent 重复 join 复用同一票
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { ensureKeypair } from '@acl/sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, arenaSessions, creditScores, evidence, testQueue } from '../../db/schema';
import { promoteWaiting, resetQueueForTests, stopAllQueueEngines } from '../arenaQueue';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;
let platformDir: string;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  platformDir = mkdtempSync(join(tmpdir(), 'aclqp-platform-'));
  process.env.PLATFORM_KEY_DIR = platformDir;
  process.env.QUEUE_MAX_ACTIVE = '1';
  process.env.QUEUE_TICK_MS = '60000'; // 测试内不跑定时 tick，直接调 promoteWaiting
});

afterAll(async () => {
  stopAllQueueEngines();
  delete process.env.PLATFORM_KEY_DIR;
  delete process.env.QUEUE_MAX_ACTIVE;
  delete process.env.QUEUE_TICK_MS;
  rmSync(platformDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetQueueForTests();
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
});

/** 造一个合格身份：real-benchmark 证据 + score≥800。 */
async function makeQualifiedAgent(name: string): Promise<void> {
  const id = `ag-${randomUUID().slice(0, 8)}`;
  await db.insert(agents).values({ id, name });
  await db.insert(evidence).values({
    id: `ev-${randomUUID().slice(0, 8)}`,
    agentId: id,
    dimension: 'capability',
    source: 'real-benchmark',
    sourceType: 'benchmark',
    result: 'success',
    value: 0.9,
  });
  await db.insert(creditScores).values({
    id: `cs-${randomUUID().slice(0, 8)}`,
    agentId: id,
    score: 800,
    modelVersion: 'test',
  });
}

/** 注册 + 拿 PEM（join 需要 name/pubkey）。 */
async function register(name: string): Promise<{ name: string; pubkey: string }> {
  const keys = ensureKeypair(join(platformDir, `keys-${name}`));
  const reg = await app.inject({
    method: 'POST',
    url: '/arena/register',
    payload: { name, pubkey: keys.publicKeyPem },
  });
  expect(reg.statusCode).toBe(201);
  return { name, pubkey: keys.publicKeyPem };
}

/** 造 1 个活跃会话占满 cap=1。 */
async function fillCap(): Promise<void> {
  await db.insert(arenaSessions).values({
    id: `as-fill-${randomUUID().slice(0, 8)}`,
    scenario: '占位会话',
    status: 'open',
  });
}

async function joinQueue(identity: { name: string; pubkey: string }, lane?: string) {
  return app.inject({
    method: 'POST',
    url: '/arena/queue',
    payload: lane ? { ...identity, lane } : { ...identity },
  });
}

describe('排队队列持久化 + 并发上限', () => {
  it('满载：join 落库 waiting 并返回排队位置', async () => {
    await makeQualifiedAgent('qp-agent-1');
    await fillCap();
    const id = await register('qp-agent-1');

    const res = await joinQueue(id);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('waiting');
    expect(body.position).toBe(1);
    expect(body.waitingAhead).toBe(0);

    const rows = await db.select().from(testQueue).where(eq(testQueue.lane, 'arena'));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('waiting');
  });

  it('位置 FIFO：第二个等待者 position=2 / waitingAhead=1', async () => {
    await makeQualifiedAgent('qp-agent-2');
    await makeQualifiedAgent('qp-agent-3');
    await fillCap();
    const a = await joinQueue(await register('qp-agent-2'));
    const b = await joinQueue(await register('qp-agent-3'));
    expect(a.json().position).toBe(1);
    expect(b.json().position).toBe(2);
    expect(b.json().waitingAhead).toBe(1);
  });

  it('重启恢复：内存清空后 GET ticket 仍返回 waiting（读库）', async () => {
    await makeQualifiedAgent('qp-agent-4');
    await fillCap();
    const id = await register('qp-agent-4');
    const joined = await joinQueue(id);
    const ticket = joined.json().ticket as string;

    resetQueueForTests(); // 模拟服务重启（内存清空）
    const res = await app.inject({ method: 'GET', url: `/arena/queue/${ticket}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('waiting');
    expect(res.json().position).toBe(1);
  });

  it('空位释放：promoteWaiting → solo 等待者配平台买家', async () => {
    await makeQualifiedAgent('qp-agent-5');
    const filler = `as-fill-${randomUUID().slice(0, 8)}`;
    await db.insert(arenaSessions).values({ id: filler, scenario: '占位', status: 'open' });
    const id = await register('qp-agent-5');
    const joined = await joinQueue(id);
    const ticket = joined.json().ticket as string;

    // 释放空位：占位会话结算
    await db.update(arenaSessions).set({ status: 'settled' }).where(eq(arenaSessions.id, filler));
    await promoteWaiting(app);

    const rows = await db.select().from(testQueue).where(eq(testQueue.ticket, ticket));
    expect(rows[0].status).toBe('admitted');
    expect(rows[0].sessionId).toBeTruthy();

    const res = await app.inject({ method: 'GET', url: `/arena/queue/${ticket}` });
    expect(res.json().status).toBe('matched');
    expect(res.json().sessionId).toBe(rows[0].sessionId);

    // 平台买家会话存在且引擎在跑（active 又占满 cap）
    const sessions = await db
      .select()
      .from(arenaSessions)
      .where(inArray(arenaSessions.status, ['open', 'negotiating']));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(rows[0].sessionId);
  });

  it('exam lane：只排队不撮合（预留口子）', async () => {
    await makeQualifiedAgent('qp-agent-6');
    const id = await register('qp-agent-6'); // cap 未满也只排队
    const res = await joinQueue(id, 'exam');
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('waiting');
    expect(res.json().lane).toBe('exam');

    await promoteWaiting(app); // exam 不参与撮合
    const rows = await db.select().from(testQueue).where(eq(testQueue.lane, 'exam'));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('waiting');
    expect(rows[0].sessionId).toBeNull();
  });

  it('幂等：同 agent 重复 join 复用同一票', async () => {
    await makeQualifiedAgent('qp-agent-7');
    await fillCap();
    const id = await register('qp-agent-7');
    const r1 = await joinQueue(id);
    const r2 = await joinQueue(id);
    expect(r2.json().ticket).toBe(r1.json().ticket);
    const rows = await db.select().from(testQueue).where(eq(testQueue.lane, 'arena'));
    expect(rows).toHaveLength(1);
  });

  it('非法 lane → 400', async () => {
    await makeQualifiedAgent('qp-agent-8');
    const id = await register('qp-agent-8');
    const res = await joinQueue(id, 'boss-mode');
    expect(res.statusCode).toBe(400);
  });
});
