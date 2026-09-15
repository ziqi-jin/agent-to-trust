/**
 * 榜2（行为榜）对家模式筛选 —— 2026-09-14 Live Counterpart Engine（Task 8）。
 *
 * 行为证据三口径落库（Task 7 / Task 11）：scripted → evidence.source_type='arena-behavior'，
 * live → 'arena-behavior-live'，A2A → 'arena-behavior-a2a'（source 均为 'arena'）。
 * 本测试覆盖 GET /leaderboard?board=behavior&mode=scripted|live|all：
 *  - mode=scripted 只返回仅有脚本证据的 agent（A）
 *  - mode=live 只返回 live 口径的 agent（B + A2A，spec §4.3：who 轴同为 live）
 *  - mode=all / 缺省 返回三者
 *  - 非法 mode → 400
 *  - 每行 counterpartModes 正确反映该 agent 有行为证据的模式集合
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

const dims = (
  o: Record<string, number>,
): Array<{ dimension: string; score: number; weight: number; evidenceCount: number }> =>
  Object.entries(o).map(([dimension, score]) => ({
    dimension,
    score,
    weight: 0.1,
    evidenceCount: 5,
  }));

async function seed(opts: {
  id: string;
  name: string;
  sourceType: 'arena-behavior' | 'arena-behavior-live' | 'arena-behavior-a2a';
}): Promise<void> {
  await db.insert(agents).values({
    id: opts.id,
    name: opts.name,
    status: 'active',
    verificationLevel: 'basic',
    pubkey: `pk-${opts.id}`,
  });
  await db.insert(creditScores).values({
    id: `cs-${opts.id}`,
    agentId: opts.id,
    score: 800,
    adjustedScore: 400,
    confidence: 0.5,
    coverage: 0.3,
    modelVersion: 'baseline-v0.2',
    evidenceRefs: ['e1'],
    dimensions: dims({ delivery: 100 }),
  });
  // 行为榜资格三件套：arena 行为证据（区分口径）+ 真实证据（real-benchmark）+ 考场分 ≥ 门槛
  await db.insert(evidence).values([
    {
      id: `ev-${opts.id}-arena`,
      agentId: opts.id,
      dimension: 'delivery',
      source: 'arena',
      sourceType: opts.sourceType,
      result: 'success',
    },
    {
      id: `ev-${opts.id}-bench`,
      agentId: opts.id,
      dimension: 'delivery',
      source: 'real-benchmark',
      result: 'success',
    },
  ]);
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, evidence, credit_scores, score_snapshots CASCADE`,
  );
  await seed({ id: 'ag-scripted', name: 'scripted-agent', sourceType: 'arena-behavior' });
  await seed({ id: 'ag-live', name: 'live-agent', sourceType: 'arena-behavior-live' });
  await seed({ id: 'ag-a2a', name: 'a2a-agent', sourceType: 'arena-behavior-a2a' });
});

afterAll(async () => {
  await app?.close();
});

interface Row {
  agentId: string;
  counterpartModes: string[];
}

function modeBoard(mode?: string): Promise<{ status: number; rows: Row[] }> {
  const url = `/leaderboard?board=behavior${mode === undefined ? '' : `&mode=${mode}`}`;
  return app.inject({ method: 'GET', url }).then((res) => ({
    status: res.statusCode,
    rows: res.statusCode === 200 ? (res.json() as Row[]) : [],
  }));
}

const ids = (rows: Row[]): string[] => rows.map((r) => r.agentId).sort();

describe('榜2 对家模式筛选（Task 8）', () => {
  it('mode=scripted 只返回仅有脚本证据的 agent', async () => {
    const { status, rows } = await modeBoard('scripted');
    expect(status).toBe(200);
    expect(ids(rows)).toEqual(['ag-scripted']);
  });

  it('mode=live 返回 live 与 A2A 口径的 agent（spec §4.3：who 轴同为 live）', async () => {
    const { status, rows } = await modeBoard('live');
    expect(status).toBe(200);
    expect(ids(rows)).toEqual(['ag-a2a', 'ag-live']);
  });

  it('mode=all 返回三者', async () => {
    const { status, rows } = await modeBoard('all');
    expect(status).toBe(200);
    expect(ids(rows)).toEqual(['ag-a2a', 'ag-live', 'ag-scripted']);
  });

  it('缺省 mode 等价于 all，返回三者', async () => {
    const { status, rows } = await modeBoard();
    expect(status).toBe(200);
    expect(ids(rows)).toEqual(['ag-a2a', 'ag-live', 'ag-scripted']);
  });

  it('非法 mode → 400', async () => {
    const { status } = await modeBoard('bogus');
    expect(status).toBe(400);
  });

  it('每行 counterpartModes 反映该 agent 行为证据的模式集合', async () => {
    const { rows } = await modeBoard('all');
    const a = rows.find((r) => r.agentId === 'ag-scripted')!;
    const b = rows.find((r) => r.agentId === 'ag-live')!;
    const c = rows.find((r) => r.agentId === 'ag-a2a')!;
    expect(a.counterpartModes).toEqual(['scripted']);
    expect(b.counterpartModes).toEqual(['live']);
    // Task 11：A2A 证据 who 轴归 live（how 轴 sdk/a2a 延后 P1）
    expect(c.counterpartModes).toEqual(['live']);
  });
});
