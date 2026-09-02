/**
 * Playground 限流器（TDD）。
 * 规则：per-IP 并发 ≤2；per-IP 每小时 ≤10 次（滑动窗口）。
 * 拒绝时给 retryAfterSeconds（小时窗按最早一条过期时间算，并发满给 60 兜底）。
 */
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../rateLimit';

describe('RateLimiter', () => {
  it('首 acquire ok；release 后可再 acquire', () => {
    const rl = new RateLimiter();
    const t0 = 1_000_000;
    const a = rl.tryAcquire('ip1', t0);
    expect(a.ok).toBe(true);
    if (a.ok) rl.release(a.token);
    const b = rl.tryAcquire('ip1', t0 + 1);
    expect(b.ok).toBe(true);
  });

  it('并发 ≤2：第三个拒绝（retryAfterSeconds>0），release 一个后可进', () => {
    const rl = new RateLimiter();
    const t0 = 1_000_000;
    const a = rl.tryAcquire('ip1', t0);
    const b = rl.tryAcquire('ip1', t0);
    expect(a.ok && b.ok).toBe(true);
    const c = rl.tryAcquire('ip1', t0 + 1);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.retryAfterSeconds).toBeGreaterThan(0);
    if (a.ok) rl.release(a.token);
    const d = rl.tryAcquire('ip1', t0 + 2);
    expect(d.ok).toBe(true);
  });

  it('每小时 ≤10：第 11 次拒绝，retryAfter 指向最早一条过期；窗口滑出后恢复', () => {
    const rl = new RateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const r = rl.tryAcquire('ip1', t0 + i);
      expect(r.ok).toBe(true);
      if (r.ok) rl.release(r.token);
    }
    const r11 = rl.tryAcquire('ip1', t0 + 100);
    expect(r11.ok).toBe(false);
    if (!r11.ok) {
      // 最早一条 t0，过期时刻 t0+3600_000
      expect(r11.retryAfterSeconds).toBe(Math.ceil((t0 + 3600_000 - (t0 + 100)) / 1000));
    }
    // 1 小时后窗口清空 → 可再跑
    const later = rl.tryAcquire('ip1', t0 + 3600_001);
    expect(later.ok).toBe(true);
  });

  it('不同 IP 互不影响', () => {
    const rl = new RateLimiter();
    const t0 = 1_000_000;
    const a = rl.tryAcquire('ip1', t0);
    const b = rl.tryAcquire('ip1', t0);
    expect(a.ok && b.ok).toBe(true);
    expect(rl.tryAcquire('ip2', t0).ok).toBe(true);
    expect(rl.tryAcquire('ip1', t0 + 1).ok).toBe(false);
  });

  it('release 幂等（重复 release 不产生负并发）', () => {
    const rl = new RateLimiter();
    const t0 = 1_000_000;
    const a = rl.tryAcquire('ip1', t0);
    if (a.ok) {
      rl.release(a.token);
      rl.release(a.token);
    }
    const b = rl.tryAcquire('ip1', t0 + 1);
    const c = rl.tryAcquire('ip1', t0 + 1);
    expect(b.ok && c.ok).toBe(true);
  });
});
