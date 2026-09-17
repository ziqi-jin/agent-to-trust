/**
 * Task 9 集成测试：arena 结算证据 `source_type` 三档口径（正交两轴映射）。
 *
 * 真相表（spec §4.3）：
 *   scripted            + 任意 adapter      → arena-behavior
 *   live                + adapter='a2a'     → arena-behavior-a2a
 *   live                + 其他（polling/null/undefined）→ arena-behavior-live（向后兼容）
 *
 * 断言直接读 evidence 表（不 mock）。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ensureKeypair } from 'a2t-sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { arenaEvents, arenaSessions, evidence } from '../../db/schema';
import { settleSession, sourceTypeFor } from '../../services/arenaSettle';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');
if (TEST_URL.includes('://acl:acl@localhost:5432/acl') && !TEST_URL.includes('acl_test')) {
  throw new Error('拒绝在非 acl_test 库上跑 arenaSettle a2a 测试（生产库会被 TRUNCATE）');
}

let app: FastifyInstance;
let db: Database;
let dirs: string[];
const savedKey = process.env.DEEPSEEK_API_KEY;

beforeAll(async () => {
  // 结算不应触发真实 LLM：显式清 key。
  delete process.env.DEEPSEEK_API_KEY;
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  const platformDir = mkdtempSync(join(tmpdir(), 't9-platform-'));
  process.env.PLATFORM_KEY_DIR = platformDir;
  dirs = [platformDir];
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
});

afterAll(() => {
  delete process.env.PLATFORM_KEY_DIR;
  if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = savedKey;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
});

async function registerAgent(name: string, pubkey: string): Promise<string> {
  const reg = await app.inject({ method: 'POST', url: '/arena/register', payload: { name, pubkey } });
  expect(reg.statusCode).toBe(201);
  return reg.json().agentId as string;
}

/** 建一局：卖家/买家 agent + 会话（给定 counterpartMode/adapter）+ 一个 pass VERIFY_RESULT。 */
async function seedSession(opts: {
  counterpartMode: string;
  adapter?: string | null;
}): Promise<{ sessionId: string; buyerAgentId: string; sellerAgentId: string }> {
  const buyerDir = mkdtempSync(join(tmpdir(), 't9-buyer-'));
  const sellerDir = mkdtempSync(join(tmpdir(), 't9-seller-'));
  dirs.push(buyerDir, sellerDir);
  const buyerAgentId = await registerAgent(`t9-b-${randomUUID().slice(0, 6)}`, ensureKeypair(buyerDir).publicKeyPem);
  const sellerAgentId = await registerAgent(`t9-s-${randomUUID().slice(0, 6)}`, ensureKeypair(sellerDir).publicKeyPem);

  const sessionId = `as-t9-${randomUUID().slice(0, 8)}`;
  await db.insert(arenaSessions).values({
    id: sessionId,
    scenario: '标准交易',
    status: 'negotiating',
    buyerAgentId,
    sellerAgentId,
    counterpartMode: opts.counterpartMode,
    // adapter 为 null/undefined 时省略，走 DB 默认值 'polling'（列 notNull）。
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
  });
  await db.insert(arenaEvents).values({
    id: `ae-${randomUUID()}`,
    sessionId,
    seq: 1,
    type: 'VERIFY_RESULT',
    fromAgent: buyerAgentId,
    payload: { verdict: 'pass', onTime: true },
    sig: 'test',
    nonce: `t9-nonce-${randomUUID()}`,
    ts: new Date(),
  });
  return { sessionId, buyerAgentId, sellerAgentId };
}

