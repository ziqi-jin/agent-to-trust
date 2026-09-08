/**
 * 仿真接入 + 榜单 + 首页统计。
 *
 * 把 @acl/simulator 的「100 Agent 自主交易」链路落库（agents / evidence / credit_scores），
 * 让前端榜单有真实（但 source=simulation，绝不伪装真实交易）的数据可展示。
 */
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, ilike, inArray, like, not } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { runSimulation } from '@acl/simulator';
import type { SimulationConfig } from '@acl/simulator';
import { agents, creditScores, evidence, simulationRuns } from '../db/schema';
import { ARENA_GATE_SCORE } from './arenaQueue';
import { computeAndPersist } from './scores';
import { createRateLimiter } from '../services/rateLimit';

/**
 * T6 ≥3 单成交门槛（老大 2026-09-08 17:00 拍板，「双保险」防榜单膨胀）：
 * 酒馆身份 agent（伪 pubkey `tavern-agent-` 前缀，tavernIdentity 唯一权威）settled
 * （economic/success 真实证据 ≡ confirmed 成交单，1 单=1 行）< 3 不上榜。
 * 主要针对榜单 1；榜单 2 不设门槛（偏差记录：行为榜已有 arena 准入 + real-benchmark
 * 证据 + 考场分三重门槛，成交数非其语义）。SDK/考场 agent 无「成交」概念，豁免。
 */
export const MIN_TRADE_SETTLED_FOR_BOARD = 3;

