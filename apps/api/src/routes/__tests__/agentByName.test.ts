/**
 * GET /agents/by-name/:name — 按注册名查档案（公开读）。
 *
 * 背景（2026-09-17，任务② Agent 档案页）：badge 早就支持按注册名（/badge/name/:name.svg），
 * 但档案页没有对应的名字直达入口——README 徽章挂出去，读者点进来只能看到一串 uuid。
 * 本路由补齐「名字 → 档案」这一跳，与 badge 的 name 口径一致（同名取最新注册）。
 *
 * 口径：
 * - 公开读，无认证（与 GET /agents/:id 同级），60/min/IP 限流防扫库；
 * - 未知名字 → 404 AGENT_NOT_FOUND（与 GET /agents/:id 同形）；
 * - 名字 URL-encoded（名字可含空格/中文）。
 *
 * 测试库只用 TEST_DATABASE_URL（acl_test），生产库零接触。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents } from '../../db/schema';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

const AGENT_ID = 'ag-byname-0001';
const AGENT_NAME = 'by-name-agent';

function get(url: string, ip?: string) {
  return app.inject({
    method: 'GET',
    url,
    ...(ip ? { remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip } } : {}),
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, credit_scores, score_snapshots, evidence CASCADE`);
  await db.insert(agents).values({
    id: AGENT_ID,
    name: AGENT_NAME,
    status: 'active',
    verificationLevel: 'basic',
  });
});

afterAll(async () => {
  await app?.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('GET /agents/by-name/:name', () => {
  it('存在的名字 → 200 且返回该 agent（id/name 对得上）', async () => {
    const res = await get(`/agents/by-name/${AGENT_NAME}`, '10.77.0.1');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; name: string };
    expect(body.id).toBe(AGENT_ID);
    expect(body.name).toBe(AGENT_NAME);
  });

  it('名字经 URL 编码（含空格）也能命中', async () => {
    const id = 'ag-byname-0002';
    await db.insert(agents).values({
      id,
      name: 'agent with space',
      status: 'active',
      verificationLevel: 'basic',
    });
    const res = await get(`/agents/by-name/${encodeURIComponent('agent with space')}`, '10.77.0.1');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }).id).toBe(id);
  });

  it('未知名字 → 404，响应形状与 /agents/:id 一致（同一错误契约，前端一套 notFound 处理）', async () => {
    const res = await get('/agents/by-name/no-such-agent', '10.77.0.1');
    expect(res.statusCode).toBe(404);
    const byId = await get('/agents/no-such-id', '10.77.0.1');
    expect(res.statusCode).toBe(byId.statusCode);
    expect(Object.keys(res.json() as object)).toEqual(Object.keys(byId.json() as object));
  });

  it('限流：60/min/IP → 第 61 次 429，他 IP 不受影响', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await get(`/agents/by-name/${AGENT_NAME}`, '10.77.0.9')).statusCode).toBe(200);
    }
    expect((await get(`/agents/by-name/${AGENT_NAME}`, '10.77.0.9')).statusCode).toBe(429);
    expect((await get(`/agents/by-name/${AGENT_NAME}`, '10.77.0.8')).statusCode).toBe(200);
  });
});