describe('Task 9 — sourceTypeFor 纯函数（三档正交两轴）', () => {
  it("scripted + adapter='a2a' → arena-behavior（scripted 优先）", () => {
    expect(sourceTypeFor('scripted', 'a2a')).toBe('arena-behavior');
  });
  it("scripted + adapter=null → arena-behavior", () => {
    expect(sourceTypeFor('scripted', null)).toBe('arena-behavior');
  });
  it("live + adapter='a2a' → arena-behavior-a2a", () => {
    expect(sourceTypeFor('live', 'a2a')).toBe('arena-behavior-a2a');
  });
  it("live + adapter='polling' → arena-behavior-live（回归守卫）", () => {
    expect(sourceTypeFor('live', 'polling')).toBe('arena-behavior-live');
  });
  it('live + adapter=null/undefined → arena-behavior-live（向后兼容）', () => {
    expect(sourceTypeFor('live', null)).toBe('arena-behavior-live');
    expect(sourceTypeFor('live', undefined)).toBe('arena-behavior-live');
  });
  it('counterpartMode=null → 视为非 live → arena-behavior', () => {
    expect(sourceTypeFor(null, 'a2a')).toBe('arena-behavior');
    expect(sourceTypeFor(null, null)).toBe('arena-behavior');
  });
});

describe('Task 9 — settleSession 证据 source_type 三档（直读 evidence 表）', () => {
  it("1. scripted + adapter='a2a' → 证据 source_type='arena-behavior'", async () => {
    const { sessionId, sellerAgentId, buyerAgentId } = await seedSession({ counterpartMode: 'scripted', adapter: 'a2a' });
    await settleSession(app, sessionId, 1);
    const rows = await db
      .select()
      .from(evidence)
      .where(eq(evidence.evidenceUri, `a2t://arena/${sessionId}`));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.sourceType).toBe('arena-behavior');
    expect(rows.some((r) => r.agentId === sellerAgentId)).toBe(true);
    expect(rows.some((r) => r.agentId === buyerAgentId)).toBe(true);
  });

  it('2. scripted + adapter 缺省（null）→ 证据 source_type=\'arena-behavior\'', async () => {
    const { sessionId } = await seedSession({ counterpartMode: 'scripted', adapter: null });
    await settleSession(app, sessionId, 1);
    const rows = await db.select().from(evidence).where(eq(evidence.evidenceUri, `a2t://arena/${sessionId}`));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.sourceType).toBe('arena-behavior');
  });

  it("3. live + adapter='a2a' → 证据 source_type='arena-behavior-a2a'", async () => {
    const { sessionId } = await seedSession({ counterpartMode: 'live', adapter: 'a2a' });
    await settleSession(app, sessionId, 1);
    const rows = await db.select().from(evidence).where(eq(evidence.evidenceUri, `a2t://arena/${sessionId}`));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.sourceType).toBe('arena-behavior-a2a');
  });

  it("4. live + adapter='polling' → 证据 source_type='arena-behavior-live'（回归守卫）", async () => {
    const { sessionId } = await seedSession({ counterpartMode: 'live', adapter: 'polling' });
    await settleSession(app, sessionId, 1);
    const rows = await db.select().from(evidence).where(eq(evidence.evidenceUri, `a2t://arena/${sessionId}`));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.sourceType).toBe('arena-behavior-live');
  });

  it('5. live + adapter 缺省（DB 默认 polling）→ 证据 source_type=\'arena-behavior-live\'（向后兼容）', async () => {
    const { sessionId } = await seedSession({ counterpartMode: 'live', adapter: null });
    await settleSession(app, sessionId, 1);
    const rows = await db.select().from(evidence).where(eq(evidence.evidenceUri, `a2t://arena/${sessionId}`));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.sourceType).toBe('arena-behavior-live');
  });

  it('6. 卖家（delivery）与买家（reliability）两行同口径携带映射后的 source_type', async () => {
    const { sessionId, sellerAgentId, buyerAgentId } = await seedSession({ counterpartMode: 'live', adapter: 'a2a' });
    await settleSession(app, sessionId, 1);
    const rows = await db.select().from(evidence).where(eq(evidence.evidenceUri, `a2t://arena/${sessionId}`));
    const seller = rows.find((r) => r.agentId === sellerAgentId);
    const buyer = rows.find((r) => r.agentId === buyerAgentId);
    expect(seller, '卖家证据缺失').toBeDefined();
    expect(buyer, '买家证据缺失').toBeDefined();
    expect(seller!.dimension).toBe('delivery');
    expect(buyer!.dimension).toBe('reliability');
    expect(seller!.sourceType).toBe('arena-behavior-a2a');
    expect(buyer!.sourceType).toBe('arena-behavior-a2a');
  });
});
