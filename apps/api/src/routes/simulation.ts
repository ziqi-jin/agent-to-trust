/**
 * 仿真接入 + 榜单 + 首页统计。
 *
 * 把 @acl/simulator 的「100 Agent 自主交易」链路落库（agents / evidence / credit_scores），
 * 让前端榜单有真实（但 source=simulation，绝不伪装真实交易）的数据可展示。
 */
import { randomUUID } from 'node:crypto';
import { like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { runSimulation } from '@acl/simulator';
import type { SimulationConfig } from '@acl/simulator';
import { agents, evidence, simulationRuns } from '../db/schema';
import { computeAndPersist } from './scores';

export async function simulationRoutes(app: FastifyInstance) {
  // POST /simulation/run — 跑一次确定性仿真并落库（幂等：已 seeded 则跳过）
  app.post('/simulation/run', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<SimulationConfig>;
    const config: SimulationConfig = {
      agentCount: body.agentCount ?? 100,
      rounds: body.rounds ?? 200,
      seed: body.seed ?? 42,
      initialWallet: body.initialWallet ?? 1000,
    };

    const seeded = await app.db.query.agents.findFirst({
      where: like(agents.name, 'sim-agent-%'),
    });
    if (seeded) {
      const lastRun = await app.db.query.simulationRuns.findFirst({
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      });
      return reply.send({ seeded: false, config, stats: lastRun?.stats ?? null });
    }

    const result = runSimulation(config);

    await app.db.insert(agents).values(
      result.agents.map((a) => ({
        id: a.id,
        name: a.name,
        owner: null,
        status: 'active',
        verificationLevel: 'unverified',
        capabilities: a.capabilities,
      })),
    );

    await app.db.insert(evidence).values(
      result.evidence.map((e) => ({
        id: randomUUID(),
        agentId: e.agentId,
        dimension: e.dimension,
        source: e.source,
        sourceType: 'simulation',
        issuer: 'simulation',
        result: e.result,
        value: e.value ?? null,
        severity: null,
        evidenceUri: `sim://tx/${e.transactionId}`,
        payloadHash: null,
        createdAt: e.timestamp,
      })),
    );

    for (const a of result.agents) {
      await computeAndPersist(app, a.id);
    }

    await app.db.insert(simulationRuns).values({
      id: randomUUID(),
      seed: config.seed,
      config: config as unknown as Record<string, unknown>,
      stats: result.stats as unknown as Record<string, unknown>,
    });

    return reply.send({ seeded: true, config, stats: result.stats });
  });

  // GET /leaderboard — 全量排名（含分数、置信度、证据数）
  app.get('/leaderboard', async () => {
    const allAgents = await app.db.query.agents.findMany();
    const allScores = await app.db.query.creditScores.findMany({
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
    const latest = new Map<string, (typeof allScores)[number]>();
    for (const s of allScores) if (!latest.has(s.agentId)) latest.set(s.agentId, s);

    return allAgents
      .map((a) => {
        const sc = latest.get(a.id);
        const source = a.name.startsWith('sim-agent-')
          ? 'simulation'
          : a.id.startsWith('ext-') || a.pubkey
            ? 'real-benchmark'
            : a.name.startsWith('real-')
              ? 'benchmark'
              : 'manual';
        return {
          agentId: a.id,
          name: a.name,
          status: a.status,
          verificationLevel: a.verificationLevel,
          capabilities: a.capabilities ?? [],
          source,
          score: sc?.score ?? null,
          adjustedScore: sc?.adjustedScore ?? null,
          confidence: sc?.confidence ?? 0,
          coverage: sc?.coverage ?? 0,
          evidenceCount: (sc?.evidenceRefs ?? []).length,
          isSimulated: source === 'simulation',
        };
      })
      .sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
      .map((row, i) => ({ ...row, rank: i + 1 }));
  });

  // GET /stats — 首页大数字
  app.get('/stats', async () => {
    const [agentCount, evidenceCount, scoreCount, lastRun] = await Promise.all([
      app.db.query.agents.findMany().then((a) => a.length),
      app.db.query.evidence.findMany().then((e) => e.length),
      app.db.query.creditScores.findMany().then((s) => s.length),
      app.db.query.simulationRuns.findFirst({ orderBy: (r, { desc }) => [desc(r.createdAt)] }),
    ]);
    return {
      agentCount,
      evidenceCount,
      scoreCount,
      simulation: lastRun?.stats ?? null,
    };
  });

  // GET /events — 最近证据流（ticker 用）
  app.get('/events', async () => {
    return app.db.query.evidence.findMany({
      orderBy: (e, { desc }) => [desc(e.createdAt)],
      limit: 40,
    });
  });
}
