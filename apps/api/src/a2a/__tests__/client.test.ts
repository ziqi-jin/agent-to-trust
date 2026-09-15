import { describe, expect, it, vi } from 'vitest';

import type { AclAgentCard } from '../card.js';
import {
  sendA2aMessage,
  type A2aOutboundMessage,
  type A2aPart,
} from '../client.js';

/**
 * Task 4: A2A 客户端 message/send 单轮（spec §3.2）。
 * 纯接入层：不碰 DB；网络经 fetchImpl 注入（不真发请求）。
 * 平台作为客户端向用户 agent 发 JSON-RPC message/send，拿回它的一轮回复 parts。
 */

const CARD_URL = 'https://user.example/a2a';

function makeCard(overrides: Partial<AclAgentCard> = {}): AclAgentCard {
  return {
    name: 'User Agent',
    description: 'a negotiation agent',
    url: CARD_URL,
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{ id: 'negotiate', tags: ['negotiation'] }],
    ...overrides,
  } as AclAgentCard;
}

function makeMsg(overrides: Partial<A2aOutboundMessage> = {}): A2aOutboundMessage {
  return {
    contextId: 'ctx-1',
    taskId: 'task-1',
    text: '上一轮：对方报价 120；本轮请给出还价。',
    metadata: { acl: { sessionId: 'sess-1', round: 2, deadlineMs: 60_000 } },
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

/** 记录请求参数并返回同一 body 的 fetch 假实现。 */
function capturingFetch(
  body: unknown,
  status = 200,
): { fn: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse(body, status);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('sendA2aMessage — 成功路径', () => {
  it('result.parts → ok:true 且 parts 透传', async () => {
    const parts: A2aPart[] = [{ kind: 'text', text: '接受' }];
    const { fn } = capturingFetch({ jsonrpc: '2.0', id: 'task-1', result: { parts } });

    const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 'tok-1', fetchImpl: fn });

    expect(res).toEqual({ ok: true, parts });
  });

  it('result.message.parts 形式也能取到 parts', async () => {
    const parts: A2aPart[] = [{ kind: 'text', text: '还价 110' }];
    const { fn } = capturingFetch({
      jsonrpc: '2.0',
      id: 'task-1',
      result: { message: { role: 'agent', parts } },
    });

    const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 'tok-1', fetchImpl: fn });

    expect(res).toEqual({ ok: true, parts });
  });

  it('result.artifacts[0].parts 形式（DELIVER）也能取到', async () => {
    const artifactParts: A2aPart[] = [
      { kind: 'data', data: { action: 'deliver', price: 100 } },
    ];
    const { fn } = capturingFetch({
      jsonrpc: '2.0',
      id: 'task-1',
      result: { artifacts: [{ parts: artifactParts }] },
    });

    const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 'tok-1', fetchImpl: fn });

    expect(res).toEqual({ ok: true, parts: artifactParts });
  });
});

describe('sendA2aMessage — 请求组装', () => {
  it('URL/method/头/body/metadata 均符合 spec §3.2', async () => {
    const msg = makeMsg();
    const { fn, calls } = capturingFetch({ jsonrpc: '2.0', id: 'task-1', result: { parts: [] } });

    await sendA2aMessage(makeCard(), msg, { token: 'tok-abc', fetchImpl: fn });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(CARD_URL);
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/a2a+json');
    expect(headers['Authorization']).toBe('Bearer tok-abc');

    const body = JSON.parse(init.body as string);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(msg.taskId);
    expect(body.method).toBe('message/send');
    expect(body.params.contextId).toBe(msg.contextId);
    expect(body.params.taskId).toBe(msg.taskId);
    expect(body.params.message.role).toBe('user');
    expect(body.params.message.parts[0].text).toBe(msg.text);
    expect(body.params.message.metadata).toEqual(msg.metadata);
    expect(body.params.message.metadata.acl).toEqual({
      sessionId: 'sess-1',
      round: 2,
      deadlineMs: 60_000,
    });
  });

  it('无 token 时不加 Authorization 头（且不影响请求）', async () => {
    const { fn, calls } = capturingFetch({ jsonrpc: '2.0', id: 'task-1', result: { parts: [] } });

    const res = await sendA2aMessage(makeCard(), makeMsg(), { fetchImpl: fn });

    expect(res.ok).toBe(true);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/a2a+json');
  });
});

describe('sendA2aMessage — 失败映射（绝不抛）', () => {
  it('HTTP 404 → {ok:false, reason:http, status:404}', async () => {
    const { fn } = capturingFetch({ error: 'not found' }, 404);
    const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 't', fetchImpl: fn });
    expect(res).toEqual({ ok: false, reason: 'http', status: 404 });
  });

  it('坏 JSON → {ok:false, reason:parse}', async () => {
    const fn = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      }) as unknown as Response) as unknown as typeof fetch;

    const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 't', fetchImpl: fn });
    expect(res).toEqual({ ok: false, reason: 'parse' });
  });

  it('缺 result（JSON-RPC error）→ {ok:false, reason:parse}', async () => {
    const { fn } = capturingFetch({
      jsonrpc: '2.0',
      id: 'task-1',
      error: { code: -32601, message: 'method not found' },
    });
    const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 't', fetchImpl: fn });
    expect(res).toEqual({ ok: false, reason: 'parse' });
  });

  it('fetchImpl 抛网络错 → {ok:false}，不抛', async () => {
    const fn = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 't', fetchImpl: fn });
    expect(res.ok).toBe(false);
    expect(res).toEqual({ ok: false, reason: 'http' });
  });

  it('超时（fetch 永不 resolve）→ {ok:false, reason:timeout}', async () => {
    const fn = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const res = await sendA2aMessage(makeCard(), makeMsg(), {
      token: 't',
      fetchImpl: fn,
      timeoutMs: 10,
    });
    expect(res).toEqual({ ok: false, reason: 'timeout' });
  });

  it('card.url 缺失 → {ok:false, reason:http}，不抛', async () => {
    const fn = (async () => jsonResponse({ jsonrpc: '2.0', result: { parts: [] } })) as unknown as typeof fetch;
    const res = await sendA2aMessage(
      { url: undefined } as unknown as AclAgentCard,
      makeMsg(),
      { token: 't', fetchImpl: fn },
    );
    expect(res).toEqual({ ok: false, reason: 'http' });
  });
});

describe('sendA2aMessage — 默认值', () => {
  it('默认超时 60s（vi fake timers 下不提前超时）', async () => {
    vi.useFakeTimers();
    try {
      const parts: A2aPart[] = [{ kind: 'text', text: 'ok' }];
      const { fn } = capturingFetch({ jsonrpc: '2.0', id: 'task-1', result: { parts } });
      const res = await sendA2aMessage(makeCard(), makeMsg(), { token: 't', fetchImpl: fn });
      expect(res).toEqual({ ok: true, parts });
    } finally {
      vi.useRealTimers();
    }
  });
});
