/**
 * arenaSweep 测试：悬空会话兜底清扫。
 * 规则：deadline 已过 / 无 deadline 超 TTL → failed + 平台 TIMEOUT 事件（seq 接续）。
 * failed 不写证据、不动分数——行为证据只来自真实 SETTLE。
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { arenaEvents, arenaSessions } from '../../db/schema';
import { sweepStaleSessions } from '../../services/arenaSweep';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

async function insertSession(over: Partial<typeof arenaSessions.$inferInsert> = {}) {
  const [row] = await db
    .insert(arenaSessions)
    .values({ id: `as-${randomUUID().slice(0, 8)}`, scenario: '标准交易', status: 'open', ...over })
    .returning();
  return row;
}

async function insertEvent(sessionId: string, seq: number, minutesAgo: number) {
  await db.insert(arenaEvents).values({
    id: `ae-${randomUUID()}`,
    sessionId,
    seq,
    type: 'OFFER',
    fromAgent: 'ag-buyer',
    payload: { price: 100 },
    sig: 'test',
    nonce: `n-${randomUUID()}`,
    ts: new Date(Date.now() - minutesAgo * 60_000),
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
});

afterAll(async () => {
  await app.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE arena_events, arena_sessions CASCADE`);
});

describe('sweepStaleSessions', () => {
  it('无 deadline、最后事件超 TTL → failed + TIMEOUT 事件（seq 接续）', async () => {
    const s = await insertSession({ status: 'negotiating' });
    await insertEvent(s.id, 1, 120);
    const swept = await sweepStaleSessions(app, { ttlMinutes: 30 });
    expect(swept).toEqual([s.id]);
    const [after] = await db.select().from(arenaSessions).where(eq(arenaSessions.id, s.id));
    expect(after?.status).toBe('failed');
    const events = await db
      .select()
      .from(arenaEvents)
      .where(eq(arenaEvents.sessionId, s.id))
      .orderBy(asc(arenaEvents.seq));
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe('TIMEOUT');
    expect(events[1]?.seq).toBe(2);
    expect(events[1]?.fromAgent).toBe('platform-engine');
    expect(events[1]?.sig).toBe('platform');
    expect(events[1]?.nonce).toBe(`platform-timeout-${s.id}`);
  });

  it('无事件的 open 会话按 created_at 判定，TIMEOUT 从 seq=1 起', async () => {
    const s = await insertSession({ createdAt: new Date(Date.now() - 2 * 3600_000) });
    const swept = await sweepStaleSessions(app, { ttlMinutes: 30 });
    expect(swept).toEqual([s.id]);
    const events = await db.select().from(arenaEvents).where(eq(arenaEvents.sessionId, s.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(1);
  });

  it('新鲜会话不动', async () => {
    await insertSession({});
    const swept = await sweepStaleSessions(app, { ttlMinutes: 30 });
    expect(swept).toEqual([]);
  });

  it('有未来 deadline 的旧活动会话不动（deadline 是权威）', async () => {
    const s = await insertSession({
      status: 'negotiating',
      deadline: new Date(Date.now() + 3600_000),
    });
    await insertEvent(s.id, 1, 120);
    const swept = await sweepStaleSessions(app, { ttlMinutes: 30 });
    expect(swept).toEqual([]);
  });

  it('deadline 已过 → 即使活动新鲜也清扫', async () => {
    const s = await insertSession({
      status: 'negotiating',
      deadline: new Date(Date.now() - 60_000),
    });
    await insertEvent(s.id, 1, 0);
    const swept = await sweepStaleSessions(app, { ttlMinutes: 30 });
    expect(swept).toEqual([s.id]);
  });

  it('POST /arena/sweep 路由可用', async () => {
    const s = await insertSession({ status: 'negotiating' });
    await insertEvent(s.id, 1, 120);
    const res = await app.inject({ method: 'POST', url: '/arena/sweep' });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(1);
    expect(res.json().swept).toContain(s.id);
  });
});
