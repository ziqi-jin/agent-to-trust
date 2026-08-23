import { Pool } from 'pg';

const ADMIN_URL = process.env.ACL_ADMIN_URL ?? 'postgres://acl:acl@localhost:5432/postgres';
const TEST_DB_URL = process.env.ACL_TEST_DATABASE_URL ?? 'postgres://acl:acl@localhost:5432/acl_test';

export function testDatabaseUrl(): string {
  return TEST_DB_URL;
}

/** 重建测试库 + 跑迁移（beforeAll 调用一次）。 */
export async function setupTestDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query('DROP DATABASE IF EXISTS acl_test');
  await admin.query('CREATE DATABASE acl_test');
  await admin.end();
  const { migrate } = await import('../src/db/migrate');
  await migrate(TEST_DB_URL);
}

/** 清空测试数据（beforeEach 调用）。 */
export async function truncateAll(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  await pool.query(
    'TRUNCATE TABLE agents, evidence, credit_scores, score_snapshots CASCADE',
  );
  await pool.end();
}
