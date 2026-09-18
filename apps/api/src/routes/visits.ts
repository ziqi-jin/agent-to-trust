/**
 * /visits — 全站访问计数（PV）。
 *
 * 老大 2026-09-18：两个站（sealit.cc / reeftavern.cc）页脚都要显示访问数，便于感知流量。
 *
 * 口径：
 *  - POST /visits：页面加载上报一次（PV +1，按天聚合），返回最新计数。
 *  - GET  /visits：只读，不计数（供预渲染/探测用，避免探测污染数据）。
 *  - 不存 IP / UA：纯计数，最小采集面（与隐私政策「不收集个人标识」一致）。
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function readVisits(app: FastifyInstance): Promise<{ total: number; today: number }> {
  const res: unknown = await app.db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(hits) FROM page_visits), 0)::int AS total,
      COALESCE((SELECT hits FROM page_visits WHERE day = CURRENT_DATE), 0)::int AS today
  `);
  // drizzle node-postgres：不同版本可能返回数组或 { rows }；两种都兼容。
  const rows = Array.isArray(res)
    ? (res as Array<Record<string, unknown>>)
    : ((res as { rows?: Array<Record<string, unknown>> })?.rows ?? []);
  const row = rows[0] ?? {};
  return { total: Number(row.total ?? 0), today: Number(row.today ?? 0) };
}

export async function visitsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/visits', async () => {
    await app.db.execute(sql`
      INSERT INTO page_visits (day, hits) VALUES (CURRENT_DATE, 1)
      ON CONFLICT (day) DO UPDATE SET hits = page_visits.hits + 1
    `);
    return readVisits(app);
  });

  app.get('/visits', async () => readVisits(app));
}
