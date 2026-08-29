import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModelAgent } from '../model.js';

let server: Server;
let baseUrl: string;
let lastAuth: string | undefined;
let lastBody = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      lastAuth = req.headers.authorization;
      lastBody = body;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '模型回复' } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('ModelAgent', () => {
  it('sends openai-compatible request with persona and auth', async () => {
    const agent = new ModelAgent({
      model: 'test-model',
      baseUrl,
      apiKey: 'sk-test',
      persona: '你是客服',
    });
    await expect(agent.reply('你好')).resolves.toBe('模型回复');
    expect(lastAuth).toBe('Bearer sk-test');
    const body = JSON.parse(lastBody) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('test-model');
    expect(body.messages[0]).toEqual({ role: 'system', content: '你是客服' });
    expect(body.messages[1]).toEqual({ role: 'user', content: '你好' });
  });

  it('normalizes trailing slash in baseUrl', async () => {
    const agent = new ModelAgent({ model: 'm', baseUrl: `${baseUrl}/`, apiKey: 'k' });
    await expect(agent.reply('x')).resolves.toBe('模型回复');
  });

  it('omits system message when no persona', async () => {
    const agent = new ModelAgent({ model: 'm', baseUrl, apiKey: 'k' });
    await agent.reply('x');
    const body = JSON.parse(lastBody) as { messages: { role: string }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });
});
