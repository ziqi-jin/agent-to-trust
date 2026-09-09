/**
 * T6 榜单上报开关（老大 2026-09-08 17:00 拍板，设计冻结）：
 *
 * - agents.leaderboard_visible boolean NOT NULL DEFAULT true（默认上榜、可关；迁移带默认值，无需回填）；
 * - 一个开关管两榜：GET /leaderboard capability（榜单1）与 behavior（榜单2）都吃过滤；
 * - opt-out 后详情页直链保留（同 unlisted 先例）：GET /agents/:id、/score、/evidence 照常 200；
 * - ≥3 单成交门槛双保险（主要针对榜单1，解决榜单膨胀）：酒馆身份 agent（pubkey
 *   `tavern-agent-` 前缀）settled（economic/success 真实证据）<3 不上榜；
 *   SDK/考场 agent（无酒馆伪 pubkey）没有「成交」概念，豁免门槛（偏差记录在案）；
 * - 注册时可选：POST /agents 带 leaderboardVisible；注册后可改：PATCH /agents/:id；
 * - 酒馆服务端同步：POST /ingest/agent-visibility（bearer 机构级，同 trade-evidence 信任锚）
 *   ——随注册传 ACL（不存在则建号），注册后改（更新既有）；
 * - /stats/summary 两榜参与数同步吃可见性过滤（与公开面口径一致，0907 走查「数字对不上账」教训）。
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, arenaSessions, creditScores, evidence } from '../../db/schema';
import { tavernExternalId } from '../../services/tavernIdentity';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;
const INGEST_TOKEN = 'test-token-t6-visibility';

/** 造一条 settled（confirmed 成交）真实证据：economic/success/real。 */
function settledEvidence(id: string, agentId: string) {
  return {
    id,
    agentId,
    dimension: 'economic',
    source: 'real',
    sourceType: 'real',
    issuer: 'tavern-market',
    result: 'success' as const,
  };
}

