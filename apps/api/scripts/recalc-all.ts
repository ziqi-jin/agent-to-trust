/**
 * recalc-all — 全量重算脚本（S4-B M2 plan §Task 13，M3 前端展示的数据底座）。
 *
 * 用法（连接串仅经 env 参数化，脚本内零硬编码）：
 *   TEST_DATABASE_URL=postgres://…  npx tsx apps/api/scripts/recalc-all.ts  # 测试库验证
 *   DATABASE_URL=postgres://…       npx tsx apps/api/scripts/recalc-all.ts  # 生产重算（M4/T18 部署后手动动作）
 *
 * 行为：遍历全部 agents → 逐个 computeAndPersist（只调用不修改，红线）→
 * console.table 打印 score/adjustedScore 有变化的 agent（before/after）；
 * 无变化的 agent 不打印（「可感知差异」要求）。
 *
 * 幂等性：computeAndPersist 为 append-only 语义（credit_scores / score_snapshots
 * 追加新行，历史不可变），同一证据重复执行 latest 收敛到同值，可安全重跑。
 */

import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { createDb, type Database } from '../src/db/client';
import { creditScores } from '../src/db/schema';
import { migrate } from '../src/db/migrate';
import { computeAndPersist } from '../src/routes/scores';

// 连接串来源：测试库优先（误跑生产方向安全——两者都设时落在测试库）。
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('缺少连接串：请设置 TEST_DATABASE_URL（测试库）或 DATABASE_URL（生产，M4 手动确认后）');
  process.exit(1);
}
const source = process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
// 只打印 host/库名，不回显凭据。
const target = new URL(url);

await migrate(url);
const db: Database = createDb(url);
const app = buildApp(db);

const allAgents = await db.query.agents.findMany({
  orderBy: (a, { asc }) => [asc(a.id)],
});

const changes: Array<{
  agentId: string;
  name: string;
  beforeScore: number | null;
  beforeAdjusted: number | null;
  afterScore: number | null;
  afterAdjusted: number | null;
}> = [];

for (const agent of allAgents) {
  // before 取 latest credit_scores（与 GET /agents/:id/score 同口径：createdAt 降序取首条）。
  const before = await db.query.creditScores.findFirst({
    where: eq(creditScores.agentId, agent.id),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
  const after = await computeAndPersist(app, agent.id);
  if (!before || before.score !== after.score || before.adjustedScore !== after.adjustedScore) {
    changes.push({
      agentId: agent.id,
      name: agent.name,
      beforeScore: before?.score ?? null,
      beforeAdjusted: before?.adjustedScore ?? null,
      afterScore: after.score,
      afterAdjusted: after.adjustedScore,
    });
  }
}

if (changes.length > 0) {
  console.table(changes);
} else {
  console.log('无变化：所有 agent 的 latest score/adjustedScore 与重算结果一致');
}

console.log(
  `完成：共 ${allAgents.length} 个 agent，变化 ${changes.length} 个，无变化 ${allAgents.length - changes.length} 个`,
);
console.log(
  `目标库：${source} → ${target.host}${target.pathname}（append-only：本轮追加 ${allAgents.length} 行 credit_scores + ${allAgents.length} 行 score_snapshots）`,
);

await app.close();
// createDb 内部 Pool 未直接暴露，经 drizzle $client 收口（与测试套件 afterAll 同款）。
const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
await client?.end();
