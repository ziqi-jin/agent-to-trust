/**
 * GET /leaderboard — 勋章透出 + 维度筛选 + 组合维度重排（视图层）。
 *
 * 设计稿：docs/specs/2026-09-12-badge-system-design.md §3/§5。
 * 红线：勋章只认真实证据（real-benchmark/real/real-confidential），仿真/自报不发。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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

/** 构造某维度真实证据 n 条（real-benchmark）。 */
function realEv(agentId: string, dimension: string, n: number) {
  return Array.from({ length: n }, () => ({
    id: randomUUID(),
    agentId,
    dimension,
    source: 'real-benchmark' as const,
    sourceType: 'benchmark' as const,
    result: 'success' as const,
    value: 1,
    evidenceUri: `acl://benchmark/${randomUUID()}`,
  }));
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, evidence, credit_scores, score_snapshots CASCADE`,
  );

  await db.insert(agents).values([
    { id: 'ag-neg', name: 'neg-specialist', status: 'active', verificationLevel: 'basic', pubkey: 'pk-neg' },
    { id: 'ag-int', name: 'integrity-specialist', status: 'active', verificationLevel: 'basic', pubkey: 'pk-int' },
    { id: 'ag-sim', name: 'sim-agent-x', status: 'active', verificationLevel: 'basic', pubkey: 'pk-sim' },
    // 满分但 0 条真实证据的「真源」号（pubkey → real-benchmark，进得了榜）
    { id: 'ag-noev', name: 'noevidence-full', status: 'active', verificationLevel: 'basic', pubkey: 'pk-noev' },
  ]);

  const dims = (
    o: Record<string, number>,
  ): Array<{ dimension: string; score: number; weight: number; evidenceCount: number }> =>
    Object.entries(o).map(([dimension, score]) => ({ dimension, score, weight: 0.1, evidenceCount: 5 }));

  await db.insert(creditScores).values([
    {
      id: 'cs-neg',
      agentId: 'ag-neg',
      score: 700,
      adjustedScore: 600,
      confidence: 0.6,
      coverage: 0.3,
      modelVersion: 'baseline-v0.2',
      evidenceRefs: ['e1'],
      dimensions: dims({ negotiation: 92, integrity: 60, capability: 40 }),
    },
    {
      id: 'cs-int',
      agentId: 'ag-int',
      score: 720,
      adjustedScore: 610,
      confidence: 0.6,
      coverage: 0.3,
      modelVersion: 'baseline-v0.2',
      evidenceRefs: ['e1'],
      dimensions: dims({ negotiation: 61, integrity: 95, capability: 40 }),
    },
    {
      id: 'cs-sim',
      agentId: 'ag-sim',
      score: 900,
      adjustedScore: 800,
      confidence: 0.9,
      coverage: 0.9,
      modelVersion: 'baseline-v0.2',
      evidenceRefs: ['e1'],
      dimensions: dims({ negotiation: 100, integrity: 100 }),
    },
    {
      id: 'cs-noev',
      agentId: 'ag-noev',
      score: 900,
      adjustedScore: 850,
      confidence: 0.9,
      coverage: 0.9,
      modelVersion: 'baseline-v0.2',
      evidenceRefs: ['e1'],
      dimensions: dims({ negotiation: 100, integrity: 100 }),
    },
  ]);

  // 真实证据：neg 3 条 negotiation（够门槛）；int 3 条 integrity；sim 只有仿真证据（不发勋章）
  await db.insert(evidence).values([
    ...realEv('ag-neg', 'negotiation', 3),
    ...realEv('ag-int', 'integrity', 3),
  ]);
});

afterAll(async () => {
  await app?.close();
});

interface Row {
  agentId: string;
  rank: number;
  badges: Array<{ dimension: string; tier: string }>;
  dimensions: Array<{ dimension: string; score: number | null }>;
}

async function lb(query = ''): Promise<Row[]> {
  const res = await app.inject({ method: 'GET', url: `/leaderboard${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as Row[];
}

describe('勋章透出', () => {
  it('行内返回 dimensions 与 badges', async () => {
    const rows = await lb();
    const neg = rows.find((r) => r.agentId === 'ag-neg')!;
    expect(neg.dimensions.find((d) => d.dimension === 'negotiation')?.score).toBe(92);
    expect(neg.badges).toEqual([{ dimension: 'negotiation', tier: 'gold', score: 92 }]);
  });

  it('只认真实证据：仿真号不进公开榜（因此无勋章泄漏），满分但 0 真实证据也不发勋章', async () => {
    const rows = await lb();
    // 仿真号按设计不进公开榜 → 根本不会出现（比「有行但无勋章」更强的保证）。
    expect(rows.find((r) => r.agentId === 'ag-sim')).toBeUndefined();
    // 满分但 0 条真实证据的号：榜上有名，但勋章为空（勋章门槛 = 真实证据）。
    const noev = rows.find((r) => r.agentId === 'ag-noev')!;
    expect(noev.badges).toEqual([]);
  });

  it('integrity 95 → gold（分维阈值生效，与 negotiation 同分不同档）', async () => {
    const rows = await lb();
    const int = rows.find((r) => r.agentId === 'ag-int')!;
    expect(int.badges).toEqual([{ dimension: 'integrity', tier: 'gold', score: 95 }]);
  });
});

describe('维度筛选 + 组合重排（视图层）', () => {
  it('?dims=negotiation 按该维重排：neg(92) > int(61)', async () => {
    const rows = await lb('?dims=negotiation');
    expect(rows.map((r) => r.agentId).indexOf('ag-neg')).toBeLessThan(
      rows.map((r) => r.agentId).indexOf('ag-int'),
    );
  });

  it('?dims=integrity 反转：int(95) 排到 neg(60) 前', async () => {
    const rows = await lb('?dims=integrity');
    expect(rows.map((r) => r.agentId).indexOf('ag-int')).toBeLessThan(
      rows.map((r) => r.agentId).indexOf('ag-neg'),
    );
  });

  it('组合 ?dims=negotiation,integrity：加权和 neg(76) < int(78) → int 在前', async () => {
    const rows = await lb('?dims=negotiation,integrity');
    expect(rows.map((r) => r.agentId).indexOf('ag-int')).toBeLessThan(
      rows.map((r) => r.agentId).indexOf('ag-neg'),
    );
  });

  it('非法维度名 → 400（白名单校验）', async () => {
    const res = await app.inject({ method: 'GET', url: '/leaderboard?dims=not_a_dim' });
    expect(res.statusCode).toBe(400);
  });
});

describe('详情页勋章（GET /agents/:id/score，2026-09-13 补）', () => {
  interface ScoreBody {
    badges: Array<{ dimension: string; tier: string; score: number }>;
  }

  async function detailBadges(id: string): Promise<ScoreBody['badges']> {
    const res = await app.inject({ method: 'GET', url: `/agents/${id}/score` });
    expect(res.statusCode).toBe(200);
    return (res.json() as ScoreBody).badges;
  }

  it('有真实证据的号透出勋章（negotiation → gold）', async () => {
    expect(await detailBadges('ag-neg')).toEqual([
      { dimension: 'negotiation', tier: 'gold', score: 92 },
    ]);
  });

  it('满分但 0 条真实证据 → 不发勋章（红线）', async () => {
    expect(await detailBadges('ag-noev')).toEqual([]);
  });

  it('与榜单行同口径（同一 agent 两处结果逐字段一致）', async () => {
    const rows = await lb();
    const neg = rows.find((r) => r.agentId === 'ag-neg')!;
    expect(await detailBadges('ag-neg')).toEqual(neg.badges);
  });
});
