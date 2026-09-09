/**
 * 审计 A6【P2】arena 长轮询 waiters 超时不清理（慢内存泄漏）。
 *
 * 证据：arena.ts registerWaiter 把 resolver 加进 waiters[sessionId]；
 * 超时分支 Promise.race 只是 resolve 了 timeout，registerWaiter 的 resolver
 * 仍留在 set 里——每来一次超时轮询就永久泄漏一个闭包（含 sessionId 引用），
 * 空 Set 也永不删除。
 *
 * 修法：超时后显式摘除自己的 resolver；set 空时 waiters.delete(sessionId)。
 * 本测试断言：超时轮询结束后 waiters 快照清空。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { __debugWaiterCounts } from '../arena';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces CASCADE`);
});

afterAll(async () => {
  await app?.close();
});

describe('审计 A6：长轮询超时清理 waiters', () => {
  it('超时返回空数组后，waiters 无残留', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/arena/sessions',
      payload: { scenario: '审计 A6 泄漏回归' },
    });
    expect(created.statusCode).toBe(201);
    const sessionId = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'GET',
      url: `/arena/sessions/${sessionId}/events?after=0&wait=1`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([]);

    // 超时分支跑完必须自摘；空 Set 必须从 Map 删除
    expect(__debugWaiterCounts()).toEqual({});
  });

  it('连续多次超时轮询不累积等待者', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/arena/sessions',
      payload: { scenario: '审计 A6 连续超时' },
    });
    const sessionId = (created.json() as { id: string }).id;
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'GET',
        url: `/arena/sessions/${sessionId}/events?after=0&wait=1`,
      });
    }
    expect(__debugWaiterCounts()).toEqual({});
  });
});
