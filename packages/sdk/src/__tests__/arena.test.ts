import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureKeypair, verifyPayload } from '../keys.js';
import {
  ARENA_EVENT_TYPES,
  contextToPrompt,
  parseAgentReply,
  runJoinLoop,
} from '../arena.js';
import type { ArenaContext } from '../arena.js';
import type { SealitAgent } from '../agent/types.js';

const apiBase = 'https://api.test';

/* ---------------- ARENA_EVENT_TYPES ---------------- */

describe('ARENA_EVENT_TYPES', () => {
  it('对齐服务端 7 种事件', () => {
    expect([...ARENA_EVENT_TYPES]).toEqual([
      'OFFER',
      'NEGOTIATE',
      'ACCEPT',
      'REJECT',
      'DELIVER',
      'VERIFY_RESULT',
      'SETTLE',
    ]);
  });
});

/* ---------------- contextToPrompt ---------------- */

function ctx(overrides: Partial<ArenaContext> = {}): ArenaContext {
  return {
    role: 'buyer',
    scenario: '标准采购',
    taskSpec: { item: '键盘', qty: 10 },
    budget: 100,
    deadline: null,
    round: 1,
    maxRounds: 20,
    events: [],
    ...overrides,
  };
}

describe('contextToPrompt', () => {
  it('buyer 空会话包含先手出价提示与预算', () => {
    const p = contextToPrompt(ctx());
    expect(p).toContain('买家');
    expect(p).toContain('标准采购');
    expect(p).toContain('100');
    expect(p).toContain('OFFER');
    expect(p).toContain('先出价');
  });

  it('seller 空会话提示等待', () => {
    const p = contextToPrompt(ctx({ role: 'seller' }));
    expect(p).toContain('卖家');
    expect(p).toContain('等待买家出价');
  });

  it('包含事件历史与完整动作菜单', () => {
    const p = contextToPrompt(
      ctx({
        round: 2,
        events: [{ seq: 1, type: 'OFFER', fromAgent: 'agent-s', payload: { price: 50 }, ts: 't' }],
      }),
    );
    expect(p).toContain('#1 [OFFER]');
    expect(p).toContain('{"price":50}');
    for (const t of ARENA_EVENT_TYPES) expect(p).toContain(t);
    expect(p).toContain('2/20');
  });
});

/* ---------------- parseAgentReply ---------------- */

describe('parseAgentReply', () => {
  it('解析裸 JSON', () => {
    expect(parseAgentReply('{"type":"OFFER","payload":{"price":42}}')).toEqual({
      type: 'OFFER',
      payload: { price: 42 },
    });
  });

  it('解析 ```json 围栏', () => {
    const text = '好的，我的决定：\n```json\n{"type":"ACCEPT","payload":{"price":42}}\n```';
    expect(parseAgentReply(text)).toEqual({ type: 'ACCEPT', payload: { price: 42 } });
  });

  it('从闲聊文本中提取最后一个平衡的 JSON 对象', () => {
    const text =
      '先分析一下 {市场行情比较好}。我的结论是 {"type":"NEGOTIATE","payload":{"note":"便宜 5 块就成交"}} 谢谢';
    expect(parseAgentReply(text)).toEqual({
      type: 'NEGOTIATE',
      payload: { note: '便宜 5 块就成交' },
    });
  });

  it('非法 type 返回 null', () => {
    expect(parseAgentReply('{"type":"HACK","payload":{}}')).toBeNull();
  });

  it('payload 为数组返回 null', () => {
    expect(parseAgentReply('{"type":"OFFER","payload":[1,2]}')).toBeNull();
  });

  it('垃圾文本/空串返回 null', () => {
    expect(parseAgentReply('我考虑一下再答复你')).toBeNull();
    expect(parseAgentReply('')).toBeNull();
  });
});

/* ---------------- runJoinLoop ---------------- */

interface Call {
  path: string;
  body: unknown;
}

type Handler = {
  match: (path: string) => boolean;
  handle: (body: unknown) => { status?: number; body: unknown };
};

function makeFetch(handlers: Handler[], calls: Call[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(url.toString());
    const path = u.pathname + u.search;
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ path, body });
    const h = handlers.find((x) => x.match(path));
    if (!h) return new Response(JSON.stringify({ error: 'no handler' }), { status: 404 });
    const r = h.handle(body);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
}

function sessionJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'as-1',
    status: 'open',
    scenario: '标准采购',
    taskSpec: { item: '键盘' },
    budget: 100,
    deadline: null,
    buyerAgentId: 'agent-b',
    sellerAgentId: 'agent-s',
    ...overrides,
  };
}

/** 回复队列 agent：按调用次数返回预设文本。 */
function queueAgent(replies: string[]): SealitAgent & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    reply: async (prompt: string) => {
      calls.push(prompt);
      return replies[calls.length - 1] ?? '{"type":"NEGOTIATE","payload":{"note":"x"}}';
    },
  };
}

