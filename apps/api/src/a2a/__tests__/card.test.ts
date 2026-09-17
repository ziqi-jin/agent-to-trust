import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __clearCardCache, fetchAgentCard, isArenaReady, type AclAgentCard } from '../card.js';

/**
 * Task 3: 用户 A2A Agent Card 读取 + Arena 分流 + TTL 缓存。
 * 纯接入层：不碰 DB；网络通过 fetchImpl 注入（不真发请求）。
 * 分流规则（spec §3.1）：x-a2t.arenaReady === true 且至少一个 skill 的 tags 含 negotiation|trade。
 */

const CARD_URL = 'https://user.example/.well-known/agent-card.json';

/** 造一张合法 & Arena-ready 的卡（可覆盖任意字段）。 */
function makeCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'User Agent',
    description: 'a negotiation agent',
    url: 'https://user.example/a2a',
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    securitySchemes: { bearer: { scheme: 'bearer' } },
    skills: [{ id: 'negotiate', tags: ['negotiation', 'pricing'] }],
    'x-a2t': { arenaReady: true, protocolVersion: '2026.09' },
    ...overrides,
  };
}

/** 造一个假 Response。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 每次都返回同一 body 的 fetch 假实现，并统计调用次数。 */
function countingFetch(body: unknown, status = 200): { fn: typeof fetch; calls: () => number } {
  let calls = 0;
  const fn = (async () => {
    calls += 1;
    return jsonResponse(body, status);
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

beforeEach(() => {
  __clearCardCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchAgentCard — 成功路径', () => {
  it('合法卡 → ok:true 且 card 透传', async () => {
    const card = makeCard();
    const { fn } = countingFetch(card);
    const r = await fetchAgentCard(CARD_URL, { fetchImpl: fn });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.card.name).toBe('User Agent');
  });
});

describe('isArenaReady — 分流规则', () => {
  it('arenaReady=true + tags 含 negotiation → true', () => {
    expect(isArenaReady(makeCard() as unknown as AclAgentCard)).toBe(true);
  });

  it('arenaReady=true + tags 含 trade → true', () => {
    const card = makeCard({ skills: [{ id: 's', tags: ['trade'] }] });
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(true);
  });

  it('多 skill 只要有一个带 negotiation → true', () => {
    const card = makeCard({
      skills: [
        { id: 'a', tags: ['chat'] },
        { id: 'b', tags: ['other', 'trade'] },
      ],
    });
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(true);
  });

  it('arenaReady=false → false', () => {
    const card = makeCard({ 'x-a2t': { arenaReady: false, protocolVersion: '2026.09' } });
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });

  it('x-a2t 缺失 → false', () => {
    const card = makeCard();
    delete card['x-a2t'];
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });

  it('x-a2t.arenaReady 非布尔 true（如 "true" 字符串）→ false', () => {
    const card = makeCard({ 'x-a2t': { arenaReady: 'true' } });
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });

  it('tags 不含 negotiation/trade → false', () => {
    const card = makeCard({ skills: [{ id: 's', tags: ['chat', 'summarize'] }] });
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });

  it('skills 为空数组 → false', () => {
    const card = makeCard({ skills: [] });
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });

  it('skills 缺失 → false', () => {
    const card = makeCard();
    delete card.skills;
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });

  it('畸形 skills（不是数组）→ false 不抛', () => {
    const card = makeCard({ skills: { id: 's', tags: ['negotiation'] } });
    expect(() => isArenaReady(card as unknown as AclAgentCard)).not.toThrow();
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });

  it('畸形 tags（不是数组）→ false 不抛', () => {
    const card = makeCard({ skills: [{ id: 's', tags: 'negotiation' }] });
    expect(() => isArenaReady(card as unknown as AclAgentCard)).not.toThrow();
    expect(isArenaReady(card as unknown as AclAgentCard)).toBe(false);
  });
});

describe('fetchAgentCard — 失败路径', () => {
  it('HTTP 404 → ok:false reason http-404', async () => {
    const { fn } = countingFetch({}, 404);
    const r = await fetchAgentCard(CARD_URL, { fetchImpl: fn });
    expect(r).toEqual({ ok: false, reason: 'http-404' });
  });

  it('HTTP 500（非 200）→ ok:false，reason 可区分', async () => {
    const { fn } = countingFetch({}, 500);
    const r = await fetchAgentCard(CARD_URL, { fetchImpl: fn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('http-500');
  });

  it('超时（默认 5000ms 无响应）→ ok:false reason timeout', async () => {
    vi.useFakeTimers();
    const never: typeof fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const p = fetchAgentCard(CARD_URL, { fetchImpl: never });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('坏 JSON → ok:false reason bad-json', async () => {
    const bad = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    })) as unknown as typeof fetch;
    const r = await fetchAgentCard(CARD_URL, { fetchImpl: bad });
    expect(r).toEqual({ ok: false, reason: 'bad-json' });
  });

  it('返回数组 → ok:false reason not-object', async () => {
    const { fn } = countingFetch([1, 2]);
    const r = await fetchAgentCard(CARD_URL, { fetchImpl: fn });
    expect(r).toEqual({ ok: false, reason: 'not-object' });
  });

  it('返回 null → ok:false reason not-object', async () => {
    const { fn } = countingFetch(null);
    const r = await fetchAgentCard(CARD_URL, { fetchImpl: fn });
    expect(r).toEqual({ ok: false, reason: 'not-object' });
  });

  it('网络错误（fetch 直抛）→ ok:false，不抛异常', async () => {
    const boom = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await fetchAgentCard(CARD_URL, { fetchImpl: boom });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('network-error');
  });
});

describe('fetchAgentCard — TTL 缓存', () => {
  it('同一 URL 连续两次 → 只发一次网络请求', async () => {
    const { fn, calls } = countingFetch(makeCard());
    const a = await fetchAgentCard(CARD_URL, { fetchImpl: fn, cacheMs: 60_000 });
    const b = await fetchAgentCard(CARD_URL, { fetchImpl: fn, cacheMs: 60_000 });
    expect(calls()).toBe(1);
    expect(a.ok && b.ok).toBe(true);
  });

  it('cacheMs:0 → 不缓存，第二次重新请求', async () => {
    const { fn, calls } = countingFetch(makeCard());
    await fetchAgentCard(CARD_URL, { fetchImpl: fn, cacheMs: 0 });
    await fetchAgentCard(CARD_URL, { fetchImpl: fn, cacheMs: 0 });
    expect(calls()).toBe(2);
  });

  it('不同 URL 各请求一次', async () => {
    const { fn, calls } = countingFetch(makeCard());
    await fetchAgentCard('https://a.example/.well-known/agent-card.json', { fetchImpl: fn, cacheMs: 60_000 });
    await fetchAgentCard('https://b.example/.well-known/agent-card.json', { fetchImpl: fn, cacheMs: 60_000 });
    expect(calls()).toBe(2);
  });
});
