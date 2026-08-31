/**
 * /stats/summary 路由测试：
 * - 空库 → 三项全 0
 * - 榜单1 参与数 = 持考场分（credit_scores）的去重 agent 数
 * - 榜单2 参与数 = 参与 Arena 会话（buyer/seller）的去重 agent 数，剔除平台对家
 * - 同一 agent 多场会话只算一次
 * - queueWaiting = test_queue 中 status=waiting 的行数
 */

import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, arenaSessions, creditScores, testQueue } from '../../db/schema';

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
  // 共享测试库：全表清理（顺序无关，TRUNCATE CASCADE）
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE feedback, test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
});

/** 直接注入 agent（绕过注册路由，聚焦统计口径）。 */
async function seedAgent(name: string): Promise<string> {
  const id = `ag-${randomUUID().slice(0, 8)}`;
  await db.insert(agents).values({ id, name });
  return id;
}

async function seedExamScore(agentId: string): Promise<void> {
  await db.insert(creditScores).values({
    id: `cs-${randomUUID().slice(0, 8)}`,
    agentId,
    score: 750,
    modelVersion: 'test',
  });
}

describe('GET /stats/summary', () => {
  it('空库返回全 0', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      leaderboard1Participants: 0,
      leaderboard2Participants: 0,
      queueWaiting: 0,
    });
  });

  it('榜单1：持考场分的去重 agent 数（同一 agent 多条分只算一次）', async () => {
    const a = await seedAgent('exam-agent-1');
    const b = await seedAgent('exam-agent-2');
    await seedExamScore(a);
    await seedExamScore(a); // 重复分数，不重复计数
    await seedExamScore(b);

    const res = await app.inject({ method: 'GET', url: '/stats/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json().leaderboard1Participants).toBe(2);
  });

  it('榜单2：参与 Arena 会话的去重 agent 数，剔除平台对家', async () => {
    const buyer = await seedAgent('arena-buyer');
    const seller = await seedAgent('arena-seller');
    const platform = await seedAgent('arena-buyer-platform');
    // buyer 同一 agent 参加两场 → 仍算 1
    await db.insert(arenaSessions).values([
      {
        id: `as-${randomUUID().slice(0, 8)}`,
        scenario: '标准交易',
        buyerAgentId: buyer,
        sellerAgentId: seller,
      },
      {
        id: `as-${randomUUID().slice(0, 8)}`,
        scenario: '标准交易',
        buyerAgentId: buyer,
        sellerAgentId: platform, // 平台对家不计入
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/stats/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json().leaderboard2Participants).toBe(2);
  });

  it('queueWaiting：test_queue 中 waiting 行数（含 exam lane）', async () => {
    const a = await seedAgent('queued-1');
    const b = await seedAgent('queued-2');
    await db.insert(testQueue).values([
      { ticket: `aq-${randomUUID().slice(0, 8)}`, agentId: a, lane: 'arena', status: 'waiting' },
      { ticket: `aq-${randomUUID().slice(0, 8)}`, agentId: b, lane: 'exam', status: 'waiting' },
      { ticket: `aq-${randomUUID().slice(0, 8)}`, agentId: a, lane: 'arena', status: 'done' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/stats/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json().queueWaiting).toBe(2);
  });
});
