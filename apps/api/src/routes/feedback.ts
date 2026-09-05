/**
 * POST /feedback — 隐蔽入口的用户反馈收集。
 *
 * append-only：不做公开查询接口，落库供运营查看。
 * 防刷三件套（同构酒馆 S1 姿态）：
 * - 蜜罐：表单藏 website 字段，人类不可见；机器人填了 → 假成功不入库（不耗限速配额）
 * - 限速：单实例内存滑动窗口（同 IP 每 FEEDBACK_RATE_WINDOW_MS 内最多 FEEDBACK_RATE_MAX 条，
 *   默认 5 次/小时；经 nginx 同源代理后所有请求同源 IP，即全局共享——S1 流量下最保守姿态）
 * - 箱满：未处理反馈达 FEEDBACK_BOX_CAPACITY（默认 500）→ 503，防灌库攻击
 *   （每日摘要由主会话读走后标记 handledAt，腾出额度）
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, isNull, sql } from 'drizzle-orm';
import { feedback } from '../db/schema';

const RATE_MAX_DEFAULT = 5;
const RATE_WINDOW_MS_DEFAULT = 3_600_000;
const BOX_CAPACITY_DEFAULT = 500;
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

    // 蜜罐：正常用户看不到该字段；机器人填了 → 假成功但不入库。放最前，不耗限速配额。
    const website = typeof body.website === 'string' ? body.website.trim() : '';
    if (website) return reply.code(201).send({ ok: true });

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

    // 箱满熔断：未处理数达上限 → 503（并发略超可接受，注释于此）
    const capacity = Number(process.env.FEEDBACK_BOX_CAPACITY ?? BOX_CAPACITY_DEFAULT);
    const [countRow] = await app.db
      .select({ c: sql<number>`count(*)::int` })
      .from(feedback)
      .where(isNull(feedback.handledAt));
    if (Number(countRow?.c ?? 0) >= capacity) {
      return reply.code(503).send({ error: 'FEEDBACK_BOX_FULL' });
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

  // 摘要读取接口（主会话每日例行用）：ADMIN_TOKEN Bearer 保护；未配置 token → 一律 401（接口关闭）
  app.get('/feedback', async (req, reply) => {
    const token = process.env.ADMIN_TOKEN;
    if (!token || req.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
    const q = (req.query as { limit?: string }).limit;
    // limit 缺省 50；非纯数字 → 400（风格同名册）
    if (q !== undefined && !/^\d+$/.test(q)) {
      return reply.code(400).send({ error: 'INVALID_LIMIT' });
    }
    const limit = q === undefined ? 50 : Math.min(Math.max(Number(q), 1), 100);
    const rows = await app.db
      .select({
        id: feedback.id,
        message: feedback.message,
        contact: feedback.contact,
        page: feedback.page,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .where(isNull(feedback.handledAt))
      .orderBy(desc(feedback.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}
