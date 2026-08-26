import { describe, it, expect } from 'vitest';
import { DeepSeekClient } from '../src/deepseek';

const fake = (payload: unknown, ok = true, status = 200) =>
  (async (_url: string, _init: unknown) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => payload,
  })) as never;

describe('[正确性] DeepSeekClient', () => {
  it('chat 调用正确的 URL 与鉴权头', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    const client = new DeepSeekClient({
      apiKey: 'sk-test',
      fetchImpl: (async (url: string, init: { headers: Record<string, string> }) => {
        capturedUrl = url;
        capturedHeaders = init.headers;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
            model: 'deepseek-v4-flash',
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        };
      }) as never,
    });
    const res = await client.chat([{ role: 'user', content: 'hello' }], { model: 'deepseek-v4-flash' });
    expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(capturedHeaders.Authorization).toBe('Bearer sk-test');
    expect(res.content).toBe('hi');
    expect(res.model).toBe('deepseek-v4-flash');
    expect(res.usage.totalTokens).toBe(2);
  });

  it('非 2xx 抛出错误', async () => {
    const client = new DeepSeekClient({ apiKey: 'x', fetchImpl: fake({}, false, 401) });
    await expect(client.chat([{ role: 'user', content: 'x' }], { model: 'm' })).rejects.toThrow(/401/);
  });

  it('缺 choices 时 content 为空串', async () => {
    const client = new DeepSeekClient({ apiKey: 'x', fetchImpl: fake({}) });
    const res = await client.chat([{ role: 'user', content: 'x' }], { model: 'm' });
    expect(res.content).toBe('');
  });
});
