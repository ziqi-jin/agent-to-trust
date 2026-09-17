/**
 * POST /ingest/trade-evidence 路由（S4-B M2 批 1，plan §Task 10）。
 *
 * 覆盖（plan 五断言 + T9-10 评审补强）：①无/错 bearer → 401（env 缺失/空 = 全部 401）
 * ②evidenceSchemaVersion<1 或 reporter≠'tavern-market' → 400 ③events>100 → 400
 * ④正常 → 200 {accepted,duplicates,rejected} ⑤duplicates-only 批不触发重算
 * ⑥限流 120 批/10min → 429。
 *
 * 骨架照 routes/ingest.ts（内存桶限流模式复用，ingest.ts 本体零改动）。
 * 红线：测试库只用 TEST_DATABASE_URL（acl_test），生产库零接触。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { tavernExternalId } from '../../services/tavernIdentity';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

const TOKEN = 'test-trade-token-123';
const HDR = { authorization: `Bearer ${TOKEN}` };
const HASH_A = 'a'.repeat(64);

let app: FastifyInstance;
let db: Database;
let savedToken: string | undefined;

function post(payload: unknown, headers: Record<string, string> = HDR) {
  return app.inject({
    method: 'POST',
    url: '/ingest/trade-evidence',
    payload: payload as Record<string, unknown>,
    headers,
  });
}

function ev(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    agentRef: 'ref-t10-agent-a',
    agentName: 'AgentA',
    orderRef: 'order-t10-1',
    type: 'delivered',
    occurredAt: '2026-09-06T00:00:00.000Z',
    payloadHash: HASH_A,
    ...overrides,
  };
}

function envelope(events: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    reporter: 'tavern-market',
    reporterVersion: '1.0.0',
    evidenceSchemaVersion: 1,
    events,
    ...overrides,
  };
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  savedToken = process.env.A2T_TRADE_INGEST_TOKEN;
  process.env.A2T_TRADE_INGEST_TOKEN = TOKEN;
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
});

afterAll(async () => {
  process.env.A2T_TRADE_INGEST_TOKEN = savedToken;
  await app.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('POST /ingest/trade-evidence', () => {
  it('①无/错 bearer → 401；env 缺失/空 = 全部 401（timing-safe 边界）', async () => {
    // 无 header
    expect((await post(envelope([ev()]), {})).statusCode).toBe(401);
    // 非 Bearer scheme
    expect(
      (await post(envelope([ev()]), { authorization: `Basic ${TOKEN}` })).statusCode,
    ).toBe(401);
    // 错 token
    expect((await post(envelope([ev()]), { authorization: 'Bearer wrong' })).statusCode).toBe(401);
    // env 缺失
    delete process.env.A2T_TRADE_INGEST_TOKEN;
    expect((await post(envelope([ev()]))).statusCode).toBe(401);
    // env 空串
    process.env.A2T_TRADE_INGEST_TOKEN = '';
    expect((await post(envelope([ev()]))).statusCode).toBe(401);
    // 恢复
    process.env.A2T_TRADE_INGEST_TOKEN = TOKEN;
    expect((await post(envelope([ev()]))).statusCode).toBe(200);
  });

  it('②evidenceSchemaVersion<1 或 reporter≠tavern-market → 400', async () => {
    const badVersion = await post(envelope([ev()], { evidenceSchemaVersion: 0 }));
    expect(badVersion.statusCode).toBe(400);
    const badVersionFloat = await post(envelope([ev()], { evidenceSchemaVersion: 1.5 }));
    expect(badVersionFloat.statusCode).toBe(400);
    const badReporter = await post(envelope([ev()], { reporter: 'someone-else' }));
    expect(badReporter.statusCode).toBe(400);
  });

  it('③events>100 → 400', async () => {
    const res = await post(envelope(Array.from({ length: 101 }, () => ({}))));
    expect(res.statusCode).toBe(400);
    // 边界：恰好 100 个事件不应在信封层被拒（内容留给服务层毒丸）
    const edge = await post(envelope(Array.from({ length: 100 }, () => ({}))));
    expect(edge.statusCode).toBe(200);
  });

  it('④正常 → 200 {accepted,duplicates,rejected}，agent/evidence/评分落库', async () => {
    const ref = 'ref-t10-agent-a';
    const res = await post(envelope([ev()]));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accepted: string[]; duplicates: string[]; rejected: unknown[] };
    expect(body).toEqual({
      accepted: ['11111111-1111-4111-8111-111111111111'],
      duplicates: [],
      rejected: [],
    });
    // 身份：upsertTavernAgent 语义（伪 pubkey / 展示名 / basic）
    const agent = await db.query.agents.findFirst({ where: sql`id = ${tavernExternalId(ref)}` });
    expect(agent?.pubkey).toBe(`tavern-agent-${ref}`);
    expect(agent?.name).toBe('AgentA·酒馆');
    expect(agent?.verificationLevel).toBe('basic');
    // 证据：source='real'、维度映射 delivered→delivery/success
    const row = await db.query.evidence.findFirst();
    expect(row?.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(row?.agentId).toBe(tavernExternalId(ref));
    expect(row?.source).toBe('real');
    expect(row?.issuer).toBe('tavern-market');
    expect(row?.dimension).toBe('delivery');
    expect(row?.result).toBe('success');
    // 评分重算已触发
    const score = await db.query.creditScores.findFirst();
    expect(score?.agentId).toBe(tavernExternalId(ref));
    // T9-10 评审补强：来源 sourceType 也必须为 'real'（与 source 双字段一致）
    expect(row?.sourceType).toBe('real');
  });

  it('⑤duplicates-only 批（全重复）→ 200 {accepted:[],duplicates}，不触发 computeAndPersist（无新评分行）', async () => {
    // 先正常摄入一次：accepted → 恰 1 条评分行
    const first = await post(envelope([ev()]));
    expect(first.statusCode).toBe(200);
    const rowsBefore = await db.query.creditScores.findMany();
    expect(rowsBefore).toHaveLength(1);
    // 同一批原样重放：全量落 duplicates → scored 集合为空 → 不得重算评分
    const replay = await post(envelope([ev()]));
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({
      accepted: [],
      duplicates: ['11111111-1111-4111-8111-111111111111'],
      rejected: [],
    });
    const rowsAfter = await db.query.creditScores.findMany();
    expect(rowsAfter).toHaveLength(rowsBefore.length);
  });

  it('⑥限流 120 批/10min → 429（内存桶，ingest.ts 同模式）', async () => {
    // 前面的用例已消耗部分桶额度；用合法 bearer + 空体（400 路径，无库写）打满桶
    let saw429 = false;
    for (let i = 0; i < 200; i++) {
      const res = await post({});
      if (res.statusCode === 429) {
        saw429 = true;
        break;
      }
      expect(res.statusCode).toBe(400);
    }
    expect(saw429).toBe(true);
    // 桶未重置前继续 429
    expect((await post(envelope([ev()]))).statusCode).toBe(429);
  });
});
