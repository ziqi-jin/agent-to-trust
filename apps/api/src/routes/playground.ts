/**
 * /playground 路由——自测场（匿名、无签名、不进官方榜）。
 *
 * 红线（docs/specs/2026-09-02-playground-design.md）：
 * - 不写 credit_scores/agents（保榜单公信力）
 * - apiKey 只透传给 runner 闭包，绝不入库/入日志/入响应
 * - SSRF：isPublicEndpoint 拒绝环回/私网
 * - 限流：per-IP 并发 2、每小时 10，429 + retry-after
 * - 全局队列（0903 老大指令）：并发上限 PG_MAX_ACTIVE（默认 6）→ 超出 FIFO 排队（上限 60），
 *   排队超时 3min 判 failed 并归还限流额度；队列满 503 快速拒绝——整机不被同时开局打挂
 * - 会话内存态 TTL 1h（sweep 周期调用，unref）
 */
import type { FastifyInstance } from 'fastify';
import { NEGOTIATION_SCENARIOS } from '@acl/sdk';
import { validateSessionInput } from '../playground/scenario';
import { PlaygroundQueue, type PlaygroundQueueOpts } from '../playground/queue';
import { PlaygroundStore } from '../playground/store';
import { RateLimiter } from '../playground/rateLimit';
import { runSession } from '../playground/runner';

const TEMPLATE_META: Record<string, { name: string; desc: string }> = {
  'neg-keyboard-price': { name: '键盘采购单价', desc: '100 把定制机械键盘，市场价约 90 元，目标把单价谈到 65 以内' },
  'neg-delivery-days': { name: '外包交付周期', desc: '官网项目外包，对方首报 14 天，目标压到 7 天以内' },
  'neg-bulk-price': { name: '文化衫批量价', desc: '1000 件文化衫（市场价 10 元/件），目标折后 ≤8.5 元' },
};

export async function playgroundRoutes(
  app: FastifyInstance,
  opts: { fetchImpl?: typeof fetch; queueOpts?: PlaygroundQueueOpts } = {},
): Promise<void> {
  const store = new PlaygroundStore();
  const limiter = new RateLimiter();
  const queue = new PlaygroundQueue(opts.queueOpts);
  const fetchImpl = opts.fetchImpl ?? fetch;

  const sweeper = setInterval(() => store.sweep(Date.now()), 300_000);
  sweeper.unref?.();

  app.get('/playground/templates', async () => ({
    templates: NEGOTIATION_SCENARIOS.map((sc) => ({
      id: sc.id,
      name: TEMPLATE_META[sc.id]?.name ?? sc.id,
      desc: TEMPLATE_META[sc.id]?.desc ?? sc.brief,
      scenario: sc,
    })),
  }));

  app.post('/playground/sessions', async (req, reply) => {
    const v = validateSessionInput(req.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const input = v.value;

    // 队列满 → 503 快速拒绝（放在限流配额消耗之前：被拒不该白烧每小时额度）
    if (queue.isFull()) {
      return reply.code(503).send({ error: '排队人数较多，请稍后再试' });
    }

    const gate = limiter.tryAcquire(req.ip, Date.now());
    if (!gate.ok) {
      return reply
        .code(429)
        .header('retry-after', String(gate.retryAfterSeconds))
        .send({ error: `跑局太频繁，请 ${gate.retryAfterSeconds} 秒后再试`, retryAfterSeconds: gate.retryAfterSeconds });
    }

    const session = store.create(input);
    queue.run(
      session,
      () =>
        runSession(session, input.apiKey, input.scenario, fetchImpl, input.model)
          .catch((e) => {
            session.status = 'failed';
            session.error = `runner 异常：${String((e as Error)?.message ?? e).slice(0, 200)}`;
          })
          .finally(() => limiter.release(gate.token)),
      () => limiter.release(gate.token),
    );

    // 有空位 → running；占满 → queued（前端轮询 GET 显示排队位置）
    return reply.code(201).send({ id: session.id, status: session.status });
  });

  app.get('/playground/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = store.get(id);
    if (!session) return reply.code(404).send({ error: '会话不存在或已过期（1 小时后自动清除）' });
    const position = queue.positionOf(id);
    return position !== null ? { ...session, queuePosition: position } : session;
  });
}
