/**
 * D1【EXAMINED→31】—— 2026-09-09 13:17 老大拍板。
 *
 * 现象：报头 EXAMINED 一度 =160（31 公开 + 100 仿真 sim-agent-* + 29 狗粮 e2e*）。
 * 根因：/stats/summary 的 lb1（credit_scores 去重 agent 数）只过滤
 * `leaderboard_visible`，没排仿真号 / E2E 号 / 平台保留名，与 /stats?scope=public、
 * /events?scope=public 的门面口径打架（0907 走查「数字对不上账」同款病）。
 *
 * 拍板：EXAMINED = 公开登记且持分的真实 agent 数（=31）。
 * 修法：lb1 与门面统计共用同一份 publicAgentFilter（单一实现，防口径漂移）。
 *
 * 复现测试：造 sim-agent-* / e2e-* / __platform__ 持分 agent + 一个公开 agent，
 * 断言 EXAMINED 只数公开那个；且 /stats?scope=public 与 lb1 同口径（单一实现回归）。
 */

import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
});

beforeEach(async () => {
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE feedback, test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
});

/** 注入 agent + 一条考场分（默认 leaderboard_visible=true）。 */
async function seedScored(name: string, opts: { score?: boolean } = {}): Promise<string> {
  const id = `ag-${randomUUID().slice(0, 8)}`;
  await db.insert(agents).values({ id, name });
  if (opts.score !== false) {
    await db.insert(creditScores).values({
      id: `cs-${randomUUID().slice(0, 8)}`,
      agentId: id,
      score: 750,
      modelVersion: 'test',
    });
  }
  return id;
}

describe('D1：/stats/summary lb1 = 公开登记且持分的真实 agent 数（EXAMINED）', () => {
  it('不计仿真号 sim-agent-* / E2E 号 e2e* / 平台保留名 __platform__', async () => {
    await seedScored('public-exam-agent'); // 唯一应被计入
    await seedScored('sim-agent-7'); // 仿真号
    await seedScored('sim-agent-8');
    await seedScored('e2e-run-0909'); // 狗粮 / E2E 号
    await seedScored('E2E-Upper'); // 大小写不敏感（审计 B4 口径）
    await seedScored('__platform__'); // 平台保留名（内部哨兵）

    const res = await app.inject({ method: 'GET', url: '/stats/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json().leaderboard1Participants).toBe(1);
  });

  it('公开号但无分（未持分）不计入 EXAMINED', async () => {
    await seedScored('public-scored');
    await seedScored('public-no-score', { score: false });

    const res = await app.inject({ method: 'GET', url: '/stats/summary' });
    expect(res.json().leaderboard1Participants).toBe(1);
  });

  it('单一实现回归：lb1 与 /stats?scope=public 同口径', async () => {
    await seedScored('public-a');
    await seedScored('sim-agent-1');
    await seedScored('e2e-b');
    await seedScored('__platform__');

    const summary = (await app.inject({ method: 'GET', url: '/stats/summary' })).json() as {
      leaderboard1Participants: number;
    };
    const publicStats = (
      await app.inject({ method: 'GET', url: '/stats?scope=public' })
    ).json() as { agentCount: number };
    expect(summary.leaderboard1Participants).toBe(1);
    expect(publicStats.agentCount).toBe(1);
  });
});
