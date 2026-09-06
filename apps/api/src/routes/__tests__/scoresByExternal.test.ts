/**
 * POST /agents/scores-by-external — 批量公开读（S4-B M2 批 2，plan §Task 11）。
 *
 * 覆盖（plan 四断言）：①refs>100 / body 脏 → 400；②已知 externalId →
 * {externalId, agentId, name, score, adjustedScore, confidence, badgeUrl}；
 * ③未知 ref → null 占位（数组序保持）；④限流 60/min/IP → 429。
 *
 * 契约锚点：
 * - externalId ≡ agents.id（T8 身份映射：酒馆 agent 主键即 ext-tavern-*，
 *   无独立 externalId 列，plan「inArray 查 agents.externalId」按此落点）；
 * - badgeUrl 为根相对路径 /credit/api/badge/{agentId}.svg（badge.ts 头注释的
 *   公开嵌入格式，酒馆 web 同域 <img> 直接可用）；
 * - 响应包装 { results: (对象|null)[] }，序与 refs 严格一致。
 *
 * 红线：测试库只用 TEST_DATABASE_URL（acl_test），生产库零接触。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { creditScores } from '../../db/schema';
import { upsertTavernAgent, tavernExternalId } from '../../services/tavernIdentity';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

const REF_A = 'ref-t11-agent-a';
const REF_B = 'ref-t11-agent-b';
const UNKNOWN = 'ref-t11-ghost';

function post(payload: unknown, ip?: string) {
  return app.inject({
    method: 'POST',
    url: '/agents/scores-by-external',
    payload: payload as Record<string, unknown>,
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
  // 两个酒馆 agent（走 T8 upsert 语义）+ A 挂一条评分（B 已知但未评分）
  const a = await upsertTavernAgent(db, REF_A, 'AgentA');
  await upsertTavernAgent(db, REF_B, 'AgentB');
  await db.insert(creditScores).values({
    id: 'cs-t11-a',
    agentId: a.agentId,
    score: 640,
    adjustedScore: 420,
    confidence: 0.42,
    modelVersion: 'baseline-v0.1',
    evidenceRefs: ['e1', 'e2'],
  });
});

afterAll(async () => {
  await app?.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('POST /agents/scores-by-external', () => {
  it('①body 校验：refs 缺失/非数组/含非字符串/超 100 → 400；source≠tavern → 400', async () => {
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ source: 'tavern', refs: 'nope' })).statusCode).toBe(400);
    expect((await post({ source: 'tavern', refs: [123] })).statusCode).toBe(400);
    expect(
      (await post({ source: 'tavern', refs: Array.from({ length: 101 }, () => UNKNOWN) }))
        .statusCode,
    ).toBe(400);
    expect((await post({ source: 'elsewhere', refs: [UNKNOWN] })).statusCode).toBe(400);
  });

  it('②refs 恰 100（边界）→ 200，未知 ref 全 null', async () => {
    const res = await post({ source: 'tavern', refs: Array.from({ length: 100 }, () => UNKNOWN) });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as { results: unknown[] };
    expect(results).toHaveLength(100);
    expect(results.every((r) => r === null)).toBe(true);
  });

  it('③已知 externalId → 完整对象（join latest scores + badgeUrl）', async () => {
    const extA = tavernExternalId(REF_A);
    const res = await post({ source: 'tavern', refs: [extA] });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as { results: Array<Record<string, unknown>> };
    expect(results).toEqual([
      {
        externalId: extA,
        agentId: extA,
        name: 'AgentA·酒馆',
        score: 640,
        adjustedScore: 420,
        confidence: expect.closeTo(0.42, 5),
        badgeUrl: `/credit/api/badge/${extA}.svg`,
      },
    ]);
  });

  it('④未知 ref → null 占位，数组序保持；已知未评分 agent → score/confidence null + badgeUrl 仍在', async () => {
    const extA = tavernExternalId(REF_A);
    const extB = tavernExternalId(REF_B);
    const res = await post({ source: 'tavern', refs: [extA, UNKNOWN, extB, UNKNOWN] });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as { results: Array<Record<string, unknown> | null> };
    expect(results).toHaveLength(4);
    expect(results[0]).toMatchObject({ externalId: extA, agentId: extA, score: 640 });
    expect(results[1]).toBeNull();
    expect(results[2]).toMatchObject({
      externalId: extB,
      name: 'AgentB·酒馆',
      score: null,
      adjustedScore: null,
      confidence: null,
      badgeUrl: `/credit/api/badge/${extB}.svg`,
    });
    expect(results[3]).toBeNull();
  });

  it('⑤限流 60/min/IP → 第 61 次 429（per-IP 桶，他 IP 不受影响）', async () => {
    const extA = tavernExternalId(REF_A);
    for (let i = 0; i < 60; i++) {
      expect((await post({ source: 'tavern', refs: [extA] }, '10.77.0.1')).statusCode).toBe(200);
    }
    expect((await post({ source: 'tavern', refs: [extA] }, '10.77.0.1')).statusCode).toBe(429);
    expect((await post({ source: 'tavern', refs: [extA] }, '10.77.0.2')).statusCode).toBe(200);
  });

  it('⑥空 refs → 200 {results:[]}（契约行兜底：空数组是合法边界，非 400。T11-12 评审 Minor M1）', async () => {
    const res = await post({ source: 'tavern', refs: [] });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { results: unknown[] }).results).toEqual([]);
  });

  // ── 2026-09-06 裁决兜底（方案乙，T17 E2E 联调缺口）：tavern source 传酒馆
  // 原始 uuid（agentRef）→ 字面未命中时按 tavernExternalId 推导再查。──
  it('⑦[兜底] tavern 传酒馆原始 uuid → 推导命中（externalId 回显 agents.id，分数完整）', async () => {
    const extA = tavernExternalId(REF_A);
    const res = await post({ source: 'tavern', refs: [REF_A] });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as { results: Array<Record<string, unknown> | null> };
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      externalId: extA,
      agentId: extA,
      name: 'AgentA·酒馆',
      score: 640,
      adjustedScore: 420,
      badgeUrl: `/credit/api/badge/${extA}.svg`,
    });
  });

  it('⑧[兜底] 混合批量：推导值字面命中 + 原始 uuid 推导命中 + 未知 → null（序一致，不交叉污染）', async () => {
    const extA = tavernExternalId(REF_A);
    const res = await post({ source: 'tavern', refs: [extA, REF_A, 'ref-never-exists-zz'] });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as { results: Array<Record<string, unknown> | null> };
    expect(results[0]).toMatchObject({ externalId: extA, score: 640 });
    expect(results[1]).toMatchObject({ externalId: extA, score: 640 });
    expect(results[2]).toBeNull();
  });

  it('⑨[兜底回归] 未知 uuid 推导后仍未命中 → null（②④语义不变）', async () => {
    const res = await post({ source: 'tavern', refs: ['ref-ghost-never-was'] });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { results: Array<null> }).results).toEqual([null]);
  });

  // 非 tavern source 不推导：「永不推导」由 schema z.literal 门保证（400，强于 null 语义）；
  // 路由内 source 守卫为将来放宽 schema 时的防御，行为不变。
  it('⑩[兜底边界] 非 tavern source 传 uuid → 400（schema 门拒，不进入推导）', async () => {
    expect((await post({ source: 'elsewhere', refs: [REF_A] })).statusCode).toBe(400);
  });
});
