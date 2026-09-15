#!/usr/bin/env node
/**
 * 榜单数据重置（发布期一次性动作）：清空数据表，保留表结构。
 *
 * 用法:
 *   node scripts/reset-leaderboard.mjs            # dry-run（默认）：只打印将删行数
 *   node scripts/reset-leaderboard.mjs --yes      # 真删（TRUNCATE ... RESTART IDENTITY CASCADE）
 *
 * 连接串: env DATABASE_URL（默认 postgres://acl:acl@localhost:5432/acl）
 *
 * 红线说明:
 *   - 「append-only」是**运行期**红线（证据防篡改不可改写）——保留。
 *   - 发布前**整库重置**是**部署期**动作，与 append-only 不冲突（不算改写历史）。
 *   - 只清数据表，不动表结构；重启后 migrate（apps/api/src/db/migrate.ts）幂等重建。
 */
import { Client } from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://acl:acl@localhost:5432/acl';
const yes = process.argv.includes('--yes');

// 顺序无关（CASCADE 会处理外键）；列出全部业务表。
const TABLES = [
  'arena_events',
  'test_queue',
  'credit_scores',
  'score_snapshots',
  'evidence',
  'arena_sessions',
  'agents',
  'feedback',
  'ingest_nonces',
  'simulation_runs',
];

const c = new Client({ connectionString: url });
await c.connect();
console.log(`[reset] 目标库: ${url.replace(/:[^:@/]+@/, ':***@')}`);
console.log(`[reset] 模式: ${yes ? '⚠️  执行删除' : 'DRY-RUN（加 --yes 才真删）'}`);

let total = 0;
for (const t of TABLES) {
  const { rows } = await c.query(`select count(*)::int as n from ${t}`);
  total += rows[0].n;
  console.log(`  ${t.padEnd(18)} ${String(rows[0].n).padStart(6)}`);
}
console.log(`  ${'—'.repeat(18)} ${'—'.repeat(6)}`);
console.log(`  ${'合计'.padEnd(16)} ${String(total).padStart(6)} 行`);

if (yes) {
  await c.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  console.log('[reset] ✓ 已清空（表结构保留）');
} else {
  console.log('[reset] （dry-run，未改动任何数据）');
}
await c.end();
