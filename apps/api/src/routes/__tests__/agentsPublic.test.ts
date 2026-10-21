/**
 * SEO 发现管道（2026-10-07）：GET /agents/public 公开名册端点。
 *
 * 契约：
 * - 只回公开可索引 agent：publicAgentFilter（剔仿真号/E2E 号/平台保留名）+ leaderboardVisible=true；
 * - 最小字段（id/name/updatedAt），不回分数/证据（防扫库放大）；
 * - 公开读、限流 120/min/IP。
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

async function seedAgent(id: string, name: string, leaderboardVisible = true): Promise<void> {
  await db.insert(agents).values({
    id,
    name,
    status: 'active',
    verificationLevel: 'basic',
    leaderboardVisible,
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, credit_scores, score_snapshots, evidence CASCADE`,
  );
});

afterAll(async () => {
  await app?.close();
});

describe('GET /agents/public — SEO 公开名册', () => {
  it('回公开可见 agent 的 id/name，含真实上榜号', async () => {
    await seedAgent('ag-pub-1', 'jiuwenswarm');
    const res = await app.inject({ method: 'GET', url: '/agents/public' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agents: Array<{ id: string; name: string }> };
    const hit = body.agents.find((a) => a.name === 'jiuwenswarm');
    expect(hit?.id).toBe('ag-pub-1');
  });

  it('剔除 E2E 号（e2e 前缀，大小写不敏感）', async () => {
    await seedAgent('ag-e2e', 'e2e-smoke-1');
    await seedAgent('ag-E2E', 'E2E-Upper');
    const res = await app.inject({ method: 'GET', url: '/agents/public' });
    const names = (res.json() as { agents: Array<{ name: string }> }).agents.map((a) => a.name);
    expect(names.some((n) => /^e2e/i.test(n))).toBe(false);
  });

  it('剔除仿真号（sim-agent- 前缀）', async () => {
    await seedAgent('ag-sim', 'sim-agent-abc');
    const res = await app.inject({ method: 'GET', url: '/agents/public' });
    const names = (res.json() as { agents: Array<{ name: string }> }).agents.map((a) => a.name);
    expect(names).not.toContain('sim-agent-abc');
  });

  it('剔除平台保留名 __platform__', async () => {
    await seedAgent('ag-plat', '__platform__');
    const res = await app.inject({ method: 'GET', url: '/agents/public' });
    const names = (res.json() as { agents: Array<{ name: string }> }).agents.map((a) => a.name);
    expect(names).not.toContain('__platform__');
  });

  it('剔除 opt-out（leaderboardVisible=false）', async () => {
    await seedAgent('ag-opt-out', 'hidden-from-index', false);
    const res = await app.inject({ method: 'GET', url: '/agents/public' });
    const names = (res.json() as { agents: Array<{ name: string }> }).agents.map((a) => a.name);
    expect(names).not.toContain('hidden-from-index');
  });

  it('响应不含分数/证据字段（最小投影，防扫库）', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/public' });
    const body = res.json() as { agents: Array<Record<string, unknown>> };
    for (const a of body.agents) {
      expect(Object.keys(a).sort()).toEqual(['id', 'name', 'updatedAt']);
    }
  });
});
