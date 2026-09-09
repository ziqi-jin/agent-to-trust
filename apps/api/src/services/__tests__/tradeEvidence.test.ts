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
    expect(parsed.data.events).toHaveLength(3);
    // delivered 无 reason 键（酒馆侧省略字段）
    expect('reason' in parsed.data.events[0]).toBe(false);
    expect(parsed.data.events[1]?.reason).toBe('signature_invalid');
    // S5-T3：第 3 事件 = confirmed + settled 谈判轨迹（A3 完整面契约）
    const third = parsed.data.events[2]!;
    expect(third.type).toBe('confirmed');
    expect(third.negotiation).toEqual({
      rounds: 3,
      outcome: 'settled',
      initialPrice: 12,
      finalPrice: 11,
      responseMsP50: 45000,
      concessionPattern: '12→10→11',
    });
    expect('confidential' in third).toBe(false);
    // fixture 映射契约
    expect(mapEventToDimension('delivered')).toEqual({ dimension: 'delivery', outcome: 'success' });
    expect(mapEventToDimension('delivery_failed', 'signature_invalid')).toEqual({
      dimension: 'integrity',
      outcome: 'failure',
    });
    // confirmed + 轨迹：主行仍 economic，negotiation 由派生行承担（S5-T3）
    expect(mapEventToDimension('confirmed')).toEqual({ dimension: 'economic', outcome: 'success' });
    expect(mapEventToDimension('confirmed', undefined, third.negotiation)).toEqual({
      dimension: 'economic',
      outcome: 'success',
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

// ── S5-T3：negotiation 实战证据接入（spec A3/A4/B3/B4）──
//
// A4 信用映射落点：
// - 达成（confirmed + 轨迹 outcome=settled）→ negotiation/success（派生行，economic 主行不变）
// - 流拍（rejected 带轨迹 / negotiation_expired）→ negotiation/partial 只记录不重罚
//   （谈判破裂是正常市场行为，不再按 delivery/failure 重罚）；虚假报价/接受后拒履约
//   仍由 delivery_failed → reliability/integrity 现有映射扣分，本批不新增惩罚路径。
// B3 降权落点：confidential 单全部证据 source='real-confidential'（SOURCE_WEIGHTS=0.5）。
// B4 聚合面：confidential 单 negotiation 只含 rounds/outcome（承诺哈希在事件顶层），
// ACL 库不落金额/让步序列——payloadHash 之外本就零明细。
describe('S5-T3 negotiation 实战证据接入', () => {
  const TRAJ = {
    rounds: 3,
    outcome: 'settled',
    initialPrice: 12,
    finalPrice: 11,
    responseMsP50: 45000,
    concessionPattern: '12→10→11',
  } as const;

  it('mapEventToDimension：rejected 带轨迹 → {negotiation, partial}（流拍不重罚）；无轨迹维持 delivery/failure', () => {
    expect(mapEventToDimension('rejected', undefined, TRAJ)).toEqual({
      dimension: 'negotiation',
      outcome: 'partial',
    });
    expect(mapEventToDimension('rejected')).toEqual({ dimension: 'delivery', outcome: 'failure' });
  });

  it('mapEventToDimension：negotiation_expired → {negotiation, partial}（offer 72h 死局只记录）', () => {
    expect(mapEventToDimension('negotiation_expired')).toEqual({
      dimension: 'negotiation',
      outcome: 'partial',
    });
  });

  it('契约 fixture 第 3 事件：confirmed + settled 轨迹解析通过（两仓漂移即红）', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    const parsed = EnvelopeSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.events).toHaveLength(3);
    const third = parsed.data.events[2]!;
    expect(third.type).toBe('confirmed');
    expect(third.negotiation).toEqual(TRAJ);
    expect('confidential' in third).toBe(false);
  });

  it('confirmed + 轨迹 → 主行 economic/success + 派生行 negotiation/success（id 带 #negotiation 后缀）', async () => {
    const res = await ingestTradeEvidence(
      db,
      envelope([
        ev({ id: '55555555-5555-4555-8555-555555555551', type: 'confirmed', negotiation: TRAJ }),
      ]),
    );
    expect(res.accepted).toEqual(['55555555-5555-4555-8555-555555555551']);
    expect(res.rejected).toEqual([]);
    const rows = await db.query.evidence.findMany();
    expect(rows).toHaveLength(2);
    const main = rows.find((r) => r.id === '55555555-5555-4555-8555-555555555551');
    const derived = rows.find((r) => r.id === '55555555-5555-4555-8555-555555555551#negotiation');
    expect(main?.dimension).toBe('economic');
    expect(main?.result).toBe('success');
    expect(main?.source).toBe('real');
    expect(derived?.dimension).toBe('negotiation');
    expect(derived?.result).toBe('success');
    expect(derived?.source).toBe('real');
    expect(derived?.issuer).toBe('tavern-market');
    // 评分真实重算（mock 包装真实现）
    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it('rejected + 轨迹 / negotiation_expired → 单行 negotiation/partial（流拍只记录不重罚）', async () => {
    await ingestTradeEvidence(
      db,
      envelope([
        ev({
          id: '55555555-5555-4555-8555-555555555552',
          type: 'rejected',
          negotiation: { ...TRAJ, outcome: 'rejected' },
        }),
        ev({
          id: '55555555-5555-4555-8555-555555555553',
          type: 'negotiation_expired',
          negotiation: { ...TRAJ, outcome: 'expired' },
        }),
      ]),
    );
    const rows = await db.query.evidence.findMany();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.dimension).toBe('negotiation');
      expect(row.result).toBe('partial');
      expect(row.source).toBe('real');
    }
    expect(rows.find((r) => r.id?.endsWith('#negotiation'))).toBeUndefined();
  });

  it('confidential 单：全部证据 source=real-confidential（B3 降权 0.5）；聚合面（无明细）解析通过', async () => {
    const res = await ingestTradeEvidence(
      db,
      envelope([
        ev({
          id: '55555555-5555-4555-8555-555555555554',
          type: 'confirmed',
          confidential: true,
          commitmentHash: 'sha256-commit-hash',
          negotiation: { rounds: 2, outcome: 'settled' }, // B4 聚合面：无金额/序列
        }),
        ev({
          id: '55555555-5555-4555-8555-555555555555',
          type: 'delivered',
          confidential: true,
          commitmentHash: 'sha256-commit-hash',
        }),
      ]),
    );
    expect(res.accepted).toHaveLength(2);
    expect(res.rejected).toEqual([]);
    const rows = await db.query.evidence.findMany();
    expect(rows).toHaveLength(3); // confirmed 主行 + 派生行 + delivered
    for (const row of rows) {
      expect(row.source).toBe('real-confidential');
      expect(row.sourceType).toBe('real');
    }
    const derived = rows.find((r) => r.id === '55555555-5555-4555-8555-555555555554#negotiation');
    expect(derived?.dimension).toBe('negotiation');
    expect(derived?.result).toBe('success');
  });

  it('重复推送幂等：confirmed + 轨迹重推 → duplicates，仍只有 2 行（派生行不重复）', async () => {
    const env = envelope([
      ev({ id: '55555555-5555-4555-8555-555555555556', type: 'confirmed', negotiation: TRAJ }),
    ]);
    const first = await ingestTradeEvidence(db, env);
    expect(first.accepted).toHaveLength(1);
    const second = await ingestTradeEvidence(db, env);
    expect(second.accepted).toEqual([]);
    expect(second.duplicates).toEqual(['55555555-5555-4555-8555-555555555556']);
    expect(await db.query.evidence.findMany()).toHaveLength(2);
  });

  // 审计 B5【P2】：派生行此前只在主行本次 inserted 时才写。
  // 历史事件重推（主行已在库、派生行缺失）时，inserted.length === 0 → 派生行永远补不回。
  it('历史重推回补：主行已存在、派生行缺失 → 重推后派生行补回', async () => {
    const id = '55555555-5555-4555-8555-555555555558';
    // 第一次推送：confirmed 但无轨迹（模拟派生行功能上线前的历史事件）→ 只落主行
    const first = await ingestTradeEvidence(db, envelope([ev({ id, type: 'confirmed' })]));
    expect(first.accepted).toEqual([id]);
    let rows = await db.query.evidence.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);

    // 重推：同一事件带轨迹 → 主行冲突进 duplicates，但派生行必须补回
    const second = await ingestTradeEvidence(
      db,
      envelope([ev({ id, type: 'confirmed', negotiation: TRAJ })]),
    );
    expect(second.duplicates).toEqual([id]);
    rows = await db.query.evidence.findMany();
    expect(rows).toHaveLength(2);
    const derived = rows.find((r) => r.id === `${id}#negotiation`);
    expect(derived?.dimension).toBe('negotiation');
    expect(derived?.result).toBe('success');
    expect(derived?.source).toBe('real');
  });

  it('zod 非 strict 回归：事件带未知字段仍收下（T1 confidential 字段同理，打分只读白名单）', async () => {
    const res = await ingestTradeEvidence(
      db,
      envelope([ev({ id: '55555555-5555-4555-8555-555555555557', futureField: 'x' })]),
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected).toEqual([]);
  });
});
