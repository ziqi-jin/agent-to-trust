/**
 * 真实 Agent 评测接入 — 把 @a2t/adapters 的 DeepSeek benchmark 落库。
 *
 * 跑真实模型（DeepSeek）的 coding/reasoning/honesty 3 维 benchmark，
 * 产出 source=benchmark 的证据，喂进 @a2t/scoring 评分引擎，
 * 让真实 Agent 与仿真 Agent 并排出现在榜单上（source 可区分）。
 *
 * 红线：证据显式 source=benchmark，绝不伪装成 real/verified。
 */
import { randomUUID } from 'node:crypto';
import { like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DeepSeekClient, ModelAgent, runBenchmark, benchmarkToEvidence } from '@a2t/adapters';
import { agents, evidence } from '../db/schema';
import { computeAndPersist } from './scores';

/** 真实 Agent persona 定义：同一模型（deepseek-v4-flash）+ 不同 persona = 不同个体。 */
const REAL_AGENTS = [
  {
    id: 'real-agent-coder',
    name: 'real-coder-pro',
    model: 'deepseek-v4-flash',
    systemPrompt:
      'You are a precise senior software engineer. Write correct, concise code. When you do not know something, say so directly.',
    capabilities: ['code', 'web'],
    owner: 'a2t-lab',
  },
  {
    id: 'real-agent-reasoner',
    name: 'real-reasoner',
    model: 'deepseek-v4-flash',
    systemPrompt:
      'You are a careful logician. Think step by step and give exact numerical answers. Never fabricate facts.',
    capabilities: ['math', 'data'],
    owner: 'a2t-lab',
  },
  {
    id: 'real-agent-honest',
    name: 'real-honest-assistant',
    model: 'deepseek-v4-flash',
    systemPrompt:
      'You are an honest general assistant. Prioritize truthfulness over confidence. If a premise is fictional or you are unsure, admit it plainly.',
    capabilities: ['research', 'ops'],
    owner: 'a2t-lab',
  },
];

export async function benchmarkRoutes(app: FastifyInstance) {
  // POST /benchmark/run — 跑真实 benchmark 并落库（幂等：已 seeded 则跳过）
  app.post('/benchmark/run', async (_req, reply) => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return reply.code(500).send({ error: '缺少 DEEPSEEK_API_KEY（API 容器未注入）' });
    }
    const baseUrl = process.env.DEEPSEEK_BASE_URL;

    const seeded = await app.db.query.agents.findFirst({
      where: like(agents.name, 'real-%'),
    });
    if (seeded) {
      return reply.send({ seeded: false, agents: REAL_AGENTS.map((a) => a.name) });
    }

    const client = new DeepSeekClient({ apiKey, baseUrl });
    const results: Array<{ id: string; name: string; model: string; score: number | null }> = [];

    for (const spec of REAL_AGENTS) {
      const agent = new ModelAgent(
        {
          id: spec.id,
          name: spec.name,
          model: spec.model,
          systemPrompt: spec.systemPrompt,
          capabilities: spec.capabilities,
          owner: spec.owner,
        },
        client,
      );

      // 1) 落库 agent（profile 对齐 agents 表）
      await app.db
        .insert(agents)
        .values({
          id: agent.config.id,
          name: agent.config.name,
          owner: agent.config.owner ?? null,
          status: 'active',
          verificationLevel: 'unverified',
          capabilities: agent.config.capabilities ?? [],
        })
        .onConflictDoNothing();

      // 2) 跑 benchmark（6 case）
      const bench = await runBenchmark((p: string) => agent.reply(p));

      // 3) 证据落库（source=benchmark）
      const evPoints = benchmarkToEvidence(agent.config.id, bench);
      for (const e of evPoints) {
        await app.db.insert(evidence).values({
          id: randomUUID(),
          agentId: agent.config.id,
          dimension: e.dimension,
          source: e.source,
          sourceType: 'benchmark',
          issuer: 'deepseek-benchmark',
          result: e.result,
          value: e.value,
          severity: null,
          evidenceUri: e.evidenceUri,
          payloadHash: null,
        });
      }

      // 4) 算分
      const score = await computeAndPersist(app, agent.config.id);
      results.push({ id: agent.config.id, name: agent.config.name, model: spec.model, score: score.score });
    }

    return reply.send({ seeded: true, results });
  });
}
