import { describe, expect, it } from 'vitest';
import { A2aAgent } from '../a2a.js';

/** 最小合法 Agent Card（spec §3.1 必需字段）。 */
const CARD = {
  name: 'demo-a2a-agent',
  description: 'A2A test agent',
  url: 'http://agent.local/a2a',
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [{ id: 'chat', tags: ['chat'] }],
};

/** 记录调用的假 fetch：按 URL 前缀返回卡片或 message/send 响应。 */
function makeFetch(cardResponse: unknown, sendResponse: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith('/.well-known/agent-card.json')) {
      return new Response(JSON.stringify(cardResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(sendResponse), {
      status: 200,
      headers: { 'content-type': 'application/a2a+json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function sendOk(text: string) {
  return {
    jsonrpc: '2.0',
    id: 't1',
    result: { id: 't1', role: 'agent', parts: [{ kind: 'text', text }], taskId: 't1' },
  };
}

describe('A2aAgent', () => {
  it('happy path：拉卡 → message/send → result.parts 取文本', async () => {
    const { fetchImpl, calls } = makeFetch(CARD, sendOk('hello world'));
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    const out = await agent.reply('hi');
    expect(out).toBe('hello world');

    // 第一次调用 = 拉卡（RFC 8615 路径）；第二次 = message/send 发到 card.url
    expect(calls[0].url).toBe('http://agent.local/.well-known/agent-card.json');
    expect(calls[1].url).toBe('http://agent.local/a2a');
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('message/send');
    expect(body.params.message.parts[0].text).toBe('hi');
    const headers = calls[1].init?.headers as Record<string, string> | undefined;
    expect(headers?.['Content-Type']).toBe('application/a2a+json');
  });

  it('baseUrl 带尾斜杠也能拼对卡片路径', async () => {
    const { fetchImpl, calls } = makeFetch(CARD, sendOk('ok'));
    const agent = new A2aAgent('http://agent.local/', fetchImpl);
    await agent.reply('q');
    expect(calls[0].url).toBe('http://agent.local/.well-known/agent-card.json');
  });

  it('fallback：result.message.parts', async () => {
    const card = { ...CARD };
    const send = {
      jsonrpc: '2.0',
      id: 't1',
      result: { id: 't1', message: { parts: [{ kind: 'text', text: 'via message' }] } },
    };
    const { fetchImpl } = makeFetch(card, send);
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    expect(await agent.reply('q')).toBe('via message');
  });

  it('fallback：result.artifacts[*].parts（DELIVER 走 artifact）', async () => {
    const send = {
      jsonrpc: '2.0',
      id: 't1',
      result: {
        id: 't1',
        artifacts: [
          { parts: [{ kind: 'text', text: 'art1' }] },
          { parts: [{ kind: 'text', text: 'art2' }] },
        ],
      },
    };
    const { fetchImpl } = makeFetch(CARD, send);
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    expect(await agent.reply('q')).toBe('art1\nart2');
  });

  it('多个 text part 用换行拼接', async () => {
    const send = {
      jsonrpc: '2.0',
      id: 't1',
      result: {
        parts: [
          { kind: 'text', text: 'line1' },
          { kind: 'data', data: { x: 1 } },
          { kind: 'text', text: 'line2' },
        ],
      },
    };
    const { fetchImpl } = makeFetch(CARD, send);
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    expect(await agent.reply('q')).toBe('line1\nline2');
  });

  it('卡片 404 → 报错信息包含卡片路径与前置条件提示', async () => {
    const calls: { url: string }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push({ url: String(url) });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await expect(agent.reply('q')).rejects.toThrow(/\.well-known\/agent-card\.json/);
    await expect(agent.reply('q')).rejects.toThrow(/A2A agent/);
  });

  it('卡片坏 JSON → 报错', async () => {
    const fetchImpl = (async () =>
      new Response('<html>nope</html>', { status: 200 })) as typeof fetch;
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await expect(agent.reply('q')).rejects.toThrow(/agent-card/);
  });

  it('卡片网络错误 → 报错带人话提示', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await expect(agent.reply('q')).rejects.toThrow(/连不上|ECONNREFUSED/);
  });

  it('卡片缺 url 字段 → 报错', async () => {
    const bad = { ...CARD } as Record<string, unknown>;
    delete bad.url;
    const { fetchImpl } = makeFetch(bad, sendOk('x'));
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await expect(agent.reply('q')).rejects.toThrow(/url/);
  });

  it('JSON-RPC error 响应 → 报错', async () => {
    const send = { jsonrpc: '2.0', id: 't1', error: { code: -32601, message: 'method not found' } };
    const { fetchImpl } = makeFetch(CARD, send);
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await expect(agent.reply('q')).rejects.toThrow(/method not found|-32601|message\/send/);
  });

  it('message/send 非 2xx → 报错带状态码', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/.well-known/agent-card.json')) {
        return new Response(JSON.stringify(CARD), { status: 200 });
      }
      return new Response('boom', { status: 500 });
    }) as typeof fetch;
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await expect(agent.reply('q')).rejects.toThrow(/500/);
  });

  it('响应没有可提取的文本 part → 报错', async () => {
    const send = {
      jsonrpc: '2.0',
      id: 't1',
      result: { parts: [{ kind: 'data', data: { x: 1 } }] },
    };
    const { fetchImpl } = makeFetch(CARD, send);
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await expect(agent.reply('q')).rejects.toThrow(/text|parts|文本/i);
  });

  it('卡片按 agent 实例缓存：两次 reply 只拉一次卡', async () => {
    const { fetchImpl, calls } = makeFetch(CARD, sendOk('ok'));
    const agent = new A2aAgent('http://agent.local', fetchImpl);
    await agent.reply('q1');
    await agent.reply('q2');
    expect(calls.filter((c) => c.url.endsWith('/.well-known/agent-card.json')).length).toBe(1);
    expect(calls.length).toBe(3);
  });
});
