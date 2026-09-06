/**
 * tavernIdentity — 酒馆 agent 身份映射（S4-B M2 批 1）。
 *
 * 酒馆（tavern 仓）交易证据将经 POST /ingest/trade-evidence 推入（端点后续任务建）。
 * 身份规则：identity = agentRef（伪 pubkey 'tavern-agent-<ref>' 承载），
 * agentId = ext-tavern-<slug8>-<hash8>（确定性，可离线推算）；
 * 展示名 = `${agentName}·酒馆`；verificationLevel 只用 'basic'（硬红线）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents } from '../../db/schema';
import { tavernExternalId, upsertTavernAgent } from '../tavernIdentity';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let db: Database;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE agents CASCADE`);
});

describe('tavernExternalId', () => {
  it('格式：ext-tavern-<slug8>-<hash8>，确定性可复现', () => {
    const ref = 'a1b2c3d4-e5f6-4a1b-8c9d-000000000001';
    const id = tavernExternalId(ref);
    expect(id).toMatch(/^ext-tavern-[0-9a-z]{1,8}-[0-9a-f]{8}$/);
    // slug = agentRef 去 uuid 连字符前 8 位
    expect(id.startsWith('ext-tavern-a1b2c3d4-')).toBe(true);
    // 确定性：同 ref 同 id
    expect(id).toBe(tavernExternalId(ref));
    // slug 全空兜底 'x'
    expect(tavernExternalId('---')).toMatch(/^ext-tavern-x-[0-9a-f]{8}$/);
  });
});

describe('upsertTavernAgent', () => {
  it('同 ref 两次 upsert → 同 agentId（幂等）', async () => {
    const first = await upsertTavernAgent(db, 'ref-idem-1', 'Idem');
    const second = await upsertTavernAgent(db, 'ref-idem-1', 'Idem');
    expect(second.agentId).toBe(first.agentId);
    expect(first.agentId).toBe(tavernExternalId('ref-idem-1'));
  });

  it('伪 pubkey + 展示名 + verificationLevel 只用 basic', async () => {
    const { agentId } = await upsertTavernAgent(db, 'ref-basic-1', 'Basic');
    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(row?.pubkey).toBe('tavern-agent-ref-basic-1');
    expect(row?.name).toBe('Basic·酒馆');
    expect(row?.verificationLevel).toBe('basic');
  });

  it('改名 → id 不变、展示名更新', async () => {
    const ref = 'ref-rename-1';
    const first = await upsertTavernAgent(db, ref, 'OldName');
    const second = await upsertTavernAgent(db, ref, 'NewName');
    expect(second.agentId).toBe(first.agentId);
    const [row] = await db.select().from(agents).where(eq(agents.id, first.agentId));
    expect(row?.name).toBe('NewName·酒馆');
  });

  it('撞名（他 agent 已用该展示名）→ 保旧名', async () => {
    // 持名者：既有 agent（非酒馆路径），直接落库模拟
    await db.insert(agents).values({
      id: 'ext-squatter-1',
      name: 'Taken·酒馆',
      status: 'active',
      verificationLevel: 'basic',
      pubkey: 'pem-holder',
    });
    const res = await upsertTavernAgent(db, 'ref-collide-1', 'Taken');
    // 保旧名：持有者原样不动（名字/密钥都保留），返回持有者 id（与 upsertAgentIdentity name-taken 同语义）
    expect(res.agentId).toBe('ext-squatter-1');
    const [holder] = await db.select().from(agents).where(eq(agents.id, 'ext-squatter-1'));
    expect(holder?.name).toBe('Taken·酒馆');
    expect(holder?.pubkey).toBe('pem-holder');
    // 新 ref 未以该名落库
    const created = await db.query.agents.findFirst({
      where: eq(agents.id, tavernExternalId('ref-collide-1')),
    });
    expect(created).toBeUndefined();
  });
});
