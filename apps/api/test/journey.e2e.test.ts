/**
 * Onboarding → exam → report → leaderboard, plus the failure edges:
 * tamper, replay, identical resubmit, and a self-reported task that must
 * not move baseline-v0.3 or be labeled independently verified.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildIngestPayload, runSuite, signPayload, type SuiteResult } from 'agent-to-trust';
import { buildApp } from '../src/app';
import { createDb, type Database } from '../src/db/client';
import { evidence } from '../src/db/schema';
import { setupTestDatabase, testDatabaseUrl } from './helpers';

let app: FastifyInstance;
let db: Database;
let suite: SuiteResult;

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const publisher = keypair();
const stranger = keypair();

function fulfillment(body: Record<string, unknown>, keys = publisher) {
  const payload = {
    action: 'submit-fulfillment',
    pubkey: keys.publicKeyPem,
    nonce: randomUUID(),
    timestamp: Date.now(),
    body,
  };
  return { ...payload, signature: signPayload(keys.privateKeyPem, payload) };
}

beforeAll(async () => {
  await setupTestDatabase();
  db = createDb(testDatabaseUrl());
  app = buildApp(db);
  await app.ready();
  suite = await runSuite({ reply: async () => '10' }, { filter: (id) => id === 'coding-sum' });
});

afterAll(async () => {
  await app.close();
});

describe('exam onboarding, report, and leaderboard', () => {
  let agentId = '';
  let score: number | null = null;

  it('a signed exam creates an identity, a score, and a public leaderboard row', async () => {
    const payload = buildIngestPayload(
      suite,
      { name: 'journey-candidate', endpoint: 'https://journey.invalid/v1' },
      publisher,
    );
    const res = await app.inject({ method: 'POST', url: '/ingest/results', payload });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agentId: string; score: number | null; duplicate: boolean; verified: boolean };
    expect(body.duplicate).toBe(false);
    expect(body.verified).toBe(false);
    expect(body.score).not.toBeNull();
    agentId = body.agentId;
    score = body.score;

    const byName = await app.inject({ method: 'GET', url: '/agents/by-name/journey-candidate' });
    expect(byName.statusCode).toBe(200);
    expect(byName.json()).toMatchObject({ id: agentId, name: 'journey-candidate' });

    const report = await app.inject({ method: 'GET', url: `/agents/${agentId}/score` });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({ agentId, score, modelVersion: 'baseline-v0.3' });
    const chain = await app.inject({ method: 'GET', url: `/agents/${agentId}/evidence` });
    expect(chain.json()).toHaveLength(1);

    const board = await app.inject({ method: 'GET', url: '/leaderboard?board=capability' });
    expect(board.statusCode).toBe(200);
    const row = (board.json() as Array<{ agentId: string; name: string }>).find((entry) => entry.agentId === agentId);
    expect(row?.name).toBe('journey-candidate');
  });

  it('rejects a tampered exam and a replayed nonce', async () => {
    const payload = buildIngestPayload(suite, { name: 'journey-candidate' }, publisher);
    const tampered = {
      ...payload,
      results: [{ ...(payload.results as Array<Record<string, unknown>>)[0], value: 0.99 }],
    };
    const bad = await app.inject({ method: 'POST', url: '/ingest/results', payload: tampered });
    expect(bad.statusCode).toBe(401);

    const replay = await app.inject({ method: 'POST', url: '/ingest/results', payload });
    expect(replay.statusCode).toBe(409);
  });

  it('an identical exam does not add credit', async () => {
    const scoresBefore = (await db.query.creditScores.findMany()).filter((row) => row.agentId === agentId).length;
    const payload = buildIngestPayload(suite, { name: 'journey-candidate' }, publisher);
    const res = await app.inject({ method: 'POST', url: '/ingest/results', payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ duplicate: true, score, agentId });
    const rows = await db.query.evidence.findMany({ where: eq(evidence.agentId, agentId) });
    expect(rows).toHaveLength(1);
    const scoresAfter = (await db.query.creditScores.findMany()).filter((row) => row.agentId === agentId).length;
    expect(scoresAfter).toBe(scoresBefore);
  });

  it('a self-reported task is owned, idempotent, and outside the score', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/fulfillment',
      payload: fulfillment({ taskId: 'job-1', outcome: 'success', summary: 'I say I delivered the file.' }),
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      assurance: 'self-reported',
      independentlyVerified: false,
      countsTowardScore: false,
      duplicate: false,
    });
    const scoreAfter = await app.inject({ method: 'GET', url: `/agents/${agentId}/score` });
    expect(scoreAfter.json()).toMatchObject({ score, modelVersion: 'baseline-v0.3' });

    const again = await app.inject({
      method: 'POST',
      url: '/fulfillment',
      payload: fulfillment({ taskId: 'job-1', outcome: 'success', summary: 'I say I delivered the file.' }),
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true, id: first.json().id, countsTowardScore: false });

    const conflict = await app.inject({
      method: 'POST',
      url: '/fulfillment',
      payload: fulfillment({ taskId: 'job-1', outcome: 'failure', summary: 'A different story.' }),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'task-conflict', countsTowardScore: false });

    const listed = await app.inject({ method: 'GET', url: `/agents/${agentId}/fulfillment` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().records).toHaveLength(1);
    expect(listed.json()).toMatchObject({ assurance: 'self-reported', countsTowardScore: false });

    const claimed = await app.inject({
      method: 'POST',
      url: '/fulfillment',
      payload: fulfillment({ taskId: 'job-2', outcome: 'success', summary: 'Verified by the lab.', assurance: 'independently-verified' }),
    });
    expect(claimed.statusCode).toBe(400);
    expect(claimed.json()).toMatchObject({ code: 'assurance-not-offered' });
  });

  it('a second identity keeps its own claim and does not inherit the first', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/arena/register',
      payload: { name: 'journey-clone', pubkey: stranger.publicKeyPem },
    });
    expect(reg.statusCode).toBe(201);
    const cloneId = reg.json().agentId as string;
    const stolen = await app.inject({
      method: 'POST',
      url: '/fulfillment',
      payload: fulfillment({ taskId: 'job-1', outcome: 'success', summary: 'I say I delivered the file.' }, stranger),
    });
    expect(stolen.statusCode).toBe(201);
    expect(stolen.json().agentId).toBe(cloneId);
    const publisherList = await app.inject({ method: 'GET', url: `/agents/${agentId}/fulfillment` });
    const cloneList = await app.inject({ method: 'GET', url: `/agents/${cloneId}/fulfillment` });
    expect(publisherList.json().records).toHaveLength(1);
    expect(cloneList.json().records).toHaveLength(1);
    expect(cloneList.json().records[0].id).not.toBe(publisherList.json().records[0].id);
    const cloneScore = await app.inject({ method: 'GET', url: `/agents/${cloneId}/score` });
    expect(cloneScore.json().score).toBeNull();
  });
});
