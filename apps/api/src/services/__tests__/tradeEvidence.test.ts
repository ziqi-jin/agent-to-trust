/**
 * tradeEvidence — 酒馆交易证据摄入服务（S4-B M2 批 1，plan §Task 9）。
 *
 * 覆盖：五维映射（signature_invalid→integrity 毒丸覆盖默认 reliability）；
 * 契约 fixture（docs/fixtures/trade-evidence-v1.json，与酒馆仓同内容，漂移即红）；
 * 信封脏 throw（路由转 400）；单事件 zod fail → rejected[] 好事件照收（毒丸）；
 * 重复 id → duplicates 不重复入库（onConflictDoNothing）；
 * accepted 落库后按 agentRef 去重调 computeAndPersist。
 *
 * 红线：测试库只用 TEST_DATABASE_URL（acl_test），生产库零接触。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { tavernExternalId } from '../tavernIdentity';
import { computeAndPersist } from '../../routes/scores';
import { EnvelopeSchema, ingestTradeEvidence, mapEventToDimension } from '../tradeEvidence';

// 包装真实 computeAndPersist（评分数学零改动），只为断言"按 agentRef 去重调用"
vi.mock('../../routes/scores', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../routes/scores')>();
  return { ...mod, computeAndPersist: vi.fn(mod.computeAndPersist) };
});
const computeSpy = vi.mocked(computeAndPersist);

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

// 契约 fixture（spec §2.3）：docs/fixtures/trade-evidence-v1.json，两仓同内容，漂移即红
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../docs/fixtures/trade-evidence-v1.json',
);

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

let db: Database;

function ev(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    agentRef: 'ref-t9-agent-a',
    agentName: 'AgentA',
    orderRef: 'order-t9-1',
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
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
  computeSpy.mockClear();
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE agents CASCADE`);
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('mapEventToDimension（五维映射，服务端权威）', () => {
  it('delivered → {delivery, success}', () => {
    expect(mapEventToDimension('delivered')).toEqual({ dimension: 'delivery', outcome: 'success' });
  });

  it('confirmed → {economic, success}', () => {
    expect(mapEventToDimension('confirmed')).toEqual({ dimension: 'economic', outcome: 'success' });
  });

  it('rejected → {delivery, failure}', () => {
    expect(mapEventToDimension('rejected')).toEqual({ dimension: 'delivery', outcome: 'failure' });
  });

  it('delivery_failed（无 reason/timeout）→ {reliability, failure}（默认映射）', () => {
    expect(mapEventToDimension('delivery_failed')).toEqual({
      dimension: 'reliability',
      outcome: 'failure',
    });
    expect(mapEventToDimension('delivery_failed', 'timeout')).toEqual({
      dimension: 'reliability',
      outcome: 'failure',
    });
  });

  it('delivery_failed+signature_invalid → {integrity, failure}（毒丸：覆盖默认 reliability）', () => {
    expect(mapEventToDimension('delivery_failed', 'signature_invalid')).toEqual({
      dimension: 'integrity',
      outcome: 'failure',
    });
  });

  it('未知 type → null', () => {
    expect(mapEventToDimension('unknown' as never)).toBeNull();
  });
});

describe('EnvelopeSchema / 契约 fixture', () => {
  it('契约 fixture 解析通过且字段契约成立（两仓漂移即红）', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    const parsed = EnvelopeSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.reporter).toBe('tavern-market');
    expect(parsed.data.reporterVersion).toBe('1.0.0');
    expect(parsed.data.evidenceSchemaVersion).toBe(1);
    expect(parsed.data.events).toHaveLength(2);
    // delivered 无 reason 键（酒馆侧省略字段）
    expect('reason' in parsed.data.events[0]).toBe(false);
    expect(parsed.data.events[1]?.reason).toBe('signature_invalid');
    // fixture 两事件的映射契约
    expect(mapEventToDimension('delivered')).toEqual({ dimension: 'delivery', outcome: 'success' });
    expect(mapEventToDimension('delivery_failed', 'signature_invalid')).toEqual({
      dimension: 'integrity',
      outcome: 'failure',
    });
  });
});

describe('ingestTradeEvidence', () => {
  it('信封脏 → throw（路由转 400）：reporter 非法', async () => {
    await expect(
      ingestTradeEvidence(db, envelope([ev()], { reporter: 'someone-else' })),
    ).rejects.toThrow();
  });

  it('信封脏 → throw（路由转 400）：events > 100', async () => {
    await expect(
      ingestTradeEvidence(db, envelope(Array.from({ length: 101 }, () => ({})))),
    ).rejects.toThrow();
  });

  it('单事件 zod fail → rejected[]，好事件照收（毒丸不拒整批）', async () => {
    const good = ev({ id: '22222222-2222-4222-8222-222222222222', payloadHash: HASH_B });
    const bad = ev({ id: '33333333-3333-4333-8333-333333333333', payloadHash: 'not-hex' });
    const res = await ingestTradeEvidence(db, envelope([bad, good]));
    expect(res.accepted).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(res.duplicates).toEqual([]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]?.id).toBe('33333333-3333-4333-8333-333333333333');
    expect(res.rejected[0]?.error).toContain('payloadHash');
    // 只有好事件落库
    const rows = await db.query.evidence.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('重复 id → duplicates，不重复入库（幂等）', async () => {
    const env = envelope([ev(), ev({ id: '22222222-2222-4222-8222-222222222222' })]);
    const first = await ingestTradeEvidence(db, env);
    expect(first.accepted).toHaveLength(2);
    expect(first.duplicates).toEqual([]);
    const second = await ingestTradeEvidence(db, env);
    expect(second.accepted).toEqual([]);
    expect(second.duplicates).toHaveLength(2);
    const rows = await db.query.evidence.findMany();
    expect(rows).toHaveLength(2);
  });

  it('accepted 落库后按 agentRef 去重调 computeAndPersist；按 upsert 返回 id 落库', async () => {
    const refA = 'ref-t9-dedupe-a';
    const refB = 'ref-t9-dedupe-b';
    const env = envelope([
      ev({ id: '44444444-4444-4444-8444-444444444441', agentRef: refA, type: 'delivered' }),
      ev({ id: '44444444-4444-4444-8444-444444444442', agentRef: refA, type: 'confirmed' }),
      ev({ id: '44444444-4444-4444-8444-444444444443', agentRef: refB, agentName: 'AgentB', type: 'rejected' }),
    ]);
    const res = await ingestTradeEvidence(db, env);
    expect(res.accepted).toHaveLength(3);
    expect(res.rejected).toEqual([]);
    // 同 ref 两次事件只算一次评分；两个 ref → 共 2 次调用
    expect(computeSpy).toHaveBeenCalledTimes(2);
    const calledAgentIds = computeSpy.mock.calls.map((c) => c[1]);
    expect(calledAgentIds).toContain(tavernExternalId(refA));
    expect(calledAgentIds).toContain(tavernExternalId(refB));
    // 落库：source='real'、维度按映射、agentId = tavernExternalId(ref)
    const rowA = await db.query.evidence.findFirst({
      where: sql`id = '44444444-4444-4444-8444-444444444442'`,
    });
    expect(rowA?.dimension).toBe('economic');
    expect(rowA?.result).toBe('success');
    expect(rowA?.source).toBe('real');
    expect(rowA?.issuer).toBe('tavern-market');
    expect(rowA?.agentId).toBe(tavernExternalId(refA));
    const rowB = await db.query.evidence.findFirst({
      where: sql`id = '44444444-4444-4444-8444-444444444443'`,
    });
    expect(rowB?.dimension).toBe('delivery');
    expect(rowB?.result).toBe('failure');
    // 评分真实落库（mock 包装的是真实现）
    const scores = await db.query.creditScores.findMany();
    expect(scores.map((s) => s.agentId).sort()).toEqual(
      [tavernExternalId(refA), tavernExternalId(refB)].sort(),
    );
  });
});
