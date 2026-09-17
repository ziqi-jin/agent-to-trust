/**
 * 抽样复算（verified 判定）。
 *
 * 对 endpoint 模式的 agent：服务端用同版本题集抽客观题重跑，
 * 与最近一次上报的分数一致 → verificationLevel=verified；
 * 不一致 / 不可达 / 无 endpoint → 保持 basic。异步执行，不阻塞 ingest。
 *
 * 红线：只升级不降级——复算不通过不扣分（波动允许），但不给 verified 徽章。
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { EndpointAgent, loadSuite } from 'agent-to-trust';
import { agents, evidence } from '../db/schema';
import { isPublicEndpoint } from '../playground/scenario';

/** 复算抽题：确定性客观题（数值题，grader 无歧义）。 */
const REVERIFY_CASE_IDS = ['coding-sum', 'reasoning-sequence'];
const FETCH_TIMEOUT_MS = 15_000;
const VALUE_TOLERANCE = 0.01;

/** 同一 agent 复算防并发：共享同一个进行中的 Promise（撞锁 = 复用结果）。 */
const inFlight = new Map<string, Promise<'verified' | 'basic'>>();

export function reverifyAgent(
  app: FastifyInstance,
  agentId: string,
): Promise<'verified' | 'basic'> {
  const existing = inFlight.get(agentId);
  if (existing) return existing;
  const p = runReverify(app, agentId).finally(() => inFlight.delete(agentId));
  inFlight.set(agentId, p);
  return p;
}

async function runReverify(
  app: FastifyInstance,
  agentId: string,
): Promise<'verified' | 'basic'> {
  try {
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    if (!agent?.endpoint || !agent.pubkey) return 'basic';
    // 审计 A4【P1·安全】：ingest 已卡口新写入，但库里可能已有历史脏 endpoint。
    // 服务端 fetch 前再校验一次：非法（环回/私网/非 http(s)）直接放弃，不发请求。
    if (!isPublicEndpoint(agent.endpoint)) return 'basic';

    // 最近一次上报的 real-benchmark 证据（按 caseId 取最新 value）
    const allReal = await app.db.query.evidence.findMany({
      where: and(eq(evidence.agentId, agentId), eq(evidence.source, 'real-benchmark')),
      orderBy: [desc(evidence.createdAt)],
    });
    const latestByCase = new Map<string, number>();
    for (const e of allReal) {
      const caseId = e.evidenceUri?.replace('a2t://benchmark/', '');
      if (caseId && !latestByCase.has(caseId)) latestByCase.set(caseId, e.value ?? -1);
    }
    const toVerify = REVERIFY_CASE_IDS.flatMap((id) => {
      const c = loadSuite().find((x) => x.id === id);
      const expected = latestByCase.get(id);
      return c && expected !== undefined ? [{ case: c, expected }] : [];
    });
    if (toVerify.length === 0) return 'basic'; // 无可复算的客观题

    const fetchImpl: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const endpointAgent = new EndpointAgent(agent.endpoint, fetchImpl);

    for (const { case: c, expected } of toVerify) {
      let value: number;
      try {
        const output = await endpointAgent.reply(c.prompt);
        value = c.grade(output).value;
      } catch {
        return 'basic'; // 不可达 / 超时
      }
      if (Math.abs(value - expected) > VALUE_TOLERANCE) {
        return 'basic'; // 不一致
      }
    }

    await app.db
      .update(agents)
      .set({ verificationLevel: 'verified' })
      .where(eq(agents.id, agentId));
    return 'verified';
  } finally {
    inFlight.delete(agentId);
  }
}
