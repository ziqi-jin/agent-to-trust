/**
 * /stats/summary — 首页参与统计（榜单1/榜单2 参与数 + 当前排队数）。
 *
 * 口径：
 *  - 榜单1：持考场分的去重 agent 数（credit_scores.agent_id distinct）
 *  - 榜单2：参与 Arena 会话的去重 agent 数（buyer/seller，剔除平台对家）
 *  - queueWaiting：test_queue 中 status=waiting 行数（全部 lane）
 *  - T6（2026-09-08 拍板）：两榜参与数同步吃 leaderboard_visible 过滤——
 *    opt-out agent 是「参与但不上榜」，参与数与公开榜口径一致（0907 走查「数字对不上账」教训）；
 *    ≥3 单成交门槛不计入（门槛是上榜资格，不是参与事实）。
 */

import { count, countDistinct, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agents, creditScores, testQueue } from '../db/schema';
import { PLATFORM_NAME } from './arenaQueue';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats/summary', async () => {
    const [lb1, lb2, qw] = await Promise.all([
      app.db
        .select({ n: countDistinct(creditScores.agentId) })
        .from(creditScores)
        .innerJoin(agents, eq(creditScores.agentId, agents.id))
        .where(eq(agents.leaderboardVisible, true)),
      app.db.execute(sql`
        SELECT COUNT(DISTINCT a.id)::int AS n
        FROM arena_sessions s
        JOIN agents a ON a.id = s.buyer_agent_id OR a.id = s.seller_agent_id
        WHERE a.name <> ${PLATFORM_NAME} AND a.leaderboard_visible
      `),
      app.db.select({ n: count() }).from(testQueue).where(eq(testQueue.status, 'waiting')),
    ]);

    return {
      leaderboard1Participants: lb1[0]?.n ?? 0,
      leaderboard2Participants: (lb2.rows[0] as { n: number } | undefined)?.n ?? 0,
      queueWaiting: qw[0]?.n ?? 0,
    };
  });
}
