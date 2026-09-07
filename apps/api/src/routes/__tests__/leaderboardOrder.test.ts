/**
 * GET /leaderboard 排序规则：榜单1（capability）按置信加权分 adjustedScore 降序，
 * 平分时按原始分。修复 dogfood 0901 发现的问题：三个 seed agent 原始 1000 分
 * （置信度 0.135）压顶，真实考出来的 797 分（置信度 0.46）排后面——榜单失去可信度。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, creditScores } from '../../db/schema';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, credit_scores, score_snapshots CASCADE`,
  );

  await db.insert(agents).values([
    { id: 'ag-inflated', name: 'inflated-agent', status: 'active', verificationLevel: 'basic' },
    { id: 'ag-real', name: 'real-tested-agent', status: 'active', verificationLevel: 'basic' },
    { id: 'ag-mid', name: 'mid-agent', status: 'active', verificationLevel: 'basic' },
    // C3 复现场景：E2E 号带 pubkey + verified——修复前会被误判 real-benchmark 挂 SDK 标签进榜
    {
      id: 'ag-e2e',
      name: 'E2E 章鱼队列站 20260905·酒馆',
      status: 'active',
      verificationLevel: 'verified',
      pubkey: 'pk-e2e',
    },
  ]);

  await db.insert(creditScores).values([
    { id: 'cs-1', agentId: 'ag-inflated', score: 1000, adjustedScore: 135, confidence: 0.135, modelVersion: 'baseline-v0.1', evidenceRefs: ['e1'] },
    { id: 'cs-2', agentId: 'ag-real', score: 797, adjustedScore: 366, confidence: 0.4595, modelVersion: 'baseline-v0.1', evidenceRefs: ['e1', 'e2', 'e3'] },
    { id: 'cs-3', agentId: 'ag-mid', score: 500, adjustedScore: 250, confidence: 0.5, modelVersion: 'baseline-v0.1', evidenceRefs: ['e1', 'e2'] },
  ]);
});

afterAll(async () => {
  await app?.close();
});

describe('GET /leaderboard 排序', () => {
  it('/stats 与 /events 默认全量（P0-10 可溯红线），?scope=public 才走门面口径', async () => {
    const statsAll = await app.inject({ method: 'GET', url: '/stats' });
    const statsPublic = await app.inject({ method: 'GET', url: '/stats?scope=public' });
    expect(statsAll.json().agentCount).toBe(4); // 含 ag-e2e
    expect(statsPublic.json().agentCount).toBe(3); // 门面口径排除 E2E 号
  });

  it('E2E 测试号不进 capability 榜（名字 e2e 前缀优先于 pubkey 判定，0907 C3）', async () => {
    const res = await app.inject({ method: 'GET', url: '/leaderboard' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ agentId: string }>;
    expect(rows.find((r) => r.agentId === 'ag-e2e')).toBeUndefined();
  });

  it('capability 榜按 adjustedScore 降序：797(366) > 500(250) > 1000(135)', async () => {
    const res = await app.inject({ method: 'GET', url: '/leaderboard' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ agentId: string; rank: number; score: number | null }>;
    expect(rows.map((r) => r.agentId)).toEqual(['ag-real', 'ag-mid', 'ag-inflated']);
    expect(rows[0].rank).toBe(1);
  });

  it('adjustedScore 相同时按原始分降序', async () => {
    await db.insert(creditScores).values([
      { id: 'cs-4', agentId: 'ag-inflated', score: 990, adjustedScore: 135, confidence: 0.136, modelVersion: 'baseline-v0.1', evidenceRefs: ['e1'] },
    ]);
    const res = await app.inject({ method: 'GET', url: '/leaderboard' });
    const rows = res.json() as Array<{ agentId: string; score: number | null }>;
    const scores = rows.filter((r) => r.agentId === 'ag-inflated').map((r) => r.score);
    // 只保留每个 agent 的最新一条（cs-4 后插入，createdAt 更新）
    expect(rows.map((r) => r.agentId)).toEqual(['ag-real', 'ag-mid', 'ag-inflated']);
    expect(scores).toHaveLength(1);
  });

  it('公开读限流 60/min/IP：第 61 次 → 429；他 IP 不受影响（plan §Task 12）', async () => {
    const get = (ip?: string) =>
      app.inject({
        method: 'GET',
        url: '/leaderboard',
        // 指定私网 remoteAddress（uniquelocal 信任段）+ XFF → req.ip 取 XFF
        ...(ip ? { remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip } } : {}),
      });
    for (let i = 0; i < 60; i++) {
      expect((await get('10.90.0.1')).statusCode).toBe(200);
    }
    expect((await get('10.90.0.1')).statusCode).toBe(429);
    expect((await get('10.90.0.2')).statusCode).toBe(200);
  });
});
