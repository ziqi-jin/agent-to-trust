import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  buildIngestPayload,
  ensureKeypair,
  runSuite,
  signPayload,
  type SuiteResult,
} from 'a2t-sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:test@127.0.0.1:55432/postgres';

let app: FastifyInstance;
let db: Database;
let keypair: { publicKeyPem: string; privateKeyPem: string };
let otherKeypair: { publicKeyPem: string; privateKeyPem: string };
let suiteFixture: SuiteResult;

async function post(body: unknown) {
  return app.inject({ method: 'POST', url: '/ingest/results', payload: body as Record<string, unknown> });
}

function reSign(body: Record<string, unknown>, privateKeyPem: string): Record<string, unknown> {
  const { signature: _s, ...payload } = body;
  return { ...payload, signature: signPayload(privateKeyPem, payload) };
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
  const dir = mkdtempSync(join(tmpdir(), 'acl-api-a-'));
  const otherDir = mkdtempSync(join(tmpdir(), 'acl-api-b-'));
  keypair = ensureKeypair(dir);
  otherKeypair = ensureKeypair(otherDir);
  suiteFixture = await runSuite({ reply: async () => '10' }, { filter: (id) => id === 'coding-sum' });
});

afterAll(async () => {
  await app.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('POST /ingest/results', () => {
  it('accepts a valid signed payload: evidence stored, agent bound to pubkey, score computed', async () => {
    const payload = buildIngestPayload(
      suiteFixture,
      // 审计 A4：endpoint 现在必须过 isPublicEndpoint 卡口；localhost 会被 400。
      // .invalid 为 RFC 2606 保留 TLD，DNS 秒失败，不产生真实出网。
      { name: 'e2e-agent', endpoint: 'https://agent.invalid/v1' },
      keypair,
    );
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agentId: string; verified: boolean; verificationLevel: string; score: number | null };
    expect(body.agentId).toMatch(/^ext-/);
    expect(body.verified).toBe(false);
    expect(body.verificationLevel).toBe('basic');
    expect(body.score).not.toBeNull();

    const ev = await db.query.evidence.findMany();
    const mine = ev.filter((e) => e.agentId === body.agentId);
    expect(mine.length).toBe(1);
    expect(mine[0].source).toBe('real-benchmark');
    expect(mine[0].dimension).toBe('capability');
    expect(mine[0].evidenceUri).toBe('a2t://benchmark/coding-sum');

    const agent = await db.query.agents.findFirst({ where: sql`id = ${body.agentId}` as never });
    expect(agent?.pubkey).toBe(keypair.publicKeyPem);
    expect(agent?.endpoint).toBe('https://agent.invalid/v1');
  });

  it('accepts re-upload from the same key (score recomputed, evidence appended)', async () => {
    const payload = buildIngestPayload(suiteFixture, { name: 'e2e-agent' }, keypair);
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agentId: string };
    const mine = (await db.query.evidence.findMany()).filter((e) => e.agentId === body.agentId);
    expect(mine.length).toBe(2);
  });

  it('rejects tampered results (bad signature) with 401', async () => {
    const payload = buildIngestPayload(suiteFixture, { name: 'e2e-agent' }, keypair);
    const tampered = {
      ...payload,
      results: [{ ...(payload.results as unknown as Record<string, unknown>[])[0], value: 0.99 }],
    };
    const res = await post(tampered);
    expect(res.statusCode).toBe(401);
  });

  it('rejects replay (same nonce) with 409', async () => {
    const payload = buildIngestPayload(suiteFixture, { name: 'e2e-replay' }, keypair);
    const first = await post(payload);
    expect(first.statusCode).toBe(200);
    const second = await post(payload);
    expect(second.statusCode).toBe(409);
  });

  it('rejects stale timestamp with 409', async () => {
    const stale = reSign(
      { ...buildIngestPayload(suiteFixture, { name: 'e2e-stale' }, keypair), timestamp: Date.now() - 11 * 60_000 },
      keypair.privateKeyPem,
    );
    const res = await post(stale);
    expect(res.statusCode).toBe(409);
  });

  it('rejects outdated benchmark version with 422', async () => {
    const payload = buildIngestPayload(
      { ...suiteFixture, benchmarkVersion: '0.9.0' },
      { name: 'e2e-lowver' },
      keypair,
    );
    const res = await post(payload);
    expect(res.statusCode).toBe(422);
  });

  it('rejects unknown caseId with 422', async () => {
    const payload = buildIngestPayload(
      {
        ...suiteFixture,
        results: [
          { caseId: 'hack-case', dimension: 'coding', scoreDimension: 'capability', value: 1, result: 'success', rawOutput: 'x' },
        ],
      },
      { name: 'e2e-unknown' },
      keypair,
    );
    const res = await post(payload);
    expect(res.statusCode).toBe(422);
  });

  it('rejects same name bound to a different key with 403', async () => {
    const payload = buildIngestPayload(suiteFixture, { name: 'e2e-agent' }, otherKeypair);
    const res = await post(payload);
    expect(res.statusCode).toBe(403);
  });

  // ---- exam-v2（榜2 考场组件，难度档）准入 ----
  it('rejects exam-v2 caseId when reported under v1 version (422)', async () => {
    const payload = buildIngestPayload(
      {
        ...suiteFixture,
        results: [
          { caseId: 'C1', dimension: 'reasoning', scoreDimension: 'capability', value: 1, result: 'success', rawOutput: 'x' },
        ],
      },
      { name: 'e2e-v2-lowver' },
      keypair,
    );
    const res = await post(payload);
    expect(res.statusCode).toBe(422);
  });

  it('accepts exam-v2 caseId under v2 version and maps server-side dimension', async () => {
    const payload = buildIngestPayload(
      {
        ...suiteFixture,
        benchmarkVersion: '2.0.0',
        results: [
          { caseId: 'C1', dimension: 'coding', scoreDimension: 'capability', value: 1, result: 'success', rawOutput: 'x' },
          { caseId: 'd01', dimension: 'honesty', scoreDimension: 'integrity', value: 0, result: 'failure', rawOutput: 'y' },
          { caseId: 'r1', dimension: 'honesty', scoreDimension: 'integrity', value: 0.5, result: 'partial', rawOutput: 'z' },
        ],
      },
      { name: 'e2e-v2-ok' },
      keypair,
    );
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agentId: string };
    const mine = (await db.query.evidence.findMany()).filter((e) => e.agentId === body.agentId);
    // 服务端权威维度：客户端报的 dimension 一律不信。
    const byUri = new Map(mine.map((e) => [e.evidenceUri, e]));
    expect(byUri.get('a2t://benchmark/C1')?.dimension).toBe('reliability');
    expect(byUri.get('a2t://benchmark/d01')?.dimension).toBe('security');
    expect(byUri.get('a2t://benchmark/r1')?.dimension).toBe('delivery');
  });

  it('accepts v1 caseId under v1 version (regression: v2 gate does not block v1)', async () => {
    const payload = buildIngestPayload(suiteFixture, { name: 'e2e-v1-ok' }, keypair);
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
  });
});
