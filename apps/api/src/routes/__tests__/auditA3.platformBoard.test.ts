/**
 * 审计 A3【P1】平台对家混进公开能力榜（capability 榜）。
 *
 * 证据：simulation.ts capability 过滤链（source/isE2E/leaderboardVisible/成交门槛）
 * 缺 PLATFORM_NAME 排除；behavior 榜已挡、stats.ts lb2 已显式 `name <> PLATFORM_NAME`。
 * 平台账号 arena-buyer-platform 现为公开榜第 17 名、全榜唯一 1000 分。
 *
 * 修法：capability 过滤加平台名排除（与 lb2 口径一致）。
 * 本测试先复现：平台账号持分时 GET /leaderboard（capability 与默认）不得含它。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, creditScores } from '../../db/schema';
import { PLATFORM_NAME } from '../arenaQueue';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

async function seed(id: string, name: string, score: number): Promise<void> {
  await db.insert(agents).values({
    id,
    name,
    status: 'active',
    verificationLevel: 'basic',
  });
  await db.insert(creditScores).values({
    id: `cs-${id}`,
    agentId: id,
    score,
    adjustedScore: score,
    confidence: 1,
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
  // 平台对家：全榜唯一 1000 分（审计复现数据）
  await seed('platform-arena-buyer', PLATFORM_NAME, 1000);
  await seed('ag-normal-a3', 'normal-agent-a3', 800);
});

afterAll(async () => {
  await app?.close();
});

describe('审计 A3：平台对家不得进公开能力榜', () => {
  it('报头口径：/stats/summary lb1 与 /stats?scope=public 均不含平台对家（首页大数字对账）', async () => {
    // 复现：平台对家当 buyer 结算会拿信用分 → 若 publicAgentFilter 漏排实名平台号，
    // 报头 EXAMINED/REGISTERED 会把它算进去，与榜1 行数对不上账（RELEASE_CHECKLIST §2）。
    const summary = (await app.inject({ method: 'GET', url: '/stats/summary' })).json() as {
      leaderboard1Participants: number;
    };
    const publicStats = (
      await app.inject({ method: 'GET', url: '/stats?scope=public' })
    ).json() as { agentCount: number };
    expect(summary.leaderboard1Participants).toBe(1); // 只有 normal-agent-a3
    expect(publicStats.agentCount).toBe(1);
  });

  it('GET /leaderboard?board=capability 不含 arena-buyer-platform', async () => {
    const res = await app.inject({ method: 'GET', url: '/leaderboard?board=capability' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ agentId: string; name: string; rank: number }>;
    expect(rows.find((r) => r.name === PLATFORM_NAME)).toBeUndefined();
    // 对照：普通 agent 仍在榜（排除不是把榜单打空）
    expect(rows.find((r) => r.agentId === 'ag-normal-a3')).toBeDefined();
  });

  it('GET /leaderboard（默认 capability）同样不含平台账号', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/leaderboard' })).json() as Array<{
      name: string;
    }>;
    expect(rows.find((r) => r.name === PLATFORM_NAME)).toBeUndefined();
  });
});
