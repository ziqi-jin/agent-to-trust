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
import { NEGOTIATION_SCENARIOS, scenarioText, type Locale, type NegotiationScenario } from '@acl/sdk';
import { validateSessionInput } from '../playground/scenario';
import { PlaygroundQueue, type PlaygroundQueueOpts } from '../playground/queue';
import { PlaygroundStore } from '../playground/store';
import { RateLimiter } from '../playground/rateLimit';
import { runSession } from '../playground/runner';

/** 模板展示名/描述（zh 源 + en 译文；0904 i18n）。 */
const TEMPLATE_META: Record<string, { zh: { name: string; desc: string }; en: { name: string; desc: string } }> = {
  'neg-keyboard-price': {
    zh: { name: '键盘采购单价', desc: '100 把定制机械键盘，市场价约 90 元，目标把单价谈到 65 以内' },
    en: { name: 'Keyboard Sourcing', desc: '100 custom mechanical keyboards, market ~90 CNY/unit; target: get the unit price to 65 or below' },
  },
  'neg-delivery-days': {
    zh: { name: '外包交付周期', desc: '官网项目外包，对方首报 14 天，目标压到 7 天以内' },
    en: { name: 'Outsourced Delivery Window', desc: 'Website project outsourced; their opening quote is 14 days; target: compress to 7 days or fewer' },
  },
  'neg-bulk-price': {
    zh: { name: '文化衫批量价', desc: '1000 件文化衫（市场价 10 元/件），目标折后 ≤8.5 元' },
    en: { name: 'T-shirt Bulk Price', desc: '1,000 T-shirts (market 10 CNY each); target: discounted unit price ≤ 8.5 CNY' },
  },
};

/** 模板按 locale materialize：EN 时 name/desc/scenario 文案全英文。 */
function localizeTemplate(sc: NegotiationScenario, locale: Locale) {
  const meta = TEMPLATE_META[sc.id];
  const text = scenarioText(sc, locale);
  return {
    id: sc.id,
    name: meta?.[locale].name ?? sc.id,
    desc: meta?.[locale].desc ?? text.brief,
    scenario:
      locale === 'en'
        ? { ...sc, brief: text.brief, agentRole: text.agentRole, counterpartRole: text.counterpartRole, metricLabel: text.metricLabel }
        : sc,
  };
}

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

  app.get('/playground/templates', async (req) => {
    const q = req.query as { locale?: string };
    const locale: Locale = q.locale === 'zh' ? 'zh' : 'en'; // 默认 en（0904 i18n）
    return {
      templates: NEGOTIATION_SCENARIOS.map((sc) => localizeTemplate(sc, locale)),
    };
  });

  app.post('/playground/sessions', async (req, reply) => {
    const v = validateSessionInput(req.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const input = v.value;
    const zh = input.locale === 'zh';

    // 队列满 → 503 快速拒绝（放在限流配额消耗之前：被拒不该白烧每小时额度）
    if (queue.isFull()) {
      return reply
        .code(503)
        .send({ error: zh ? '排队人数较多，请稍后再试' : 'Queue is full right now — please try again later.' });
    }

    const gate = limiter.tryAcquire(req.ip, Date.now());
    if (!gate.ok) {
      return reply
        .code(429)
        .header('retry-after', String(gate.retryAfterSeconds))
        .send({
          error: zh
            ? `跑局太频繁，请 ${gate.retryAfterSeconds} 秒后再试`
            : `Too many runs — please retry in ${gate.retryAfterSeconds}s`,
          retryAfterSeconds: gate.retryAfterSeconds,
        });
    }

    const session = store.create(input);
    queue.run(
      session,
      () =>
        runSession(session, input.apiKey, input.scenario, fetchImpl, input.model)
          .catch((e) => {
            session.status = 'failed';
            session.error = zh
              ? `runner 异常：${String((e as Error)?.message ?? e).slice(0, 200)}`
              : `Runner error: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
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
    if (!session) {
      return reply.code(404).send({ error: '会话不存在或已过期（1 小时后自动清除）' });
    }
    const position = queue.positionOf(id);
    return position !== null ? { ...session, queuePosition: position } : session;
  });
}
