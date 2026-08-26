import { describe, it, expect } from 'vitest';
import { DeepSeekClient } from '../src/deepseek';
import { ModelAgent } from '../src/agent';

function clientWithContent(content: string): DeepSeekClient {
  return new DeepSeekClient({
    apiKey: 'sk-test',
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
    })) as never,
  });
}

describe('[正确性] ModelAgent', () => {
  it('profile() 生成可进 Registry 的 Agent', () => {
    const a = new ModelAgent(
      { id: 'real-agent-01', name: 'coder-pro', model: 'deepseek-v4-flash', systemPrompt: 'You are a coder.', capabilities: ['code'] },
      clientWithContent('x'),
    );
    const p = a.profile();
    expect(p.id).toBe('real-agent-01');
    expect(p.name).toBe('coder-pro');
    expect(p.capabilities).toContain('code');
    expect(p.status).toBe('active');
  });

  it('reply() 返回模型输出，并携带 system prompt', async () => {
    let capturedBody = '';
    const client = new DeepSeekClient({
      apiKey: 'sk-test',
      fetchImpl: (async (_url: string, init: { body: string }) => {
        capturedBody = init.body;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ choices: [{ message: { content: 'answer' } }] }),
        };
      }) as never,
    });
    const a = new ModelAgent(
      { id: 'a1', name: 'a1', model: 'm', systemPrompt: 'Be honest.' },
      client,
    );
    const out = await a.reply('Q?');
    expect(out).toBe('answer');
    expect(capturedBody).toContain('Be honest.');
  });
});

describe('[可复现性] 同一模型不同 persona 是不同个体', () => {
  it('两个 ModelAgent 共享同一 client，但 profile 不同', () => {
    const client = clientWithContent('x');
    const a = new ModelAgent({ id: 'a1', name: 'alpha', model: 'deepseek-v4-flash', systemPrompt: 'A' }, client);
    const b = new ModelAgent({ id: 'a2', name: 'beta', model: 'deepseek-v4-flash', systemPrompt: 'B' }, client);
    expect(a.profile().id).not.toBe(b.profile().id);
    expect(a.config.model).toBe(b.config.model);
  });
});