function baseHandlers(calls: Call[], eventsByPoll: unknown[][]): Handler[] {
  return [
    {
      match: (p) => p === '/arena/register',
      handle: () => ({ status: 201, body: { agentId: 'agent-b', reused: false } }),
    },
    {
      match: (p) => p === '/arena/sessions/as-1',
      handle: () => ({ body: sessionJson() }),
    },
    {
      match: (p) => p.startsWith('/arena/sessions/as-1/events?'), // GET 轮询/初始拉取（带 query）
      handle: (_body) => ({ body: { events: eventsByPoll.shift() ?? [] } }),
    },
    {
      match: (p) => p === '/arena/sessions/as-1/events', // POST 推事件（无 query）
      handle: () => ({ status: 201, body: { ok: true } }),
    },
  ];
}

describe('runJoinLoop', () => {
  it('buyer 先手 → 还价 → 验收 → 补发 SETTLE，全程签名可验', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers = baseHandlers(calls, [
      [], // 初始拉取（after=0，空会话）
      // poll 1：对家 ACCEPT（seq 2）
      [{ seq: 2, type: 'ACCEPT', fromAgent: 'agent-s', payload: { price: 30 }, ts: 't2' }],
      // poll 2：对家 DELIVER（seq 4）
      [{ seq: 4, type: 'DELIVER', fromAgent: 'agent-s', payload: { item: '键盘 x10' }, ts: 't4' }],
      [],
      [],
    ]);
    // 终态：第 2 次 GET session（结束前确认）返回 settled；join 开始时第 1 次仍为 open
    let sessionGets = 0;
    handlers.splice(1, 1, {
      match: (p) => p === '/arena/sessions/as-1',
      handle: () => {
        sessionGets += 1;
        return { body: sessionJson({ status: sessionGets >= 2 ? 'settled' : 'open' }) };
      },
    });

    const agent = queueAgent([
      '{"type":"OFFER","payload":{"price":25,"note":"首单优惠"}}',
      '{"type":"NEGOTIATE","payload":{"note":"确认按 30 成交"}}',
      '{"type":"VERIFY_RESULT","payload":{"verdict":"pass","onTime":true}}',
    ]);

    const result = await runJoinLoop({
      agent,
      apiBase,
      sessionId: 'as-1',
      name: 'buyer-x',
      dir,
      keypair,
      fetchImpl: makeFetch(handlers, calls),
      log: () => {},
    });

    expect(result).toMatchObject({
      agentId: 'agent-b',
      role: 'buyer',
      stoppedReason: 'settled',
      finalStatus: 'settled',
      eventsSent: 4,
    });

    // 自己发出的事件：seq 1 OFFER / 3 NEGOTIATE / 5 VERIFY_RESULT / 6 SETTLE，全部可验签
    const posts = calls.filter((c) => c.path === '/arena/sessions/as-1/events' && c.body);
    const seqs = posts.map((c) => (c.body as { seq: number }).seq);
    expect(seqs).toEqual([1, 3, 5, 6]);
    for (const c of posts) {
      const b = c.body as {
        sessionId: string;
        seq: number;
        type: string;
        fromAgent: string;
        payload: Record<string, unknown>;
        nonce: string;
        ts: number;
        sig: string;
        pubkey: string;
      };
      expect(b.fromAgent).toBe('agent-b');
      expect(b.pubkey).toBe(keypair.publicKeyPem);
      const ok = verifyPayload(
        keypair.publicKeyPem,
        { sessionId: b.sessionId, seq: b.seq, type: b.type, fromAgent: b.fromAgent, payload: b.payload, nonce: b.nonce, ts: b.ts },
        b.sig,
      );
      expect(ok).toBe(true);
    }
    // agent 被问询 3 次（先手 + ACCEPT 后 + DELIVER 后）
    expect(agent.calls.length).toBe(3);
  });

  it('连续 3 次空轮询 → idle-timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers = baseHandlers(calls, [[], [], []]); // 3 次空
    const agent = queueAgent(['{"type":"OFFER","payload":{"price":10}}']);

    const result = await runJoinLoop({
      agent,
      apiBase,
      sessionId: 'as-1',
      dir,
      keypair,
      fetchImpl: makeFetch(handlers, calls),
      log: () => {},
    });
    expect(result.stoppedReason).toBe('idle-timeout');
    expect(result.eventsSent).toBe(1); // 只有先手 OFFER
  });

  it('对家 REJECT → 立即终止', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers = baseHandlers(calls, [
      [], // 初始拉取
      [{ seq: 2, type: 'REJECT', fromAgent: 'agent-s', payload: { reason: '价太低' }, ts: 't' }],
    ]);
    // 终态：REJECT 后服务端置 failed（第 2 次 GET session）
    let sessionGets = 0;
    handlers.splice(1, 1, {
      match: (p) => p === '/arena/sessions/as-1',
      handle: () => {
        sessionGets += 1;
        return { body: sessionJson({ status: sessionGets >= 2 ? 'failed' : 'open' }) };
      },
    });
    const agent = queueAgent(['{"type":"OFFER","payload":{"price":1}}']);

    const result = await runJoinLoop({
      agent,
      apiBase,
      sessionId: 'as-1',
      dir,
      keypair,
      fetchImpl: makeFetch(handlers, calls),
      log: () => {},
    });
    expect(result.stoppedReason).toBe('rejected');
    expect(result.finalStatus).toBe('failed');
  });

  it('会话已结算 → session-closed 零事件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers: Handler[] = [
      {
        match: (p) => p === '/arena/register',
        handle: () => ({ status: 201, body: { agentId: 'agent-b', reused: true } }),
      },
      {
        match: (p) => p === '/arena/sessions/as-1',
        handle: () => ({ body: sessionJson({ status: 'settled' }) }),
      },
    ];

    const result = await runJoinLoop({
      agent: queueAgent([]),
      apiBase,
      sessionId: 'as-1',
      dir,
      keypair,
      fetchImpl: makeFetch(handlers, calls),
      log: () => {},
    });
    expect(result.stoppedReason).toBe('session-closed');
    expect(result.eventsSent).toBe(0);
  });

  it('非会话参与者 → 抛错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers: Handler[] = [
      {
        match: (p) => p === '/arena/register',
        handle: () => ({ status: 201, body: { agentId: 'agent-out', reused: false } }),
      },
      {
        match: (p) => p === '/arena/sessions/as-1',
        handle: () => ({ body: sessionJson() }),
      },
    ];

    await expect(
      runJoinLoop({
        agent: queueAgent([]),
        apiBase,
        sessionId: 'as-1',
        dir,
        keypair,
        fetchImpl: makeFetch(handlers, calls),
        log: () => {},
      }),
    ).rejects.toThrow('不包含本 agent');
  });

  it('注册被拒（同名异钥）→ 抛 403', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers: Handler[] = [
      {
        match: (p) => p === '/arena/register',
        handle: () => ({ status: 403, body: { error: '该 agent 名称已被其他密钥绑定' } }),
      },
    ];

    await expect(
      runJoinLoop({
        agent: queueAgent([]),
        apiBase,
        sessionId: 'as-1',
        name: 'dup',
        dir,
        keypair,
        fetchImpl: makeFetch(handlers, calls),
        log: () => {},
      }),
    ).rejects.toThrow('403');
  });

  it('对家抢先结算（补发 SETTLE 撞 409）→ 无害退出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers = baseHandlers(calls, [
      [], // 初始拉取
      [{ seq: 2, type: 'VERIFY_RESULT', fromAgent: 'agent-s', payload: { verdict: 'pass', onTime: true }, ts: 't' }],
    ]);
    // SETTLE 的 POST 返回 409（对家已结算）
    handlers.splice(3, 1, {
      match: (p) => p === '/arena/sessions/as-1/events',
      handle: (body) =>
        (body as { type?: string }).type === 'SETTLE'
          ? { status: 409, body: { error: 'nonce 重放或 seq 冲突' } }
          : { status: 201, body: { ok: true } },
    });
    const agent = queueAgent(['{"type":"OFFER","payload":{"price":10}}']);

    const result = await runJoinLoop({
      agent,
      apiBase,
      sessionId: 'as-1',
      dir,
      keypair,
      fetchImpl: makeFetch(handlers, calls),
      log: () => {},
    });
    expect(result.stoppedReason).toBe('settled'); // 409 被吞，视为已结算
    expect(result.eventsSent).toBe(1); // 只有 OFFER 成功计入
  });

  it('agent 回复无法解析 → 回退 NEGOTIATE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-join-'));
    const keypair = ensureKeypair(dir);
    const calls: Call[] = [];
    const handlers = baseHandlers(calls, [
      [], // 初始拉取
      [{ seq: 2, type: 'ACCEPT', fromAgent: 'agent-s', payload: { price: 30 }, ts: 't' }],
      [],
      [],
      [],
    ]);
    const agent = queueAgent(['{"type":"OFFER","payload":{"price":10}}', '我觉得可以，就这样吧']);

    const result = await runJoinLoop({
      agent,
      apiBase,
      sessionId: 'as-1',
      dir,
      keypair,
      fetchImpl: makeFetch(handlers, calls),
      log: () => {},
    });
    const posts = calls.filter((c) => c.path === '/arena/sessions/as-1/events' && c.body);
    const types = posts.map((c) => (c.body as { type: string }).type);
    expect(types).toContain('NEGOTIATE'); // 回退事件
    expect(result.eventsSent).toBeGreaterThanOrEqual(2);
  });
});
