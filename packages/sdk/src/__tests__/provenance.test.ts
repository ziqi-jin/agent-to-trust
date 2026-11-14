import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyPayload } from '../keys.js';
import { buildProvenanceEnvelope, fingerprintRelease, parseReleaseMaterial } from '../provenance.js';

describe('buildProvenanceEnvelope', () => {
  it('signs a release whose fingerprint ignores key order and includes config', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const keys = {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const material = {
      versionLabel: '1.2.0',
      tools: ['shell', 'browser'],
      evalConditions: { suite: 'exam-v1', benchmarkVersion: '1.2.0' },
      config: { prompt: 'exam', temperature: 0 },
    };
    const envelope = buildProvenanceEnvelope('publish-release', { material }, keys, randomUUID());
    const { signature, ...payload } = envelope;
    expect(verifyPayload(keys.publicKeyPem, payload, signature as string)).toBe(true);
    const parsed = parseReleaseMaterial(material);
    if (!parsed.ok) throw new Error(parsed.code);
    const flipped = parseReleaseMaterial({
      config: { temperature: 0, prompt: 'exam' },
      evalConditions: { benchmarkVersion: '1.2.0', suite: 'exam-v1' },
      tools: ['browser', 'shell'],
      versionLabel: '1.2.0',
    });
    if (!flipped.ok) throw new Error(flipped.code);
    expect(fingerprintRelease(parsed.value)).toBe(fingerprintRelease(flipped.value));
    const spoof = parseReleaseMaterial({ ...material, config: { prompt: 'exam', temperature: 1 } });
    if (!spoof.ok) throw new Error(spoof.code);
    expect(fingerprintRelease(spoof.value)).not.toBe(fingerprintRelease(parsed.value));
  });
});