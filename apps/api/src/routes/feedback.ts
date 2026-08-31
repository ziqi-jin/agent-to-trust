/**
 * POST /feedback — 隐蔽入口的用户反馈收集。
 *
 * append-only：不做公开查询接口，落库供运营查看。
 * 限速：单实例内存滑动窗口（同 IP 每 FEEDBACK_RATE_WINDOW_MS 内最多 FEEDBACK_RATE_MAX 条）。
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { feedback } from '../db/schema';

const RATE_MAX_DEFAULT = 3;
const RATE_WINDOW_MS_DEFAULT = 60_000;
const MESSAGE_MAX = 2000;
/** contact/page 字段上限。 */
const FIELD_MAX = 200;

/** ip → 窗口内命中时间戳。 */
const hits = new Map<string, number[]>();

/** 测试隔离：清空限速器。 */
export function resetFeedbackLimiterForTests(): void {
  hits.clear();
}

/** 滑动窗口限速：命中返回 true（不消费配额），未命中记录并放行。 */
function rateLimited(ip: string): boolean {
  const max = Number(process.env.FEEDBACK_RATE_MAX ?? RATE_MAX_DEFAULT);
  const windowMs = Number(process.env.FEEDBACK_RATE_WINDOW_MS ?? RATE_WINDOW_MS_DEFAULT);
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  hits.set(ip, list);
  if (list.length >= max) return true;
  list.push(now);
  return false;
}

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post('/feedback', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
    const page = typeof body.page === 'string' ? body.page.trim() : '';

    if (!message) return reply.code(400).send({ error: 'message 必填' });
    if (message.length > MESSAGE_MAX) {
      return reply.code(400).send({ error: `message 最多 ${MESSAGE_MAX} 字` });
    }
    if (contact.length > FIELD_MAX) {
      return reply.code(400).send({ error: `contact 最多 ${FIELD_MAX} 字` });
    }
    if (page.length > FIELD_MAX) {
      return reply.code(400).send({ error: `page 最多 ${FIELD_MAX} 字` });
    }

    if (rateLimited(req.ip)) {
      return reply.code(429).send({ error: '反馈太频繁，请稍后再试' });
    }

    await app.db.insert(feedback).values({
      id: `fb-${randomUUID().slice(0, 8)}`,
      message,
      contact: contact || null,
      page: page || null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    return reply.code(201).send({ ok: true });
  });
}
