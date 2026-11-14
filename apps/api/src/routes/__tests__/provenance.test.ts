/**
 * Provenance regression: clones, spoofed version labels, evidence scope,
 * capacity double-counting, tamper, and replay.
 * Credit scores stay on baseline-v0.3 evidence rows; references do not add points.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { signPayload } from 'agent-to-trust';
import { fingerprintRelease, parseReleaseMaterial } from '@a2t/core';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, creditScores, evidence } from '../../db/schema';
import { computeAndPersist } from '../scores';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://acl:acl@localhost:5432/acl_test';

let app: FastifyInstance;
let db: Database;

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const publisher = keypair();
const clone = keypair();
const other = keypair();

const releaseInput = {
  versionLabel: '1.2.0',
  config: { temperature: 0, prompt: 'exam' },
  tools: ['browser', 'shell'],
  evalConditions: { benchmarkVersion: '1.2.0', suite: 'exam-v1' },
};

function signed(action: string, body: Record<string, unknown>, keys = publisher, extra: Record<string, unknown> = {}) {
  const payload = {
    action,
    pubkey: keys.publicKeyPem,
    nonce: randomUUID(),
    timestamp: Date.now(),
    body,
    ...extra,
  };
  return { ...payload, signature: signPayload(keys.privateKeyPem, payload) };
}

async function post(url: string, body: unknown) {
  return app.inject({ method: 'POST', url, payload: body as Record<string, unknown> });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(sql`
    TRUNCATE provenance_references, provenance_evidence_bindings, provenance_instances,
      provenance_release_signatures, provenance_releases,
      evidence, credit_scores, score_snapshots, agents, ingest_nonces
    CASCADE
  `);
  await db.insert(agents).values([
    {
      id: 'ag-pub',
      name: 'prov-publisher',
      owner: 'publisher-handle',
      pubkey: publisher.publicKeyPem,
      verificationLevel: 'basic',
      nameNormalized: 'prov-publisher',
    },
    {
      id: 'ag-clone',
      name: 'prov-clone',
      owner: null,
      pubkey: clone.publicKeyPem,
      verificationLevel: 'basic',
      nameNormalized: 'prov-clone',
    },
    {
      id: 'ag-other',
      name: 'prov-other',
      owner: 'other-handle',
      pubkey: other.publicKeyPem,
      verificationLevel: 'basic',
      nameNormalized: 'prov-other',
    },
  ]);
  await db.insert(evidence).values([
    {
      id: 'ev-cap',
      agentId: 'ag-pub',
      dimension: 'capability',
      source: 'real-benchmark',
      sourceType: 'real',
      result: 'success',
      value: 1,
      evidenceUri: 'a2t://benchmark/coding-sum',
    },
    {
      id: 'ev-fulfill',
      agentId: 'ag-pub',
      dimension: 'delivery',
      source: 'arena',
      sourceType: 'real',
      result: 'success',
      value: 1,
      evidenceUri: 'a2t://arena/deal-1',
    },
    {
      id: 'ev-self',
      agentId: 'ag-pub',
      dimension: 'capability',
      source: 'self-reported',
      sourceType: 'self-reported',
      result: 'success',
      value: 1,
    },
  ]);
  await computeAndPersist(app, 'ag-pub');
});

afterAll(async () => {
  await app.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('provenance writes', () => {
  let fingerprint = '';
  let cloneInstance = '';
  let publisherInstance = '';

  it('publishes a release and says what the signature does not prove', async () => {
    const res = await post('/provenance/releases', signed('publish-release', { material: releaseInput }));
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      fingerprint: string;
      doesNotProve: string[];
      rarityCreditBonus: number;
      assurance: string;
    };
    fingerprint = body.fingerprint;
    const parsed = parseReleaseMaterial(releaseInput);
    if (!parsed.ok) throw new Error(parsed.code);
    expect(fingerprint).toBe(fingerprintRelease(parsed.value));
    expect(body.doesNotProve).toEqual([
      'physical-uniqueness',
      'performance-truth',
      'exclusive-ownership',
      'scarcity',
    ]);
    expect(body.rarityCreditBonus).toBe(0);
    expect(body.assurance).toBe('signed-record');
  });

  it('rejects a tampered config after the signature', async () => {
    const payload = signed('publish-release', { material: releaseInput });
    const tampered = {
      ...payload,
      body: { material: { ...releaseInput, config: { temperature: 1, prompt: 'exam' } } },
    };
    const res = await post('/provenance/releases', tampered);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'bad-signature' });
  });

  it('rejects a replayed nonce', async () => {
    const payload = signed('publish-release', { material: releaseInput });
    expect((await post('/provenance/releases', payload)).statusCode).toBe(200);
    const again = await post('/provenance/releases', payload);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'replay' });
  });

  it('binds capability evidence to the release and fulfillment to an instance', async () => {
    const publisherInst = await post(
      '/provenance/instances',
      signed('register-instance', { releaseFingerprint: fingerprint, declaredCapacity: 9 }),
    );
    expect(publisherInst.statusCode).toBe(201);
    publisherInstance = (publisherInst.json() as { instanceId: string }).instanceId;

    const cap = await post(
      '/provenance/bindings',
      signed('bind-evidence', { evidenceId: 'ev-cap', scope: 'capability', releaseFingerprint: fingerprint }),
    );
    expect(cap.statusCode).toBe(201);
    const fulfill = await post(
      '/provenance/bindings',
      signed('bind-evidence', { evidenceId: 'ev-fulfill', scope: 'fulfillment', instanceId: publisherInstance }),
    );
    expect(fulfill.statusCode).toBe(201);
    const self = await post(
      '/provenance/bindings',
      signed('bind-evidence', { evidenceId: 'ev-self', scope: 'capability', releaseFingerprint: fingerprint }),
    );
    expect(self.statusCode).toBe(201);
  });

  it('registers a clone instance without copying identity or capacity', async () => {
    const res = await post(
      '/provenance/instances',
      signed(
        'register-instance',
        { releaseFingerprint: fingerprint, operatorDeclaration: 'clone-op', declaredCapacity: 3, licenseAssertion: 'self-declared MIT' },
        clone,
      ),
    );
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      instanceId: string;
      operatorDeclaration: string;
      declaredCapacity: number;
      capacityAssurance: string;
      inherited: { identity: boolean; fulfillment: boolean; capacity: boolean };
    };
    cloneInstance = body.instanceId;
    expect(body.operatorDeclaration).toBe('clone-op');
    expect(body.declaredCapacity).toBe(3);
    expect(body.capacityAssurance).toBe('self-declared');
    expect(body.inherited).toEqual({ identity: false, fulfillment: false, capacity: false });
    const row = await db.query.agents.findFirst({ where: eq(agents.id, 'ag-clone') });
    expect(row?.owner).toBeNull();
    const ev = await db.query.evidence.findMany({ where: eq(evidence.agentId, 'ag-clone') });
    expect(ev).toHaveLength(0);
  });

  it('refuses a client-supplied verified capacity', async () => {
    const res = await post(
      '/provenance/instances',
      signed('register-instance', { releaseFingerprint: fingerprint, capacityAssurance: 'independently-verified' }, other),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'assurance-not-offered' });
  });

  it('references identical exam evidence without changing either score', async () => {
    const beforePub = await db.query.creditScores.findFirst({ where: eq(creditScores.agentId, 'ag-pub') });
    const beforeClone = await app.inject({ method: 'GET', url: '/agents/ag-clone/score' });
    const beforeCloneScore = (beforeClone.json() as { score: number | null }).score;

    const res = await post(
      '/provenance/references',
      signed(
        'reference-capability',
        { targetInstanceId: cloneInstance, sourceEvidenceId: 'ev-cap', claimedVersionLabel: '1.2.0' },
        clone,
      ),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ countsTowardScore: false, assurance: 'server-checked-fingerprint' });

    const afterPub = await db.query.creditScores.findFirst({ where: eq(creditScores.agentId, 'ag-pub') });
    expect(afterPub?.score).toBe(beforePub?.score);
    expect(afterPub?.modelVersion).toBe('baseline-v0.3');
    const afterClone = await app.inject({ method: 'GET', url: '/agents/ag-clone/score' });
    expect((afterClone.json() as { score: number | null }).score).toBe(beforeCloneScore);
    expect(await db.query.evidence.findMany({ where: eq(evidence.agentId, 'ag-clone') })).toHaveLength(0);
  });

  it('does not reference fulfillment or self-reported capability', async () => {
    const fulfill = await post(
      '/provenance/references',
      signed('reference-capability', { targetInstanceId: cloneInstance, sourceEvidenceId: 'ev-fulfill' }, clone),
    );
    expect(fulfill.statusCode).toBe(409);
    expect(fulfill.json()).toMatchObject({ code: 'scope-not-referable' });
    const self = await post(
      '/provenance/references',
      signed('reference-capability', { targetInstanceId: cloneInstance, sourceEvidenceId: 'ev-self' }, clone),
    );
    expect(self.statusCode).toBe(409);
    expect(self.json()).toMatchObject({ code: 'source-not-exam' });
  });

  it('rejects a clone of the same version label with a different config', async () => {
    const spoofed = { ...releaseInput, config: { temperature: 0.4, prompt: 'exam' } };
    const published = await post('/provenance/releases', signed('publish-release', { material: spoofed }, other));
    expect(published.statusCode).toBe(201);
    const spoofFp = (published.json() as { fingerprint: string }).fingerprint;
    expect(spoofFp).not.toBe(fingerprint);
    const inst = await post(
      '/provenance/instances',
      signed('register-instance', { releaseFingerprint: spoofFp, declaredCapacity: 5 }, other),
    );
    expect(inst.statusCode).toBe(201);
    const otherInstance = (inst.json() as { instanceId: string }).instanceId;
    const res = await post(
      '/provenance/references',
      signed(
        'reference-capability',
        { targetInstanceId: otherInstance, sourceEvidenceId: 'ev-cap', claimedVersionLabel: '1.2.0' },
        other,
      ),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'version-label-insufficient', countsTowardScore: false });
  });

  it('does not sum self-declared capacity across instances of one release', async () => {
    const res = await app.inject({ method: 'GET', url: `/provenance/releases/${fingerprint}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      capabilityEvidence: Array<{ evidenceId: string; referable: boolean }>;
      capacity: { total: number | null; perInstance: Array<{ declaredCapacity: number | null }> };
    };
    expect(body.capabilityEvidence.map((row) => row.evidenceId).sort()).toEqual(['ev-cap', 'ev-self']);
    expect(body.capabilityEvidence.find((row) => row.evidenceId === 'ev-cap')?.referable).toBe(true);
    expect(body.capabilityEvidence.find((row) => row.evidenceId === 'ev-self')?.referable).toBe(false);
    expect(body.capacity.total).toBeNull();
    const amounts = body.capacity.perInstance.map((row) => row.declaredCapacity).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(amounts).toEqual([3, 9]);
    expect((amounts[0] ?? 0) + (amounts[1] ?? 0)).toBe(12);
  });

  it('shows the clone reference on the identity profile and not the publisher fulfillment', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/ag-clone/provenance' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      instances: Array<{ operatorDeclaration: string | null; declaredCapacity: number | null }>;
      capabilityReferences: Array<{ sourceEvidenceId: string; countsTowardScore: boolean }>;
      notInheritedByClones: string[];
    };
    expect(body.instances).toEqual([
      expect.objectContaining({ operatorDeclaration: 'clone-op', declaredCapacity: 3, capacityAssurance: 'self-declared' }),
    ]);
    expect(body.capabilityReferences.map((row) => row.sourceEvidenceId)).toEqual(['ev-cap']);
    expect(body.capabilityReferences.every((row) => row.countsTowardScore === false)).toBe(true);
    expect(body.notInheritedByClones).toEqual(['identity', 'fulfillment', 'capacity']);
  });
});
