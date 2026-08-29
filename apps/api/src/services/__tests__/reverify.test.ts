import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildIngestPayload, ensureKeypair, runSuite } from '@acl/sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { reverifyAgent } from '../reverify';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:test@127.0.0.1:55432/postgres';

let app: FastifyInstance;
let db: Database;
let server: Server;
let baseUrl: string;
let keypair: { publicKeyPem: string; privateKeyPem: string };

async function ingestAs(name: string, endpoint?: string): Promise<string> {
  const suite = await runSuite({ reply: async () => '10' }, { filter: (id) => id === 'coding-sum' });
  const payload = buildIngestPayload(suite, { name, endpoint }, keypair);
  const res = await app.inject({ method: 'POST', url: '/ingest/results', payload });
  expect(res.statusCode).toBe(200);
  return (res.json() as { agentId: string }).agentId;
}

async function levelOf(agentId: string): Promise<string> {
  const agent = await db.query.agents.findFirst({ where: sql`id = ${agentId}` as never });
  return agent?.verificationLevel ?? 'unknown';
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
  keypair = ensureKeypair(mkdtempSync(join(tmpdir(), 'acl-rv-')));

  // fixture endpoint：/good 答对（10），/bad 答错（99）
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      const answer = req.url?.includes('/good') ? 'The answer is 10.' : 'The answer is 99.';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('reverifyAgent', () => {
  it('endpoint answering consistently → verified', async () => {
    const id = await ingestAs('rv-good', `${baseUrl}/good`);
    expect(await reverifyAgent(app, id)).toBe('verified');
    expect(await levelOf(id)).toBe('verified');
  });

  it('endpoint answering wrong → stays basic', async () => {
    const id = await ingestAs('rv-bad', `${baseUrl}/bad`);
    expect(await reverifyAgent(app, id)).toBe('basic');
    expect(await levelOf(id)).toBe('basic');
  });

  it('unreachable endpoint → stays basic', async () => {
    const id = await ingestAs('rv-dead', 'http://127.0.0.1:1/agent');
    expect(await reverifyAgent(app, id)).toBe('basic');
  });

  it('model-mode agent (no endpoint) → stays basic', async () => {
    const id = await ingestAs('rv-model');
    expect(await reverifyAgent(app, id)).toBe('basic');
  });
});