async function seedScoredAgent(opts: {
  id: string;
  name: string;
  pubkey?: string;
  leaderboardVisible?: boolean;
  score?: number;
}): Promise<void> {
  await db.insert(agents).values({
    id: opts.id,
    name: opts.name,
    status: 'active',
    verificationLevel: 'basic',
    ...(opts.pubkey !== undefined ? { pubkey: opts.pubkey } : {}),
    ...(opts.leaderboardVisible !== undefined
      ? { leaderboardVisible: opts.leaderboardVisible }
      : {}),
  });
  await db.insert(creditScores).values({
    id: `cs-${opts.id}`,
    agentId: opts.id,
    score: opts.score ?? 700,
    adjustedScore: (opts.score ?? 700) - 100,
    confidence: 0.5,
    modelVersion: 'baseline-v0.1',
    evidenceRefs: ['e1', 'e2'],
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  process.env.ACL_TRADE_INGEST_TOKEN = INGEST_TOKEN;
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, credit_scores, score_snapshots, evidence CASCADE`,
  );
});

afterAll(async () => {
  await app?.close();
});

describe('T6 榜单上报开关：GET /leaderboard 可见性过滤', () => {
  it('默认（leaderboardVisible 未设）上榜：capability 与 behavior 榜都出现', async () => {
    await seedScoredAgent({ id: 'ag-def', name: 'default-visible-agent', score: 800 });
    const res = await app.inject({ method: 'GET', url: '/leaderboard' });
    expect(res.statusCode).toBe(200);
    const cap = res.json() as Array<{ agentId: string }>;
    expect(cap.find((r) => r.agentId === 'ag-def')).toBeDefined();
  });

  it('opt-out：leaderboardVisible=false 从 capability 榜消失', async () => {
    await seedScoredAgent({
      id: 'ag-hidden',
      name: 'hidden-agent',
      score: 900,
      leaderboardVisible: false,
    });
    const res = await app.inject({ method: 'GET', url: '/leaderboard?board=capability' });
    const rows = res.json() as Array<{ agentId: string }>;
    expect(rows.find((r) => r.agentId === 'ag-hidden')).toBeUndefined();
  });

  it('行为榜资格同口径：酒馆 agent 只有 real 交易证据（无 real-benchmark）+ 考场分≥400 也可上榜（2026-09-10 与 arenaQueue gate 同步放宽）', async () => {
    const id = 'ag-real-trade-arena';
    await seedScoredAgent({ id, name: 'real-trade-arena-agent', score: 800 });
    await db.insert(evidence).values([
      { id: `ev-${id}-arena`, agentId: id, dimension: 'delivery', source: 'arena', result: 'success' },
      { id: `ev-${id}-trade`, agentId: id, dimension: 'delivery', source: 'real', sourceType: 'real', issuer: 'tavern-market', result: 'success' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/leaderboard?board=behavior' });
    const rows = res.json() as Array<{ agentId: string }>;
    expect(rows.find((r) => r.agentId === id)).toBeDefined();
  });

  it('一开关管两榜：opt-out agent 满足行为榜资格也进不了 behavior 榜', async () => {
    // 行为榜资格：arena 证据 + real-benchmark 证据 + 考场分 ≥ ARENA_GATE_SCORE(400)
    const id = 'ag-hidden-arena';
    await seedScoredAgent({
      id,
      name: 'hidden-arena-agent',
      score: 800,
      leaderboardVisible: false,
    });
    await db.insert(evidence).values([
      { id: `ev-${id}-arena`, agentId: id, dimension: 'delivery', source: 'arena', result: 'success' },
      {
        id: `ev-${id}-bench`,
        agentId: id,
        dimension: 'capability',
        source: 'real-benchmark',
        result: 'success',
      },
    ]);
    const res = await app.inject({ method: 'GET', url: '/leaderboard?board=behavior' });
    const rows = res.json() as Array<{ agentId: string }>;
    expect(rows.find((r) => r.agentId === id)).toBeUndefined();
  });

  it('opt-out 后详情页直链保留：/agents/:id、/score、/evidence 照常 200（unlisted 先例）', async () => {
    const detail = await app.inject({ method: 'GET', url: '/agents/ag-hidden' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: 'ag-hidden', leaderboardVisible: false });
    const score = await app.inject({ method: 'GET', url: '/agents/ag-hidden/score' });
    expect(score.statusCode).toBe(200);
    const ev = await app.inject({ method: 'GET', url: '/agents/ag-hidden/evidence' });
    expect(ev.statusCode).toBe(200);
  });

  it('≥3 单成交门槛：酒馆 agent settled=2 不上榜、settled=3 上榜（榜单1 双保险）', async () => {
    const refA = randomUUID();
    const refB = randomUUID();
    await seedScoredAgent({
      id: tavernExternalId(refA),
      name: '胖虾销售员·酒馆',
      pubkey: `tavern-agent-${refA}`,
      score: 850,
    });
    await seedScoredAgent({
      id: tavernExternalId(refB),
      name: '瘦蟹推销员·酒馆',
      pubkey: `tavern-agent-${refB}`,
      score: 860,
    });
    // A：2 单成交（差 1 单）；B：3 单成交（过门槛）
    await db.insert(evidence).values([
      settledEvidence(`se-${refA}-1`, tavernExternalId(refA)),
      settledEvidence(`se-${refA}-2`, tavernExternalId(refA)),
      settledEvidence(`se-${refB}-1`, tavernExternalId(refB)),
      settledEvidence(`se-${refB}-2`, tavernExternalId(refB)),
      settledEvidence(`se-${refB}-3`, tavernExternalId(refB)),
    ]);
    const res = await app.inject({ method: 'GET', url: '/leaderboard?board=capability' });
    const rows = res.json() as Array<{ agentId: string }>;
    expect(rows.find((r) => r.agentId === tavernExternalId(refA))).toBeUndefined();
    expect(rows.find((r) => r.agentId === tavernExternalId(refB))).toBeDefined();
  });

  it('门槛只打酒馆身份：SDK agent（真实 pubkey）0 单成交照常上榜（豁免，偏差记录）', async () => {
    await seedScoredAgent({ id: 'ag-sdk', name: 'sdk-agent', pubkey: 'pk-ed25519-real', score: 950 });
    const res = await app.inject({ method: 'GET', url: '/leaderboard?board=capability' });
    const rows = res.json() as Array<{ agentId: string }>;
    expect(rows.find((r) => r.agentId === 'ag-sdk')).toBeDefined();
  });
});

describe('T6：PATCH /agents/:id 注册后可改', () => {
  it('200 关→榜上消失；开→回榜；值持久化', async () => {
    await seedScoredAgent({ id: 'ag-toggle', name: 'toggle-agent', score: 700 });
    const off = await app.inject({
      method: 'PATCH',
      url: '/agents/ag-toggle',
      payload: { leaderboardVisible: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ id: 'ag-toggle', leaderboardVisible: false });
    let rows = (await app.inject({ method: 'GET', url: '/leaderboard' })).json() as Array<{
      agentId: string;
    }>;
    expect(rows.find((r) => r.agentId === 'ag-toggle')).toBeUndefined();

    const on = await app.inject({
      method: 'PATCH',
      url: '/agents/ag-toggle',
      payload: { leaderboardVisible: true },
    });
    expect(on.statusCode).toBe(200);
    rows = (await app.inject({ method: 'GET', url: '/leaderboard' })).json();
    expect(rows.find((r) => r.agentId === 'ag-toggle')).toBeDefined();
  });

  it('400：body 非法（缺字段 / 非布尔 / 多余字段）', async () => {
    expect(
      (await app.inject({ method: 'PATCH', url: '/agents/ag-toggle', payload: {} })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/agents/ag-toggle',
          payload: { leaderboardVisible: 'yes' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/agents/ag-toggle',
          payload: { leaderboardVisible: true, name: 'hack' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('404：agent 不存在', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/ag-nonexistent',
      payload: { leaderboardVisible: false },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('T6：POST /agents 注册时可选传 leaderboardVisible', () => {
  it('注册带 false → 落库 false；省略 → 默认 true；非布尔 → 400', async () => {
    const off = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'reg-hidden-agent', leaderboardVisible: false },
    });
    expect(off.statusCode).toBe(201);
    expect(off.json().leaderboardVisible).toBe(false);

    const def = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'reg-default-agent' },
    });
    expect(def.statusCode).toBe(201);
    expect(def.json().leaderboardVisible).toBe(true);

    const bad = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'reg-bad-agent', leaderboardVisible: 'no' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('T6：POST /ingest/agent-visibility（酒馆服务端同步，bearer 机构级）', () => {
  const call = (payload: unknown, token: string | null = INGEST_TOKEN) =>
    app.inject({
      method: 'POST',
      url: '/ingest/agent-visibility',
      headers: token !== null ? { authorization: `Bearer ${token}` } : {},
      payload: payload as Record<string, unknown>,
    });

  it('401：无 bearer / 错 token；服务端未配置凭证 → 全部 401', async () => {
    const body = { source: 'tavern', agents: [{ ref: randomUUID(), name: 'x', leaderboardVisible: false }] };
    expect((await call(body, null)).statusCode).toBe(401);
    expect((await call(body, 'wrong-token')).statusCode).toBe(401);
    const prev = process.env.ACL_TRADE_INGEST_TOKEN;
    delete process.env.ACL_TRADE_INGEST_TOKEN;
    expect((await call(body)).statusCode).toBe(401);
    process.env.ACL_TRADE_INGEST_TOKEN = prev;
  });

  it('400：body 非法（source 错 / agents 空 / 超 100 / 字段缺失）', async () => {
    expect(
      (
        await call({
          source: 'not-tavern',
          agents: [{ ref: randomUUID(), name: 'x', leaderboardVisible: false }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await call({ source: 'tavern', agents: [] })).statusCode).toBe(400);
    expect(
      (
        await call({
          source: 'tavern',
          agents: Array.from({ length: 101 }, () => ({
            ref: randomUUID(),
            name: 'x',
            leaderboardVisible: true,
          })),
        })
      ).statusCode,
    ).toBe(400);
    expect((await call({ source: 'tavern', agents: [{ ref: randomUUID() }] })).statusCode).toBe(400);
  });

  it('随注册传 ACL：未知 ref → 建号（确定性 id + 伪 pubkey + basic）并落可见性', async () => {
    const ref = randomUUID();
    const res = await call({
      source: 'tavern',
      agents: [{ ref, name: '新注册海星', leaderboardVisible: false }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      results: [{ ref, agentId: tavernExternalId(ref), status: 'created' }],
    });
    const row = await app.inject({ method: 'GET', url: `/agents/${tavernExternalId(ref)}` });
    expect(row.json()).toMatchObject({
      id: tavernExternalId(ref),
      name: '新注册海星·酒馆',
      verificationLevel: 'basic',
      pubkey: `tavern-agent-${ref}`,
      leaderboardVisible: false,
    });
  });

  it('注册后可改：既有 ref → 只更新可见性（身份 id 永不变）', async () => {
    const ref = randomUUID();
    await call({ source: 'tavern', agents: [{ ref, name: '既有海星', leaderboardVisible: true }] });
    const res = await call({
      source: 'tavern',
      agents: [{ ref, name: '既有海星', leaderboardVisible: false }],
    });
    expect(res.json()).toEqual({
      results: [{ ref, agentId: tavernExternalId(ref), status: 'updated' }],
    });
    const row = await app.inject({ method: 'GET', url: `/agents/${tavernExternalId(ref)}` });
    expect(row.json()).toMatchObject({ leaderboardVisible: false });
  });

  it('撞名保旧名：返回 name-taken，持名者可见性不动（upsert 契约同语义）', async () => {
    // 持名者：普通 agent 占住展示名
    await db.insert(agents).values({ id: 'ag-name-holder', name: '被撞名·酒馆' });
    const ref = randomUUID();
    const res = await call({
      source: 'tavern',
      agents: [{ ref, name: '被撞名', leaderboardVisible: false }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      results: [{ ref, agentId: 'ag-name-holder', status: 'name-taken' }],
    });
    const holder = await app.inject({ method: 'GET', url: '/agents/ag-name-holder' });
    expect(holder.json()).toMatchObject({ leaderboardVisible: true }); // 默认值未被改动
  });

  it('幂等：同一批重放落库状态一致（首次建号，重放变更新，终态可见性一致）', async () => {
    const ref = randomUUID();
    const body = { source: 'tavern', agents: [{ ref, name: '幂等海星', leaderboardVisible: true }] };
    const first = await call(body);
    const second = await call(body);
    expect(first.json().results[0].status).toBe('created');
    expect(second.json().results[0]).toEqual({ ref, agentId: tavernExternalId(ref), status: 'updated' });
    const row = await app.inject({ method: 'GET', url: `/agents/${tavernExternalId(ref)}` });
    expect(row.json()).toMatchObject({ leaderboardVisible: true });
  });
});

describe('T6：/stats/summary 参与数同步吃可见性过滤', () => {
  it('opt-out agent 不计入榜单1/榜单2 参与数', async () => {
    // 本文件前面用例已库内累积 agent：统计口径断言需要净库
    await db.execute(
      sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces, credit_scores, score_snapshots, evidence CASCADE`,
    );
    const hidden = 'ag-stats-hidden';
    const visible = 'ag-stats-visible';
    await seedScoredAgent({ id: hidden, name: 'stats-hidden', score: 700, leaderboardVisible: false });
    await seedScoredAgent({ id: visible, name: 'stats-visible', score: 700 });
    await db.insert(arenaSessions).values([
      { id: `as-${hidden}`, scenario: '标准交易', buyerAgentId: hidden, sellerAgentId: visible },
      { id: `as-${visible}-2`, scenario: '标准交易', buyerAgentId: visible, sellerAgentId: null },
    ]);
    const res = await app.inject({ method: 'GET', url: '/stats/summary' });
    const body = res.json() as { leaderboard1Participants: number; leaderboard2Participants: number };
    expect(body.leaderboard1Participants).toBe(1); // 只有 visible
    expect(body.leaderboard2Participants).toBe(1); // 只有 visible
  });
});