export async function simulationRoutes(app: FastifyInstance) {
  // 公开读限流 60/min/IP（S4-B M2 批 2，plan §Task 12；统一内存桶）。
  // 只限 GET /leaderboard；POST /simulation/*（触发仿真写库）不在此桶内。
  // 注：plan §Task 12 写「stats.ts（leaderboard 所在）」，实际 leaderboard 路由在本文件，按实落点。
  const leaderboardLimited = createRateLimiter({ max: 60, windowMs: 60_000 });

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
  // ?board=capability（默认）考场榜：只收真实数据（simulation 隐藏，append-only 不删）
  // ?board=behavior  行为榜：资格 = 考场信用分 ≥ ARENA_GATE_SCORE（与 arenaQueue 门槛同源）且已进入 Arena（有行为证据）；行为分 = 行为维度加权和
  app.get('/leaderboard', async (req, reply) => {
    if (leaderboardLimited(req)) {
      return reply.code(429).send({ error: '请求过于频繁，稍后再试' });
    }
    const q = req.query as { board?: string };
    const board = q.board === 'behavior' ? 'behavior' : 'capability';
    const allAgents = await app.db.query.agents.findMany();
    const allScores = await app.db.query.creditScores.findMany({
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
    const latest = new Map<string, (typeof allScores)[number]>();
    for (const s of allScores) if (!latest.has(s.agentId)) latest.set(s.agentId, s);
    const arenaEvidence = await app.db.query.evidence.findMany({
      where: eq(evidence.source, 'arena'),
    });
    const arenaAgents = new Set(arenaEvidence.map((e) => e.agentId));
    // 行为榜资格红线：必须有真实考场证据（benchmark）——
    // 防止纯行为证据把 score 推高绕过考场门槛（“上榜必须真跑考场”）
    const benchmarkEvidence = await app.db.query.evidence.findMany({
      where: eq(evidence.source, 'real-benchmark'),
    });
    const benchmarkAgents = new Set(benchmarkEvidence.map((e) => e.agentId));

    // T6 榜单上报开关（一个开关管两榜）：信用数据照跑，只控公开展示。
    // settled 计数（economic/success 真实证据 = confirmed 成交单，1 单 1 行）按 agent 聚合。
    const settledRows = await app.db.query.evidence.findMany({
      where: and(
        eq(evidence.dimension, 'economic'),
        eq(evidence.result, 'success'),
        inArray(evidence.source, ['real', 'real-confidential']),
      ),
    });
    const settledByAgent = new Map<string, number>();
    for (const e of settledRows) {
      settledByAgent.set(e.agentId, (settledByAgent.get(e.agentId) ?? 0) + 1);
    }
    // 酒馆身份判定：tavernIdentity.tavernPubkey 的伪 pubkey 前缀（身份权威单处在 identity 服务）
    const isTradeAgent = (pubkey: string | null): boolean =>
      typeof pubkey === 'string' && pubkey.startsWith('tavern-agent-');

    const rows = allAgents
      .map((a) => {
        const sc = latest.get(a.id);
        // E2E 测试号判定（对齐酒馆 visibility 口径：名字 e2e 前缀，大小写不敏感）——
        // 必须先于 pubkey 判定：酒馆 E2E 号也有 pubkey，否则被误判 real-benchmark 挂 SDK
        // 标签占榜（0907 走查 C3 根因）。
        const isE2E = /^e2e[-\s]/i.test(a.name);
        const source =
          isE2E || a.name.startsWith('sim-agent-')
          ? 'simulation'
            : a.id.startsWith('ext-') || a.pubkey
              ? 'real-benchmark'
              : a.name.startsWith('real-')
                ? 'benchmark'
                : 'manual';
        // 行为分：非能力维度加权和归一 ×10（对齐 1000 制）
        let behaviorScore: number | null = null;
        const dims = (sc?.dimensions ?? null) as Array<{ dimension: string; score: number | null; weight: number }> | null;
        if (dims) {
          const behavior = dims.filter((d) => d.dimension !== 'capability' && d.score !== null);
          if (behavior.length > 0) {
            const wsum = behavior.reduce((s, d) => s + d.weight, 0);
            behaviorScore = Math.round(
              (behavior.reduce((s, d) => s + (d.score ?? 0) * d.weight, 0) / wsum) * 10,
            );
          }
        }
        return {
          agentId: a.id,
          name: a.name,
          status: a.status,
          verificationLevel: a.verificationLevel,
          capabilities: a.capabilities ?? [],
          source,
          model: a.model ?? null,
          agentVersion: a.agentVersion ?? null,
          score: sc?.score ?? null,
          adjustedScore: sc?.adjustedScore ?? null,
          confidence: sc?.confidence ?? 0,
          coverage: sc?.coverage ?? 0,
          evidenceCount: (sc?.evidenceRefs ?? []).length,
          isSimulated: source === 'simulation',
          behaviorScore,
          isE2E,
          inArena: arenaAgents.has(a.id),
          hasBenchmark: benchmarkAgents.has(a.id),
          // T6：可见性（行内不过滤，过滤集中在下方 filtered——两榜共用同一判定）
          leaderboardVisible: a.leaderboardVisible,
          isTradeAgent: isTradeAgent(a.pubkey),
          settledCount: settledByAgent.get(a.id) ?? 0,
        };
      });

    // T6 过滤：opt-out（leaderboardVisible=false）两榜都不进；榜单 1 另加 ≥3 单成交
    // 门槛（仅酒馆身份 agent，SDK/考场豁免，见 MIN_TRADE_SETTLED_FOR_BOARD 注释）。
    const filtered =
      board === 'behavior'
        ? rows.filter(
            (r) =>
              !r.isE2E &&
              r.leaderboardVisible &&
              r.inArena &&
              r.hasBenchmark &&
              (r.score ?? 0) >= ARENA_GATE_SCORE,
          )
        : rows.filter(
            (r) =>
              r.source !== 'simulation' &&
              !r.isE2E &&
              r.leaderboardVisible &&
              (!r.isTradeAgent || r.settledCount >= MIN_TRADE_SETTLED_FOR_BOARD),
          );

    return filtered
      .sort((x, y) => {
        if (board === 'behavior') {
          return (y.behaviorScore ?? -1) - (x.behaviorScore ?? -1);
        }
        // 榜单1：置信加权分优先——1000 分低置信不该压过 797 分高置信（dogfood 0901 发现）
        const xa = x.adjustedScore ?? -1;
        const ya = y.adjustedScore ?? -1;
        if (ya !== xa) return ya - xa;
        return (y.score ?? -1) - (x.score ?? -1);
      })
      .map((row, i) => ({ ...row, rank: i + 1 }));
  });

  // GET /stats — 首页大数字
  // 默认全量（P0-10 红线：统计数字与落库一致、仿真数据可溯）；?scope=public 为门面
  // 展示口径（0907 走查「数字对不上账」）：排除仿真号 sim-agent-* 与 E2E 测试号（e2e 前缀），
  // 与 capability 榜公开面一致。
  const publicAgentFilter = and(
    not(ilike(agents.name, 'e2e%')),
    not(like(agents.name, 'sim-agent-%')),
  );
  app.get('/stats', async (req) => {
    const q = (req.query as { scope?: string }) ?? {};
    const lastRun = await app.db.query.simulationRuns.findFirst({
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
    if (q.scope !== 'public') {
      const [agentCount, evidenceCount, scoreCount] = await Promise.all([
        app.db.query.agents.findMany().then((a) => a.length),
        app.db.query.evidence.findMany().then((e) => e.length),
        app.db.query.creditScores.findMany().then((s) => s.length),
      ]);
      return { agentCount, evidenceCount, scoreCount, simulation: lastRun?.stats ?? null };
    }
    const [ag, ev, sc] = await Promise.all([
      app.db.select({ n: count() }).from(agents).where(publicAgentFilter),
      app.db
        .select({ n: count() })
        .from(evidence)
        .innerJoin(agents, eq(evidence.agentId, agents.id))
        .where(publicAgentFilter),
      app.db
        .select({ n: count() })
        .from(creditScores)
        .innerJoin(agents, eq(creditScores.agentId, agents.id))
        .where(publicAgentFilter),
    ]);
    return {
      agentCount: ag[0]?.n ?? 0,
      evidenceCount: ev[0]?.n ?? 0,
      scoreCount: sc[0]?.n ?? 0,
      simulation: lastRun?.stats ?? null,
    };
  });

  // GET /events — 最近证据流（ticker 用）；默认全量（append-only 可溯，P0-10 红线），
  // ?scope=public 门面口径（排仿真/E2E 名下证据）。
  app.get('/events', async (req) => {
    const q = (req.query as { scope?: string }) ?? {};
    if (q.scope !== 'public') {
      return app.db.query.evidence.findMany({
        orderBy: (e, { desc }) => [desc(e.createdAt)],
        limit: 40,
      });
    }
    const rows = await app.db
      .select({ evidence })
      .from(evidence)
      .innerJoin(agents, eq(evidence.agentId, agents.id))
      .where(publicAgentFilter)
      .orderBy(desc(evidence.createdAt))
      .limit(40);
    return rows.map((r) => r.evidence);
  });
}
