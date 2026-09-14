/**
 * 仿真接入 + 榜单 + 首页统计。
 *
 * 把 @acl/simulator 的「100 Agent 自主交易」链路落库（agents / evidence / credit_scores），
 * 让前端榜单有真实（但 source=simulation，绝不伪装真实交易）的数据可展示。
 */
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { runSimulation } from '@acl/simulator';
import type { SimulationConfig } from '@acl/simulator';
import { isDimension, type Dimension } from '@acl/core';
import {
  badgesFromDimensions,
  freshnessFactorFromDays,
  realEvidenceCounts,
  REAL_EVIDENCE_SOURCES,
  type Badge,
} from '@acl/scoring';
import { agents, creditScores, evidence, simulationRuns } from '../db/schema';
import { ARENA_GATE_SCORE, PLATFORM_NAME } from './arenaQueue';
import { computeAndPersist } from './scores';
import { publicAgentFilter } from './publicScope';
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
    const q = req.query as { board?: string; dims?: string; mode?: string };
    const board = q.board === 'behavior' ? 'behavior' : 'capability';
    // 榜2 对家模式筛选（Task 8）：scripted=脚本买家 / live=LLM 人格对家 / all=不过滤（缺省）。
    // 仅作用于行为榜（能力榜忽略该参数）；非法值 → 400（与 dims 白名单同风格，防静默错筛）。
    const mode = q.mode ?? 'all';
    if (mode !== 'all' && mode !== 'scripted' && mode !== 'live') {
      return reply.code(400).send({ error: `非法对家模式：${mode}` });
    }
    // 视图层维度筛选/重排（0912 老大拍板：榜单支持组合维度条件重排）。
    // 白名单校验：非法维度名 → 400（防注入/防静默错排）。不改变底层分数，仅改排序键。
    const selectedDims: Dimension[] = [];
    if (q.dims) {
      for (const raw of q.dims.split(',')) {
        const d = raw.trim();
        if (!d) continue;
        if (!isDimension(d)) {
          return reply.code(400).send({ error: `非法维度名：${d}` });
        }
        if (!selectedDims.includes(d)) selectedDims.push(d);
      }
    }
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
    // 对家模式集合：直接读 evidence.source_type（免 join arena_sessions，Task 8 裁定口径）。
    // 'arena-behavior' → scripted，'arena-behavior-live' → live；其余证据不算行为口径。
    const counterpartModesByAgent = new Map<string, Set<'scripted' | 'live'>>();
    for (const e of arenaEvidence) {
      const m =
        e.sourceType === 'arena-behavior-live'
          ? 'live'
          : e.sourceType === 'arena-behavior'
            ? 'scripted'
            : null;
      if (!m) continue;
      const set = counterpartModesByAgent.get(e.agentId);
      if (set) set.add(m);
      else counterpartModesByAgent.set(e.agentId, new Set([m]));
    }
    // 行为榜资格红线：必须有真实证据——考场（real-benchmark）或酒馆真实交易（real / real-confidential，
    // bearer 机构级上报，2026-09-10 与 arenaQueue gate 同口径放宽）——
    // 防止纯仿真行为证据把 score 推高绕过门槛（simulation 源依然不算，防刷语义保留）
    const benchmarkEvidence = await app.db.query.evidence.findMany({
      where: inArray(evidence.source, [...REAL_EVIDENCE_SOURCES]),
    });
    const benchmarkAgents = new Set(benchmarkEvidence.map((e) => e.agentId));
    // 勋章红线支撑：按 (agentId, dimension) 统计真实证据条数（只算 real-* 源，口径单处在 @acl/scoring）。
    const benchmarkEvByAgent = new Map<string, { dimension: string }[]>();
    for (const e of benchmarkEvidence) {
      const arr = benchmarkEvByAgent.get(e.agentId);
      if (arr) arr.push(e);
      else benchmarkEvByAgent.set(e.agentId, [e]);
    }
    const realEvByAgentDim = new Map(
      [...benchmarkEvByAgent].map(([agentId, rows]) => [agentId, realEvidenceCounts(rows)]),
    );

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
        // E2E 测试号判定（审计 B4：统一为 ILIKE 'e2e%' 语义，大小写不敏感前缀）——
        // 必须与 /stats、/events 的 publicAgentFilter 同口径（否则 e2efoo 榜单在榜、统计被剔）。
        // 必须先于 pubkey 判定：酒馆 E2E 号也有 pubkey，否则被误判 real-benchmark 挂 SDK
        // 标签占榜（0907 走查 C3 根因）。
        const isE2E = /^e2e/i.test(a.name);
        const source =
          isE2E || a.name.startsWith('sim-agent-')
          ? 'simulation'
            : a.id.startsWith('ext-') || a.pubkey
              ? 'real-benchmark'
              : a.name.startsWith('real-')
                ? 'benchmark'
                : 'manual';
        // 行为分：非能力维度加权和归一 ×10（对齐 1000 制），再乘**置信度 × 新鲜度**
        // ——2026-09-13 老大拍板 A（修口径 bug）：与榜1 印章同尺，稀疏号不再「只考一门满分 = 1000」。
        // 榜2 是榜1 的准入门（考场分 ≥ ARENA_GATE_SCORE 才进），同 agent 榜2 应 ≤ 榜1。
        let behaviorScore: number | null = null;
        const dims = (sc?.dimensions ?? null) as Array<{ dimension: string; score: number | null; weight: number }> | null;
        if (dims) {
          const behavior = dims.filter((d) => d.dimension !== 'capability' && d.score !== null);
          if (behavior.length > 0) {
            const wsum = behavior.reduce((s, d) => s + d.weight, 0);
            const base =
              (behavior.reduce((s, d) => s + (d.score ?? 0) * d.weight, 0) / wsum) * 10;
            const fresh = freshnessFactorFromDays(sc?.freshnessDays ?? null) ?? 1;
            behaviorScore = Math.round(base * (sc?.confidence ?? 0) * fresh);
          }
        }
        // 勋章派生（纯函数，口径单处在 @acl/scoring）：只认真实证据条数；时效由 freshnessDays 推算。
        const badges: Badge[] = badgesFromDimensions(
          dims ?? [],
          realEvByAgentDim.get(a.id) ?? new Map(),
          sc?.freshnessDays ?? null,
        );
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
          // 勋章 + 维度明细（0912）：前者是本行 agent 已达成勋章（服务端权威派生）。
          badges,
          dimensions: dims ?? [],
          isSimulated: source === 'simulation',
          behaviorScore,
          isE2E,
          // 该 agent 有行为证据的对家模式集合（排序稳定：scripted 在前）。
          counterpartModes: (() => {
            const set = counterpartModesByAgent.get(a.id);
            if (!set) return [];
            return ['scripted', 'live'].filter((m) => set.has(m as 'scripted' | 'live'));
          })(),
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
              (r.score ?? 0) >= ARENA_GATE_SCORE &&
              (mode === 'all' || r.counterpartModes.includes(mode)),
          )
        : rows.filter(
            (r) =>
              // 审计 A3【P1】：平台对家是系统撮合账号，不是参赛 agent，绝不进公开能力榜。
              // 与 stats.ts lb2（`name <> PLATFORM_NAME`）及 behavior 榜口径一致。
              r.name !== PLATFORM_NAME &&
              r.source !== 'simulation' &&
              !r.isE2E &&
              r.leaderboardVisible &&
              (!r.isTradeAgent || r.settledCount >= MIN_TRADE_SETTLED_FOR_BOARD),
          );

    return filtered
      .sort((x, y) => {
        // 视图层组合维度重排（0912）：勾选维度后按所选维度均分降序（不改底层分数）。
        if (selectedDims.length > 0) {
          const avg = (r: (typeof rows)[number]) => {
            const sum = selectedDims.reduce((s, d) => {
              const found = r.dimensions.find((x) => x.dimension === d);
              return s + (found?.score ?? 0);
            }, 0);
            return sum / selectedDims.length;
          };
          const d = avg(y) - avg(x);
          if (d !== 0) return d;
        }
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
  // 展示口径（0907 走查「数字对不上账」）：排除仿真号 sim-agent-*、E2E 测试号（e2e 前缀）
  // 与平台保留名，与 capability 榜公开面一致。
  // D1（2026-09-09 拍板）：过滤器抽到 ./publicScope，/stats/summary lb1 复用同一实现，
  // 单一口径防漂移（EXAMINED=公开登记且持分的真实 agent 数）。
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
