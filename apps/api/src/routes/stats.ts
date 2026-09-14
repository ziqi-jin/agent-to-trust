/**
 * /stats/summary — 首页参与统计（榜单1/榜单2 参与数 + 当前排队数）。
 *
 * 口径：
 *  - 榜单1：持考场分的去重 agent 数（credit_scores.agent_id distinct）
 *  - 榜单2：**持 Arena 行为证据**的去重 agent 数（evidence.source='arena'，成交后才写），
 *    剔除平台对家。进入过会话但未成交（无证据）不计入——与行为榜行数同口径（报头对账红线）。
 *    此前按 arena_sessions 参与数统计，导致报头 ARENA-TESTED=7 而榜单只有 4 行（对不上账）。
 *  - queueWaiting：test_queue 中 status=waiting 行数（全部 lane）
 *  - T6（2026-09-08 拍板）：两榜参与数同步吃 leaderboard_visible 过滤——
 *    opt-out agent 是「参与但不上榜」，参与数与公开榜口径一致（0907 走查「数字对不上账」教训）；
 *    ≥3 单成交门槛不计入（门槛是上榜资格，不是参与事实）。
 *  - D1（2026-09-09 13:17 拍板）：EXAMINED = 公开登记且持分的真实 agent 数（=31）。
 *    lb1 必须复用 ./publicScope 的 publicAgentFilter（仿真号 / E2E 号 / 平台保留名一律剔除），
 *    与 /stats?scope=public、/events?scope=public 同口径——单一实现，防口径漂移。
 *    此前只过滤 leaderboard_visible，导致报头 EXAMINED=160（31 公开+100 仿真+29 狗粮）。
 */

import { and, count, countDistinct, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agents, creditScores, evidence, testQueue } from '../db/schema';
import { publicAgentFilter } from './publicScope';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats/summary', async () => {
    const [lb1, lb2, qw] = await Promise.all([
      app.db
        .select({ n: countDistinct(creditScores.agentId) })
        .from(creditScores)
        .innerJoin(agents, eq(creditScores.agentId, agents.id))
        // D1：公开口径 = leaderboard_visible 且非仿真/E2E/平台保留名（与 /stats?scope=public 同一过滤器）。
        .where(and(eq(agents.leaderboardVisible, true), publicAgentFilter)),
      app.db
        .select({ n: countDistinct(evidence.agentId) })
        .from(evidence)
        .innerJoin(agents, eq(evidence.agentId, agents.id))
        // 成交才写 arena 证据 → 与行为榜行数同口径；平台对家/仿真/E2E 由 publicAgentFilter 剔除。
        .where(
          and(
            eq(evidence.source, 'arena'),
            eq(agents.leaderboardVisible, true),
            publicAgentFilter,
          ),
        ),
      app.db.select({ n: count() }).from(testQueue).where(eq(testQueue.status, 'waiting')),
    ]);

    return {
      leaderboard1Participants: lb1[0]?.n ?? 0,
      leaderboard2Participants: lb2[0]?.n ?? 0,
      queueWaiting: qw[0]?.n ?? 0,
    };
  });
}
