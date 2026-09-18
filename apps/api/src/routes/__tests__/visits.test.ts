/**
 * /visits 路由测试（2026-09-18 老大：两站页脚显示访问数）：
 * - POST /visits → PV +1，返回 {total, today}
 * - 连续 POST → total 累加
 * - GET /visits → 只读，不改变计数
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
});

beforeEach(async () => {
  await db.execute('TRUNCATE TABLE page_visits');
});

afterAll(async () => {
  await app.close();
});

describe('/visits', () => {
  it('POST 计数 +1 并返回 total/today', async () => {
    const res = await app.inject({ method: 'POST', url: '/visits' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; today: number };
    expect(body.total).toBe(1);
    expect(body.today).toBe(1);
  });

  it('连续上报累加', async () => {
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/visits' });
    const res = await app.inject({ method: 'GET', url: '/visits' });
    expect(res.json()).toEqual({ total: 3, today: 3 });
  });

  it('GET 只读，不改变计数', async () => {
    await app.inject({ method: 'POST', url: '/visits' });
    await app.inject({ method: 'GET', url: '/visits' });
    const res = await app.inject({ method: 'GET', url: '/visits' });
    expect((res.json() as { total: number }).total).toBe(1);
  });

  it('空表读数为 0', async () => {
    const res = await app.inject({ method: 'GET', url: '/visits' });
    expect(res.json()).toEqual({ total: 0, today: 0 });
  });
});
