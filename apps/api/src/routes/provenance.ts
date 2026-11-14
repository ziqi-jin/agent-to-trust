/**
 * Provenance API (a2t-provenance-v1).
 *
 * Writes are Ed25519-signed by an already registered agent key (the same
 * identity ingest and Arena use). Reads are public.
 *
 * A signature proves the key signed the record. The response lists what that
 * does not prove. Capacity and license text are stored as self-declared.
 * Capability references are pointers: they do not insert evidence and they
 * do not call the scorer.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  ASSURANCE,
  EVIDENCE_SCOPES,
  NOT_INHERITED_BY_CLONES,
  RARITY_CREDIT_BONUS,
  REFERENCABLE_EXAM_SOURCES,
  SCORING_NOTE,
  SIGNATURE_DOES_NOT_PROVE,
  SIGNATURE_MEANS,
  capacitySummary,
  configHash,
  decideCapabilityReference,
  fingerprintRelease,
  parseReleaseMaterial,
  type EvidenceScope,
} from '@a2t/core';
import { verifyPayload } from 'agent-to-trust';
import {
  agents,
  evidence,
  ingestNonces,
  provenanceEvidenceBindings,
  provenanceInstances,
  provenanceReferences,
  provenanceReleaseSignatures,
  provenanceReleases,
} from '../db/schema';
import { createRateLimiter } from '../services/rateLimit';

const TIMESTAMP_WINDOW_MS = 10 * 60_000;
const writeLimited = createRateLimiter({ max: 30, windowMs: 60_000 });
const readLimited = createRateLimiter({ max: 120, windowMs: 60_000 });

function pubkeyFingerprint(pem: string): string {
  return createHash('sha256').update(pem).digest('hex').slice(0, 16);
}

function limited(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, req: Parameters<typeof writeLimited>[0], kind: 'read' | 'write') {
  const hit = (kind === 'read' ? readLimited : writeLimited)(req);
  if (!hit) return false;
  reply.code(429).send({ error: '请求过于频繁，稍后再试', code: 'rate-limited' });
  return true;
}

function signatureFacts() {
  return {
    signatureMeans: SIGNATURE_MEANS,
    proves: ['signed-record-control'],
    doesNotProve: [...SIGNATURE_DOES_NOT_PROVE],
    rarityCreditBonus: RARITY_CREDIT_BONUS,
    scoringNote: SCORING_NOTE,
    notInheritedByClones: [...NOT_INHERITED_BY_CLONES],
  };
}

export async function provenanceRoutes(app: FastifyInstance) {
  app.post('/provenance/releases', async (req, reply) => {
    if (limited(reply, req, 'write')) return;
    const opened = await openSigned(app, req.body, reply);
    if (!opened) return;
    if (opened.action !== 'publish-release') {
      return reply.code(400).send({ error: 'action 必须是 publish-release', code: 'action' });
    }
    const materialResult = parseReleaseMaterial(opened.body.material);
    if (!materialResult.ok) {
      return reply.code(400).send({ error: 'release material 无法规范化', code: materialResult.code });
    }
    const material = materialResult.value;
    const fingerprint = fingerprintRelease(material);
    if (typeof opened.body.fingerprint === 'string' && opened.body.fingerprint !== fingerprint) {
      return reply.code(400).send({
        error: '声明的 fingerprint 与服务端按 config、tools、评测条件重算的结果不一致',
        code: 'fingerprint-tamper',
      });
    }
    const existing = await app.db.query.provenanceReleases.findFirst({
      where: eq(provenanceReleases.fingerprint, fingerprint),
    });
    if (existing) {
      const stored = parseReleaseMaterial(existing.material);
      if (!stored.ok || fingerprintRelease(stored.value) !== fingerprint) {
        return reply.code(409).send({ error: 'fingerprint 冲突', code: 'fingerprint-conflict' });
      }
    } else {
      await app.db.insert(provenanceReleases).values({
        fingerprint,
        schemaVersion: material.schema,
        versionLabel: material.versionLabel,
        configHash: configHash(material.config),
        tools: material.tools,
        evalConditions: material.evalConditions,
        material,
      });
    }
    const prior = await app.db.query.provenanceReleaseSignatures.findFirst({
      where: and(
        eq(provenanceReleaseSignatures.fingerprint, fingerprint),
        eq(provenanceReleaseSignatures.publisherPubkey, opened.pubkey),
      ),
    });
    if (!prior) {
      await app.db.insert(provenanceReleaseSignatures).values({
        id: `sig-${randomUUID()}`,
        fingerprint,
        publisherPubkey: opened.pubkey,
        publisherAgentId: opened.agent.id,
        nonce: opened.nonce,
      });
    }
    return reply.code(prior ? 200 : 201).send({
      fingerprint,
      versionLabel: material.versionLabel,
      reused: Boolean(prior),
      assurance: ASSURANCE.signedRecord,
      publisherAgentId: opened.agent.id,
      publisherKeyFingerprint: pubkeyFingerprint(opened.pubkey),
      ...signatureFacts(),
    });
  });

  app.post('/provenance/instances', async (req, reply) => {
    if (limited(reply, req, 'write')) return;
    const opened = await openSigned(app, req.body, reply);
    if (!opened) return;
    if (opened.action !== 'register-instance') {
      return reply.code(400).send({ error: 'action 必须是 register-instance', code: 'action' });
    }
    const forbidden = ['capacityAssurance', 'licenseAssurance', 'owner', 'publisher', 'rarity', 'scoreBonus'];
    for (const key of forbidden) {
      if (key in opened.body) {
        return reply.code(400).send({
          error: '不能自行声明核验等级、稀缺加成或出版者身份',
          code: 'assurance-not-offered',
        });
      }
    }
    const releaseFingerprint = opened.body.releaseFingerprint;
    if (typeof releaseFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(releaseFingerprint)) {
      return reply.code(400).send({ error: 'releaseFingerprint 必填', code: 'release-fingerprint' });
    }
    const release = await app.db.query.provenanceReleases.findFirst({
      where: eq(provenanceReleases.fingerprint, releaseFingerprint),
    });
    if (!release) return reply.code(404).send({ error: 'release 不存在', code: 'release-not-found' });
    const operator = optionalText(opened.body.operatorDeclaration, 128);
    if (operator === 'invalid') return reply.code(400).send({ error: 'operatorDeclaration 过长', code: 'operator' });
    const license = optionalText(opened.body.licenseAssertion, 280);
    if (license === 'invalid') return reply.code(400).send({ error: 'licenseAssertion 过长', code: 'license' });
    const capacity = optionalCapacity(opened.body.declaredCapacity);
    if (capacity === 'invalid') return reply.code(400).send({ error: 'declaredCapacity 必须是 0 到 1000000 的整数', code: 'capacity' });

    const id = `inst-${randomUUID()}`;
    await app.db.insert(provenanceInstances).values({
      id,
      agentId: opened.agent.id,
      releaseFingerprint,
      operatorDeclaration: operator,
      declaredCapacity: capacity,
      capacityAssurance: ASSURANCE.selfDeclared,
      licenseAssertion: license,
      licenseAssurance: ASSURANCE.selfDeclared,
    });
    return reply.code(201).send({
      instanceId: id,
      agentId: opened.agent.id,
      releaseFingerprint,
      operatorDeclaration: operator,
      operatorAssurance: ASSURANCE.selfDeclared,
      declaredCapacity: capacity,
      capacityAssurance: ASSURANCE.selfDeclared,
      licenseAssertion: license,
      licenseAssurance: ASSURANCE.selfDeclared,
      inherited: { identity: false, fulfillment: false, capacity: false },
      ...signatureFacts(),
    });
  });

  app.post('/provenance/bindings', async (req, reply) => {
    if (limited(reply, req, 'write')) return;
    const opened = await openSigned(app, req.body, reply);
    if (!opened) return;
    if (opened.action !== 'bind-evidence') {
      return reply.code(400).send({ error: 'action 必须是 bind-evidence', code: 'action' });
    }
    const evidenceId = opened.body.evidenceId;
    const scope = opened.body.scope;
    if (typeof evidenceId !== 'string' || !(EVIDENCE_SCOPES as readonly string[]).includes(String(scope))) {
      return reply.code(400).send({ error: 'evidenceId 与 scope 必填', code: 'binding' });
    }
    const row = await app.db.query.evidence.findFirst({ where: eq(evidence.id, evidenceId) });
    if (!row || row.agentId !== opened.agent.id) {
      return reply.code(403).send({ error: '只能绑定自己名下的证据', code: 'not-owner' });
    }
    const existing = await app.db.query.provenanceEvidenceBindings.findFirst({
      where: eq(provenanceEvidenceBindings.evidenceId, evidenceId),
    });
    if (existing) {
      return reply.code(200).send({ evidenceId, scope: existing.scope, reused: true, assurance: ASSURANCE.signedRecord });
    }
    let releaseFingerprint: string | null = null;
    let instanceId: string | null = null;
    if (scope === 'capability') {
      if (typeof opened.body.releaseFingerprint !== 'string') {
        return reply.code(400).send({ error: 'capability 绑定必须给出 releaseFingerprint', code: 'release-fingerprint' });
      }
      releaseFingerprint = opened.body.releaseFingerprint;
      const release = await app.db.query.provenanceReleases.findFirst({
        where: eq(provenanceReleases.fingerprint, releaseFingerprint),
      });
      if (!release) return reply.code(404).send({ error: 'release 不存在', code: 'release-not-found' });
      if (opened.body.instanceId !== undefined) {
        return reply.code(400).send({ error: 'capability 绑定不接受 instanceId', code: 'binding' });
      }
    } else {
      if (typeof opened.body.instanceId !== 'string') {
        return reply.code(400).send({ error: '该 scope 必须绑定到本身份的 instance', code: 'instance' });
      }
      instanceId = opened.body.instanceId;
      const instance = await app.db.query.provenanceInstances.findFirst({
        where: eq(provenanceInstances.id, instanceId),
      });
      if (!instance || instance.agentId !== opened.agent.id) {
        return reply.code(403).send({ error: 'instance 不属于签名身份', code: 'not-owner' });
      }
      if (opened.body.releaseFingerprint !== undefined) {
        return reply.code(400).send({ error: 'fulfillment、identity、capacity 不能绑到 release 上被引用', code: 'binding' });
      }
    }
    await app.db.insert(provenanceEvidenceBindings).values({
      evidenceId,
      scope: scope as EvidenceScope,
      releaseFingerprint,
      instanceId,
    });
    return reply.code(201).send({
      evidenceId,
      scope,
      releaseFingerprint,
      instanceId,
      reused: false,
      assurance: ASSURANCE.signedRecord,
      referable: scope === 'capability',
    });
  });

  app.post('/provenance/references', async (req, reply) => {
    if (limited(reply, req, 'write')) return;
    const opened = await openSigned(app, req.body, reply);
    if (!opened) return;
    if (opened.action !== 'reference-capability') {
      return reply.code(400).send({ error: 'action 必须是 reference-capability', code: 'action' });
    }
    const targetInstanceId = opened.body.targetInstanceId;
    const sourceEvidenceId = opened.body.sourceEvidenceId;
    if (typeof targetInstanceId !== 'string' || typeof sourceEvidenceId !== 'string') {
      return reply.code(400).send({ error: 'targetInstanceId 与 sourceEvidenceId 必填', code: 'reference' });
    }
    const instance = await app.db.query.provenanceInstances.findFirst({
      where: eq(provenanceInstances.id, targetInstanceId),
    });
    if (!instance || instance.agentId !== opened.agent.id) {
      return reply.code(403).send({ error: '只能为自己的 instance 建立引用', code: 'not-owner' });
    }
    const source = await app.db.query.evidence.findFirst({ where: eq(evidence.id, sourceEvidenceId) });
    if (!source) return reply.code(404).send({ error: '证据不存在', code: 'evidence-not-found' });
    const binding = await app.db.query.provenanceEvidenceBindings.findFirst({
      where: eq(provenanceEvidenceBindings.evidenceId, sourceEvidenceId),
    });
    const sourceRelease = binding?.releaseFingerprint
      ? await app.db.query.provenanceReleases.findFirst({
          where: eq(provenanceReleases.fingerprint, binding.releaseFingerprint),
        })
      : null;
    const targetRelease = await app.db.query.provenanceReleases.findFirst({
      where: eq(provenanceReleases.fingerprint, instance.releaseFingerprint),
    });
    const decision = decideCapabilityReference({
      sourceScope: binding?.scope ?? 'other',
      sourceDimension: source.dimension,
      sourceEvidenceSource: source.source,
      sourceFingerprint: binding?.releaseFingerprint ?? null,
      targetFingerprint: instance.releaseFingerprint,
      sourceVersionLabel: sourceRelease?.versionLabel ?? null,
      targetVersionLabel: targetRelease?.versionLabel ?? null,
    });
    if (!decision.ok) {
      return reply.code(409).send({
        error: '引用被拒绝',
        code: decision.code,
        ignoredClientVersionLabel: 'claimedVersionLabel' in opened.body,
        countsTowardScore: false,
      });
    }
    const prior = await app.db.query.provenanceReferences.findFirst({
      where: and(
        eq(provenanceReferences.targetInstanceId, targetInstanceId),
        eq(provenanceReferences.sourceEvidenceId, sourceEvidenceId),
      ),
    });
    if (prior) {
      return reply.code(200).send({
        id: prior.id,
        reused: true,
        countsTowardScore: false,
        assurance: ASSURANCE.serverCheckedFingerprint,
        ...signatureFacts(),
      });
    }
    const id = `pref-${randomUUID()}`;
    await app.db.insert(provenanceReferences).values({
      id,
      targetInstanceId,
      targetAgentId: opened.agent.id,
      sourceEvidenceId,
      sourceAgentId: source.agentId,
      releaseFingerprint: instance.releaseFingerprint,
      assurance: ASSURANCE.serverCheckedFingerprint,
    });
    return reply.code(201).send({
      id,
      reused: false,
      countsTowardScore: false,
      assurance: ASSURANCE.serverCheckedFingerprint,
      assuranceNote:
        'The server recomputed both release fingerprints and required them to match, including config, tools, and evaluation conditions. It did not re-run the exam.',
      ...signatureFacts(),
    });
  });

  app.get('/agents/:id/provenance', async (req, reply) => {
    if (limited(reply, req, 'read')) return;
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: 'agent 不存在', code: 'agent-not-found' });
    return reply.send(await agentProvenance(app, agent.id));
  });

  app.get('/provenance/releases/:fingerprint', async (req, reply) => {
    if (limited(reply, req, 'read')) return;
    const { fingerprint } = req.params as { fingerprint: string };
    const release = await app.db.query.provenanceReleases.findFirst({
      where: eq(provenanceReleases.fingerprint, fingerprint),
    });
    if (!release) return reply.code(404).send({ error: 'release 不存在', code: 'release-not-found' });
    const signatures = await app.db.query.provenanceReleaseSignatures.findMany({
      where: eq(provenanceReleaseSignatures.fingerprint, fingerprint),
    });
    const instances = await app.db.query.provenanceInstances.findMany({
      where: eq(provenanceInstances.releaseFingerprint, fingerprint),
    });
    const bindings = await app.db.query.provenanceEvidenceBindings.findMany({
      where: eq(provenanceEvidenceBindings.releaseFingerprint, fingerprint),
    });
    const capability = [];
    for (const binding of bindings) {
      if (binding.scope !== 'capability') continue;
      const row = await app.db.query.evidence.findFirst({ where: eq(evidence.id, binding.evidenceId) });
      if (!row) continue;
      capability.push({
        evidenceId: row.id,
        agentId: row.agentId,
        dimension: row.dimension,
        source: row.source,
        scope: binding.scope,
        assurance: ASSURANCE.signedRecord,
        referable: (REFERENCABLE_EXAM_SOURCES as readonly string[]).includes(row.source),
      });
    }
    return reply.send({
      fingerprint: release.fingerprint,
      versionLabel: release.versionLabel,
      configHash: release.configHash,
      tools: release.tools,
      evalConditions: release.evalConditions,
      publishers: signatures.map((sig) => ({
        agentId: sig.publisherAgentId,
        keyFingerprint: pubkeyFingerprint(sig.publisherPubkey),
        assurance: ASSURANCE.signedRecord,
      })),
      capabilityEvidence: capability,
      instances: instances.map((row) => ({
        instanceId: row.id,
        agentId: row.agentId,
        operatorDeclaration: row.operatorDeclaration,
        operatorAssurance: ASSURANCE.selfDeclared,
        declaredCapacity: row.declaredCapacity,
        capacityAssurance: row.capacityAssurance,
        licenseAssertion: row.licenseAssertion,
        licenseAssurance: row.licenseAssurance,
      })),
      capacity: capacitySummary(
        instances.map((row) => ({ instanceId: row.id, declaredCapacity: row.declaredCapacity })),
      ),
      ...signatureFacts(),
    });
  });
}

function optionalText(value: unknown, max: number): string | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) return 'invalid';
  return value.trim();
}

function optionalCapacity(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) return 'invalid';
  return value;
}

interface Opened {
  action: string;
  pubkey: string;
  nonce: string;
  agent: { id: string; owner: string | null; pubkey: string | null };
  body: Record<string, unknown>;
}

async function openSigned(
  app: FastifyInstance,
  raw: unknown,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<Opened | null> {
  if (!raw || typeof raw !== 'object') {
    reply.code(400).send({ error: '缺少请求体', code: 'body' });
    return null;
  }
  const envelope = raw as Record<string, unknown>;
  const { action, pubkey, nonce, timestamp, signature, body } = envelope;
  if (typeof action !== 'string' || typeof pubkey !== 'string' || !pubkey.includes('BEGIN PUBLIC KEY')) {
    reply.code(400).send({ error: 'action 与 pubkey 必填', code: 'envelope' });
    return null;
  }
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) {
    reply.code(400).send({ error: 'nonce 必填', code: 'nonce' });
    return null;
  }
  if (typeof timestamp !== 'number' || typeof signature !== 'string' || !body || typeof body !== 'object' || Array.isArray(body)) {
    reply.code(400).send({ error: 'timestamp、signature、body 必填', code: 'envelope' });
    return null;
  }
  if (Math.abs(Date.now() - timestamp) > TIMESTAMP_WINDOW_MS) {
    reply.code(409).send({ error: 'timestamp 超出允许窗口', code: 'timestamp-window' });
    return null;
  }
  try {
    await app.db.insert(ingestNonces).values({ nonce });
  } catch {
    reply.code(409).send({ error: 'nonce 已使用（疑似重放）', code: 'replay' });
    return null;
  }
  const { signature: _sig, ...payload } = envelope;
  if (!verifyPayload(pubkey, payload, signature)) {
    reply.code(401).send({ error: '签名验证失败', code: 'bad-signature' });
    return null;
  }
  const agent = await app.db.query.agents.findFirst({ where: eq(agents.pubkey, pubkey) });
  if (!agent) {
    reply.code(403).send({ error: '签名钥尚未注册为身份', code: 'unregistered-key' });
    return null;
  }
  return { action, pubkey, nonce, agent, body: body as Record<string, unknown> };
}

async function agentProvenance(app: FastifyInstance, agentId: string) {
  const signatures = await app.db.query.provenanceReleaseSignatures.findMany({
    where: eq(provenanceReleaseSignatures.publisherAgentId, agentId),
  });
  const instances = await app.db.query.provenanceInstances.findMany({
    where: eq(provenanceInstances.agentId, agentId),
  });
  const references = await app.db.query.provenanceReferences.findMany({
    where: eq(provenanceReferences.targetAgentId, agentId),
  });
  const releases = [];
  for (const sig of signatures) {
    const release = await app.db.query.provenanceReleases.findFirst({
      where: eq(provenanceReleases.fingerprint, sig.fingerprint),
    });
    if (!release) continue;
    releases.push({
      fingerprint: release.fingerprint,
      versionLabel: release.versionLabel,
      tools: release.tools,
      evalConditions: release.evalConditions,
      assurance: ASSURANCE.signedRecord,
      publisherKeyFingerprint: pubkeyFingerprint(sig.publisherPubkey),
    });
  }
  return {
    agentId,
    releases,
    instances: instances.map((row) => ({
      instanceId: row.id,
      releaseFingerprint: row.releaseFingerprint,
      operatorDeclaration: row.operatorDeclaration,
      operatorAssurance: ASSURANCE.selfDeclared,
      declaredCapacity: row.declaredCapacity,
      capacityAssurance: row.capacityAssurance,
      licenseAssertion: row.licenseAssertion,
      licenseAssurance: row.licenseAssurance,
    })),
    capabilityReferences: references.map((row) => ({
      id: row.id,
      sourceEvidenceId: row.sourceEvidenceId,
      sourceAgentId: row.sourceAgentId,
      releaseFingerprint: row.releaseFingerprint,
      assurance: row.assurance,
      countsTowardScore: false,
    })),
    capacity: capacitySummary(
      instances.map((row) => ({ instanceId: row.id, declaredCapacity: row.declaredCapacity })),
    ),
    ...signatureFacts(),
  };
}
