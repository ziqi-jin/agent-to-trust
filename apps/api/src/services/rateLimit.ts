/**
 * 统一内存限流桶（S4-B M2，plan §Task 12「统一内存桶」）。
 *
 * 模式与 routes/ingest.ts、routes/tradeEvidence.ts 的内置桶同款（MVP 不引依赖），
 * 差异点：
 * - 每个路由插件闭包内 create → 每 buildApp 实例独立桶（测试文件/实例互不串桶）；
 * - 机会性清理过期 key（T9-10 评审修复项模式：访问时顺带 sweep，
 *   防长期运行内存随 IP 数缓涨）。
 *
 * 用法：const limited = createRateLimiter({ max: 60, windowMs: 60_000 });
 *      处理器首行 if (limited(req)) return reply.code(429)...
 */

import type { FastifyRequest } from 'fastify';

export interface RateLimitOpts {
  /** 窗口内允许的最大请求数。 */
  max: number;
  /** 窗口时长（毫秒）。 */
  windowMs: number;
}

export function createRateLimiter({ max, windowMs }: RateLimitOpts) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = 0;

  return function limited(req: FastifyRequest): boolean {
    const now = Date.now();
    // 机会性清理：每窗口至多一次全表扫描，剔除已过期 key
    if (now >= nextSweepAt) {
      nextSweepAt = now + windowMs;
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt < now) buckets.delete(key);
      }
    }
    const ip = req.ip ?? 'unknown';
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
    } else if (bucket.count >= max) {
      return true;
    } else {
      bucket.count += 1;
    }
    return false;
  };
}
