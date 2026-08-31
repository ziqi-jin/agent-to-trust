/**
 * /feedback 路由测试（隐蔽入口收集）：
 * - 有效反馈 → 201 + 落库（message/contact/page）
 * - message 空 / 超长 → 400
 * - contact/page 超长 → 400
 * - 同 IP 限速：窗口内超上限 → 429，窗口过后恢复
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { feedback } from '../../db/schema';
import { resetFeedbackLimiterForTests } from '../feedback';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  process.env.FEEDBACK_RATE_MAX = '2';
  process.env.FEEDBACK_RATE_WINDOW_MS = '60000';
});

afterAll(() => {
  delete process.env.FEEDBACK_RATE_MAX;
  delete process.env.FEEDBACK_RATE_WINDOW_MS;
});

beforeEach(async () => {
  resetFeedbackLimiterForTests();
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE feedback CASCADE' as any),
  );
});

async function postFeedback(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/feedback', payload });
}

describe('POST /feedback', () => {
  it('有效反馈 → 201 + 落库', async () => {
    const res = await postFeedback({
      message: '榜单加载有点慢',
      contact: 'tg:@tester',
      page: '/#leaderboard',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });

    const rows = await db.select().from(feedback);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('榜单加载有点慢');
    expect(rows[0].contact).toBe('tg:@tester');
    expect(rows[0].page).toBe('/#leaderboard');
  });

  it('可选字段缺省 → 落库为 null', async () => {
    const res = await postFeedback({ message: '不错' });
    expect(res.statusCode).toBe(201);
    const rows = await db.select().from(feedback);
    expect(rows[0].contact).toBeNull();
    expect(rows[0].page).toBeNull();
  });

  it('message 空 / 纯空白 → 400', async () => {
    expect((await postFeedback({})).statusCode).toBe(400);
    expect((await postFeedback({ message: '' })).statusCode).toBe(400);
    expect((await postFeedback({ message: '   ' })).statusCode).toBe(400);
  });

  it('message 超长（>2000）→ 400', async () => {
    const res = await postFeedback({ message: 'x'.repeat(2001) });
    expect(res.statusCode).toBe(400);
  });

  it('contact 超长（>200）→ 400', async () => {
    const res = await postFeedback({ message: 'ok', contact: 'c'.repeat(201) });
    expect(res.statusCode).toBe(400);
  });

  it('同 IP 限速：窗口内第 3 条 → 429，窗口过后恢复', async () => {
    expect((await postFeedback({ message: 'a' })).statusCode).toBe(201);
    expect((await postFeedback({ message: 'b' })).statusCode).toBe(201);
    expect((await postFeedback({ message: 'c' })).statusCode).toBe(429);

    // 缩窗测试恢复：窗口 100ms 后放行
    process.env.FEEDBACK_RATE_WINDOW_MS = '100';
    await new Promise((r) => setTimeout(r, 150));
    expect((await postFeedback({ message: 'd' })).statusCode).toBe(201);
  });
});
