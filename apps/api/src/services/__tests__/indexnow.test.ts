/**
 * IndexNow 收录服务（2026-10-07）：纯函数 + 可注入 fetch 的契约测试。
 *
 * 红线：
 * - 未设 INDEXNOW_KEY → no-op（返回 false，且绝不发外网请求）；
 * - 200/202 → true；其他 → false；
 * - 抛错 → false（绝不冒泡）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentReportUrl, indexNowKey, submitIndexNow } from '../../services/indexnow';

const ORIG = process.env.INDEXNOW_KEY;

afterEach(() => {
  if (ORIG === undefined) delete process.env.INDEXNOW_KEY;
  else process.env.INDEXNOW_KEY = ORIG;
});

describe('indexNowKey', () => {
  it('未设 / 空串 → null', () => {
    delete process.env.INDEXNOW_KEY;
    expect(indexNowKey()).toBeNull();
    process.env.INDEXNOW_KEY = '   ';
    expect(indexNowKey()).toBeNull();
  });

  it('设了 → 返回 key', () => {
    process.env.INDEXNOW_KEY = 'abc123';
    expect(indexNowKey()).toBe('abc123');
  });
});

describe('agentReportUrl', () => {
  it('canonical = name 版，且做 URL 编码', () => {
    expect(agentReportUrl('jiuwenswarm')).toBe('https://sealit.cc/agent/jiuwenswarm');
    expect(agentReportUrl('a b/c')).toBe('https://sealit.cc/agent/a%20b%2Fc');
  });
});

describe('submitIndexNow', () => {
  it('未设 key → 不发请求，返回 false', async () => {
    delete process.env.INDEXNOW_KEY;
    const f = vi.fn();
    const ok = await submitIndexNow(['https://sealit.cc/agent/x'], f as unknown as typeof fetch);
    expect(ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('设了 key → POST 到 indexnow，200 → true', async () => {
    process.env.INDEXNOW_KEY = 'k1';
    const f = vi.fn(async () => new Response('', { status: 200 }));
    const ok = await submitIndexNow(['https://sealit.cc/agent/x'], f as unknown as typeof fetch);
    expect(ok).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    const body = JSON.parse(init.body) as { host: string; key: string; urlList: string[] };
    expect(body.host).toBe('sealit.cc');
    expect(body.key).toBe('k1');
    expect(body.urlList).toEqual(['https://sealit.cc/agent/x']);
  });

  it('202 也算成功（已接受待处理）', async () => {
    process.env.INDEXNOW_KEY = 'k1';
    const f = vi.fn(async () => new Response('', { status: 202 }));
    expect(await submitIndexNow(['https://sealit.cc/agent/x'], f as unknown as typeof fetch)).toBe(
      true,
    );
  });

  it('非 2xx（如 422）→ false', async () => {
    process.env.INDEXNOW_KEY = 'k1';
    const f = vi.fn(async () => new Response('', { status: 422 }));
    expect(await submitIndexNow(['https://sealit.cc/agent/x'], f as unknown as typeof fetch)).toBe(
      false,
    );
  });

  it('fetch 抛错 → false（绝不冒泡）', async () => {
    process.env.INDEXNOW_KEY = 'k1';
    const f = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await submitIndexNow(['https://sealit.cc/agent/x'], f as unknown as typeof fetch)).toBe(
      false,
    );
  });

  it('空 url 列表 → false（不发请求）', async () => {
    process.env.INDEXNOW_KEY = 'k1';
    const f = vi.fn();
    expect(await submitIndexNow([], f as unknown as typeof fetch)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
