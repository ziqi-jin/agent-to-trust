/**
 * 审计 B4【P2】E2E 过滤口径不一致。
 *
 * 证据：榜单用 /^e2e[-\s]/i（要求 e2e 后有 - 或空白），/stats、/events 的
 * publicAgentFilter 用 ILIKE 'e2e%'（任意后缀）。名为 e2efoo 的 agent 在榜单
 * 里照常上榜、在公开统计里却被剔除——同一实体两套口径。
 *
 * 修法：统一成 ILIKE 'e2e%' 语义（大小写不敏感前缀），榜单 isE2E 改 /^e2e/i。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, creditScores, evidence } from '../../db/schema';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

async function seed(id: string, name: string, score: number): Promise<void> {
  await db.insert(agents).values({ id, name, status: 'active', verificationLevel: 'basic' });
  await db.insert(creditScores).values({
    id: `cs-${id}`,
    agentId: id,
    score,
    adjustedScore: score,
    confidence: 0.5,
    modelVersion: 'baseline-v0.1',
    evidenceRefs: ['e1'],
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, credit_scores, score_snapshots, evidence CASCADE`,
  );
  await seed('ag-b4-normal', 'normal-b4-agent', 700);
  // 无分隔符的 e2e 号：旧榜单口径放行、旧统计口径已剔除（不一致的根源）
  await seed('ag-b4-e2efoo', 'e2efoo', 950);
  await seed('ag-b4-e2eupper', 'E2EUpper', 940);
  // 行为榜资格证据（arena + real-benchmark），确保它本来能进 behavior 榜
  await db.insert(evidence).values([
    { id: 'ev-b4-arena', agentId: 'ag-b4-e2efoo', dimension: 'delivery', source: 'arena', result: 'success' },
    {
      id: 'ev-b4-bench',
      agentId: 'ag-b4-e2efoo',
      dimension: 'capability',
      source: 'real-benchmark',
      result: 'success',
    },
    { id: 'ev-b4-normal', agentId: 'ag-b4-normal', dimension: 'capability', source: 'real', result: 'success' },
  ]);
});

afterAll(async () => {
  await app?.close();
});

describe('审计 B4：e2e 前缀口径统一为 ILIKE e2e%', () => {
  it('capability 榜：e2efoo / E2EUpper 均不上榜，普通 agent 在榜', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/leaderboard?board=capability' })).json() as Array<{
      agentId: string;
    }>;
    expect(rows.find((r) => r.agentId === 'ag-b4-e2efoo')).toBeUndefined();
    expect(rows.find((r) => r.agentId === 'ag-b4-e2eupper')).toBeUndefined();
    expect(rows.find((r) => r.agentId === 'ag-b4-normal')).toBeDefined();
  });

  it('behavior 榜：e2efoo 即便满足资格也不上榜', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/leaderboard?board=behavior' })).json() as Array<{
      agentId: string;
    }>;
    expect(rows.find((r) => r.agentId === 'ag-b4-e2efoo')).toBeUndefined();
  });

  it('/stats?scope=public 与榜单同口径：只计普通 agent', async () => {
    const body = (
      await app.inject({ method: 'GET', url: '/stats?scope=public' })
    ).json() as { agentCount: number; evidenceCount: number; scoreCount: number };
    expect(body.agentCount).toBe(1); // 只有 normal-b4-agent
    expect(body.scoreCount).toBe(1);
    expect(body.evidenceCount).toBe(1); // 只有 normal 的 real 证据
  });

  it('/events?scope=public 不返回 e2e 号证据', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/events?scope=public' })).json() as Array<{
      agentId: string;
    }>;
    expect(rows.every((r) => r.agentId === 'ag-b4-normal')).toBe(true);
  });
});
