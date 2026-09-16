/**
 * GET /badge/:agentId.svg 公开读限流（S4-B M2 批 2，plan §Task 12）。
 *
 * 60/min/IP → 第 61 次 429（统一内存桶 services/rateLimit.ts）。
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

const AGENT_ID = 'ag-t12-badge';

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
  await db.insert(agents).values({
    id: AGENT_ID,
    name: 'badge-t12-agent',
    status: 'active',
    verificationLevel: 'basic',
  });
  await db.insert(creditScores).values({
    id: 'cs-t12-badge',
    agentId: AGENT_ID,
    score: 620,
    adjustedScore: 400,
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

describe('GET /badge/name/:name.svg 按注册名（0907 C2：README 抄名字就能用）', () => {
  it('存在名字 → 200 SVG 且非 agent not found', async () => {
    const res = await get(`/badge/name/${encodeURIComponent('badge-t12-agent')}.svg`, '10.89.0.9');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).not.toContain('agent not found');
  });

  it('未知名字 → 200 + agent not found 降级 SVG（徽章永不 404）', async () => {
    const res = await get('/badge/name/who-does-not-exist.svg', '10.89.0.9');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('agent not found');
  });
});

describe('GET /badge/:agentId.svg 限流（plan §Task 12）', () => {
  it('60/min/IP：第 61 次 → 429；他 IP 不受影响；SVG 响应头不因限流改动', async () => {
    const first = await get(`/badge/${AGENT_ID}.svg`, '10.89.0.1');
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('image/svg+xml');
    for (let i = 0; i < 59; i++) {
      expect((await get(`/badge/${AGENT_ID}.svg`, '10.89.0.1')).statusCode).toBe(200);
    }
    expect((await get(`/badge/${AGENT_ID}.svg`, '10.89.0.1')).statusCode).toBe(429);
    expect((await get(`/badge/${AGENT_ID}.svg`, '10.89.0.2')).statusCode).toBe(200);
  });
});
