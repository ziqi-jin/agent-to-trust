/**
 * 榜2（行为榜）口径回归 —— 2026-09-13 老大拍板 A。
 *
 * 缺陷：behaviorScore 只做「非能力维度加权和 ÷ 已覆盖维度权重 × 10」，
 * **没有乘置信度 × 新鲜度** → 稀疏号（只考一门满分）竟得 1000 分，反超榜1 印章。
 *
 * 修法 A：与榜1 印章同尺 —— behaviorScore = round(base × confidence × freshness)。
 * 效果：稀疏号（只考一门满分）不再动辄 1000，随证据量与时效折减。
 * 边界说明：榜2 只算**非能力维度**，若某 agent 非能力维强于能力维，榜2 可高于榜1
 * （独立轴，设计使然）；A 修的是「无置信/时效折减」的爆表，不是强制 ≤。
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
  score: number;
  confidence: number;
  freshnessDays?: number;
  dimensions: Record<string, number>;
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
    score: opts.score,
    adjustedScore: 400,
    confidence: opts.confidence,
    coverage: 0.3,
    modelVersion: 'baseline-v0.1',
    evidenceRefs: ['e1'],
    ...(opts.freshnessDays !== undefined ? { freshnessDays: opts.freshnessDays } : {}),
    dimensions: dims(opts.dimensions),
  });
  // 行为榜资格三件套：arena 证据 + 真实证据（real-benchmark）+ 考场分 ≥ ARENA_GATE_SCORE
  await db.insert(evidence).values([
    { id: `ev-${opts.id}-arena`, agentId: opts.id, dimension: 'delivery', source: 'arena', result: 'success' },
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
});

afterAll(async () => {
  await app?.close();
});

interface Row {
  agentId: string;
  adjustedScore: number | null;
  confidence: number;
  behaviorScore: number | null;
}

async function behaviorBoard(): Promise<Row[]> {
  const res = await app.inject({ method: 'GET', url: '/leaderboard?board=behavior' });
  expect(res.statusCode).toBe(200);
  return res.json() as Row[];
}

describe('榜2 口径 = base × 置信度 × 新鲜度（2026-09-13 拍板 A）', () => {
  it('稀疏号（只 delivery=100）不再得 1000：按置信度折减', async () => {
    // base = (100×0.1 ÷ 0.1) × 10 = 1000；confidence=0.5 → 500
    await seed({
      id: 'ag-sparse',
      name: 'sparse-agent',
      score: 800,
      confidence: 0.5,
      dimensions: { delivery: 100 },
    });
    const row = (await behaviorBoard()).find((r) => r.agentId === 'ag-sparse')!;
    expect(row).toBeDefined();
    expect(row.behaviorScore).toBe(500);
  });

  it('新鲜度也参与折减：freshnessDays=30 → factor 0.5', async () => {
    // base=1000 × conf 0.5 × fresh 0.5 = 250
    await seed({
      id: 'ag-stale',
      name: 'stale-agent',
      score: 800,
      confidence: 0.5,
      freshnessDays: 30,
      dimensions: { delivery: 100 },
    });
    const row = (await behaviorBoard()).find((r) => r.agentId === 'ag-stale')!;
    expect(row.behaviorScore).toBe(250);
  });

  it('同一 base 下，置信度越高行为分越高（折减单调，防放水）', async () => {
    await seed({ id: 'ag-lo', name: 'lo-conf', score: 800, confidence: 0.2, dimensions: { delivery: 100 } });
    await seed({ id: 'ag-hi', name: 'hi-conf', score: 800, confidence: 0.8, dimensions: { delivery: 100 } });
    const rows = await behaviorBoard();
    const lo = rows.find((r) => r.agentId === 'ag-lo')!;
    const hi = rows.find((r) => r.agentId === 'ag-hi')!;
    // base 均为 1000：lo → 200，hi → 800
    expect(lo.behaviorScore).toBe(200);
    expect(hi.behaviorScore).toBe(800);
  });

  it('行为分 = round(base × confidence × freshness)，与榜1 同尺', async () => {
    // base=1000（delivery=100 单维）· conf=0.6 · fresh=0.25(60天) → 150
    await seed({ id: 'ag-chk', name: 'chk-agent', score: 800, confidence: 0.6, freshnessDays: 60, dimensions: { delivery: 100 } });
    const row = (await behaviorBoard()).find((r) => r.agentId === 'ag-chk')!;
    expect(row.behaviorScore).toBe(150);
  });

  it('capability 维仍被排除在行为分之外（只算非能力维）', async () => {
    // capability=100 不该进 base；只有 delivery=50 → base = (50×0.1/0.1)×10 = 500；×conf0.5 = 250
    await seed({
      id: 'ag-cap',
      name: 'cap-agent',
      score: 800,
      confidence: 0.5,
      dimensions: { capability: 100, delivery: 50 },
    });
    const row = (await behaviorBoard()).find((r) => r.agentId === 'ag-cap')!;
    expect(row.behaviorScore).toBe(250);
  });
});
