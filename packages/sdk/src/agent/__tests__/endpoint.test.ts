import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EndpointAgent } from '../endpoint.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body) as { messages?: { role: string }[] };
      if (parsed.messages?.[0]?.role !== 'user') {
        res.writeHead(400).end('bad request');
        return;
      }
      if (req.url === '/openai') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '标准回复' } }] }));
      } else if (req.url === '/plain') {
        res.setHeader('content-type', 'text/plain');
        res.end('裸文本回复');
      } else if (req.url === '/boom') {
        res.writeHead(500).end('error');
      } else if (req.url === '/wrongshape') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ result: 'not-openai-shape' }));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('EndpointAgent', () => {
  it('parses standard openai response', async () => {
    const agent = new EndpointAgent(`${baseUrl}/openai`);
    await expect(agent.reply('hi')).resolves.toBe('标准回复');
  });

  it('falls back to raw text response', async () => {
    const agent = new EndpointAgent(`${baseUrl}/plain`);
    await expect(agent.reply('hi')).resolves.toBe('裸文本回复');
  });

  it('throws on http error status', async () => {
    const agent = new EndpointAgent(`${baseUrl}/boom`);
    await expect(agent.reply('hi')).rejects.toThrow(/500/);
  });

  it('人话报错：连不上时提示检查 agent 是否运行 / URL 是否正确', async () => {
    // 127.0.0.1:1 必然拒连（ECONNREFUSED）
    const agent = new EndpointAgent('http://127.0.0.1:1/agent');
    await expect(agent.reply('hi')).rejects.toThrow(/连不上 endpoint[\s\S]*agent 是否正在运行/);
  });

  it('人话报错：HTTP 非 2xx 带响应摘要', async () => {
    const agent = new EndpointAgent(`${baseUrl}/boom`);
    await expect(agent.reply('hi')).rejects.toThrow(/HTTP 500/);
  });

  it('人话报错：JSON 但缺 choices[0].message.content → 提示格式', async () => {
    const agent = new EndpointAgent(`${baseUrl}/wrongshape`);
    await expect(agent.reply('hi')).rejects.toThrow(/响应格式不对[\s\S]*OpenAI chat 格式/);
  });
});
