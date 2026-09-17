import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildIngestPayload, ensureKeypair, runSuite } from 'a2t';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { reverifyAgent } from '../reverify';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;
let keypair: { publicKeyPem: string; privateKeyPem: string };

// 审计 A4 后，ingest 与 reverify 都要求公网 http(s) endpoint（SSRF 卡口）。
// 本地 fixture server 的 127.0.0.1 地址不再可用，改用公网域名 + 注入 fetch stub：
// /good 答对（10），/bad 答错（99），/dead 抛错（不可达）。
const GOOD = 'https://rv-fixture.example.com/good';
const BAD = 'https://rv-fixture.example.com/bad';
const DEAD = 'https://rv-fixture.example.com/dead';

const fetchSpy = vi.fn(async (input: string) => {
  const url = String(input);
  if (url.includes('/dead')) throw new Error('ECONNREFUSED');
  const answer = url.includes('/good') ? 'The answer is 10.' : 'The answer is 99.';
  return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

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
  vi.stubGlobal('fetch', fetchSpy);
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
  keypair = ensureKeypair(mkdtempSync(join(tmpdir(), 'acl-rv-')));
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('reverifyAgent', () => {
  it('endpoint answering consistently → verified', async () => {
    const id = await ingestAs('rv-good', GOOD);
    expect(await reverifyAgent(app, id)).toBe('verified');
    expect(await levelOf(id)).toBe('verified');
  });

  it('endpoint answering wrong → stays basic', async () => {
    const id = await ingestAs('rv-bad', BAD);
    expect(await reverifyAgent(app, id)).toBe('basic');
    expect(await levelOf(id)).toBe('basic');
  });

  it('unreachable endpoint → stays basic', async () => {
    const id = await ingestAs('rv-dead', DEAD);
    expect(await reverifyAgent(app, id)).toBe('basic');
  });

  it('model-mode agent (no endpoint) → stays basic', async () => {
    const id = await ingestAs('rv-model');
    expect(await reverifyAgent(app, id)).toBe('basic');
  });
});
