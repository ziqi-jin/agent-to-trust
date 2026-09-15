/**
 * GET /agents/:id/score 公开读限流（S4-B M2 批 2，plan §Task 12）。
 *
 * 60/min/IP → 第 61 次 429（统一内存桶 services/rateLimit.ts）。
 * 红线：scores.ts 只准加限流，computeAndPersist 本体零改动；
 * 测试库只用 TEST_DATABASE_URL（acl_test），生产库零接触。
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

const AGENT_ID = 'ag-t12-score';

function get(url: string, ip?: string) {
  return app.inject({
    method: 'GET',
    url,
    // 指定私网 remoteAddress（uniquelocal 信任段）+ XFF → req.ip 取 XFF，模拟不同用户
    ...(ip ? { remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip } } : {}),
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, credit_scores, score_snapshots, evidence CASCADE`,
  );
  // 直插评分行，避免 GET 走 computeAndPersist 写路径（本文件只测读限流）
  await db.insert(agents).values({
    id: AGENT_ID,
    name: 'score-t12-agent',
    status: 'active',
    verificationLevel: 'basic',
  });
  await db.insert(creditScores).values({
    id: 'cs-t12-score',
    agentId: AGENT_ID,
    score: 500,
    adjustedScore: 350,
    confidence: 0.5,
    modelVersion: 'baseline-v0.2',
    evidenceRefs: ['e1'],
  });
});

afterAll(async () => {
  await app?.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('GET /agents/:id/score 限流（plan §Task 12）', () => {
  it('60/min/IP：第 61 次 → 429；他 IP 不受影响', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await get(`/agents/${AGENT_ID}/score`, '10.88.0.1')).statusCode).toBe(200);
    }
    expect((await get(`/agents/${AGENT_ID}/score`, '10.88.0.1')).statusCode).toBe(429);
    expect((await get(`/agents/${AGENT_ID}/score`, '10.88.0.2')).statusCode).toBe(200);
  });
});
