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
});
