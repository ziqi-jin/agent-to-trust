/**
 * Task 1 集成测试：Arena A2A 数据模型迁移（幂等）。
 *
 * 断言：
 *   1. migrate() 后 arena_sessions 含 4 个新列：adapter / a2a_card_url / a2a_rounds / a2a_invalid_rounds。
 *   2. agent_connections 表存在，列齐全（id/agent_id/card_url/token_hash/arena_ready/last_checked_at/created_at/revoked_at）。
 *   3. 幂等：migrate() 连跑两次不报错。
 *
 * 红线：测试库只用 TEST_DATABASE_URL（acl_test），生产库零接触。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Database } from '../client';
import { migrate } from '../migrate';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');
if (TEST_URL.includes('://acl:acl@localhost:5432/acl') && !TEST_URL.includes('acl_test')) {
  throw new Error('拒绝在非 acl_test 库上跑 migrate.a2a 测试（生产库零接触）');
}

let db: Database;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
});

afterAll(async () => {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

async function columnsOf(table: string): Promise<string[]> {
  const res = await db.execute<{ column_name: string }>(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`,
  );
  return res.rows.map((r) => r.column_name);
}

describe('Arena A2A 迁移 — arena_sessions 增列', () => {
  it('含 adapter / a2a_card_url / a2a_rounds / a2a_invalid_rounds 四列', async () => {
    const cols = await columnsOf('arena_sessions');
    for (const c of ['adapter', 'a2a_card_url', 'a2a_rounds', 'a2a_invalid_rounds']) {
      expect(cols, `arena_sessions 缺列 ${c}`).toContain(c);
    }
  });

  it('adapter 默认 polling 且 NOT NULL；a2a_* 可空（老数据不受影响）', async () => {
    const res = await db.execute<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      sql`SELECT column_name, is_nullable, column_default FROM information_schema.columns
          WHERE table_name = 'arena_sessions'
          AND column_name IN ('adapter','a2a_card_url','a2a_rounds','a2a_invalid_rounds')`,
    );
    const byName = Object.fromEntries(res.rows.map((r) => [r.column_name, r]));
    expect(byName.adapter.is_nullable).toBe('NO');
    expect(byName.adapter.column_default).toContain('polling');
    expect(byName.a2a_card_url.is_nullable).toBe('YES');
    expect(byName.a2a_rounds.is_nullable).toBe('YES');
    expect(byName.a2a_invalid_rounds.is_nullable).toBe('YES');
  });
});

describe('Arena A2A 迁移 — agent_connections 表', () => {
  it('表存在', async () => {
    const res = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'agent_connections'`,
    );
    expect(res.rows.map((r) => r.table_name)).toContain('agent_connections');
  });

  it('列齐全（8 列）', async () => {
    const cols = await columnsOf('agent_connections');
    for (const c of [
      'id',
      'agent_id',
      'card_url',
      'token_hash',
      'arena_ready',
      'last_checked_at',
      'created_at',
      'revoked_at',
    ]) {
      expect(cols, `agent_connections 缺列 ${c}`).toContain(c);
    }
  });

  it('arena_ready 默认 false 且 NOT NULL；created_at NOT NULL', async () => {
    const res = await db.execute<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      sql`SELECT column_name, is_nullable, column_default FROM information_schema.columns
          WHERE table_name = 'agent_connections'
          AND column_name IN ('arena_ready','created_at','revoked_at','last_checked_at')`,
    );
    const byName = Object.fromEntries(res.rows.map((r) => [r.column_name, r]));
    expect(byName.arena_ready.is_nullable).toBe('NO');
    expect(byName.arena_ready.column_default).toContain('false');
    expect(byName.created_at.is_nullable).toBe('NO');
    expect(byName.last_checked_at.is_nullable).toBe('YES');
    expect(byName.revoked_at.is_nullable).toBe('YES');
  });

  it('存在 idx_agent_connections_agent_id 索引', async () => {
    const res = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes
          WHERE tablename = 'agent_connections' AND indexname = 'idx_agent_connections_agent_id'`,
    );
    expect(res.rows.map((r) => r.indexname)).toContain('idx_agent_connections_agent_id');
  });
});

describe('Arena A2A 迁移 — 幂等', () => {
  it('连跑两次 migrate() 不报错', async () => {
    await expect(migrate(TEST_URL)).resolves.toBeUndefined();
  });
});
