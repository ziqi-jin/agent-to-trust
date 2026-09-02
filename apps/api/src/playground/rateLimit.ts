/**
 * Playground 限流器（内存态，单进程）。
 * 规则：per-IP 并发 ≤2；per-IP 每小时 ≤10 次（滑动窗口，acquisition 成功才记数）。
 * 拒绝语义：小时窗超 → retryAfterSeconds = 距最早一条过期剩余秒数；并发满 → 60 兜底。
 */
export interface ReleaseToken {
  ip: string;
  startedAt: number;
}

const HOURLY_LIMIT = 10;
const CONCURRENT_LIMIT = 2;
const HOUR_MS = 3600_000;
const CONCURRENT_FALLBACK_RETRY_SECONDS = 60;

export class RateLimiter {
  /** 每 IP 的成功 acquisition 时间戳（滑动窗口）。 */
  private readonly windows = new Map<string, number[]>();
  /** 每 IP 在跑的会话（release 时移除）。 */
  private readonly concurrent = new Map<string, Set<ReleaseToken>>();

  tryAcquire(ip: string, now: number): { ok: true; token: ReleaseToken } | { ok: false; retryAfterSeconds: number } {
    const window = (this.windows.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
    if (window.length >= HOURLY_LIMIT) {
      this.windows.set(ip, window);
      const retryAfterSeconds = Math.max(1, Math.ceil((window[0] + HOUR_MS - now) / 1000));
      return { ok: false, retryAfterSeconds };
    }
    const running = this.concurrent.get(ip) ?? new Set<ReleaseToken>();
    if (running.size >= CONCURRENT_LIMIT) {
      this.windows.set(ip, window);
      return { ok: false, retryAfterSeconds: CONCURRENT_FALLBACK_RETRY_SECONDS };
    }
    window.push(now);
    this.windows.set(ip, window);
    const token: ReleaseToken = { ip, startedAt: now };
    running.add(token);
    this.concurrent.set(ip, running);
    return { ok: true, token };
  }

  release(token: ReleaseToken): void {
    this.concurrent.get(token.ip)?.delete(token);
  }
}
