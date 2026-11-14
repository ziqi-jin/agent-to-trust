import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ASSURANCE,
  NOT_INHERITED_BY_CLONES,
  RARITY_CREDIT_BONUS,
  SCORING_NOTE,
  SIGNATURE_DOES_NOT_PROVE,
  capacitySummary,
  decideCapabilityReference,
  fingerprintRelease,
  parseReleaseMaterial,
  sha256Hex,
} from '../provenance';

const base = {
  versionLabel: '1.2.0',
  config: { temperature: 0, prompt: 'exam' },
  tools: ['browser', 'shell'],
  evalConditions: { benchmarkVersion: '1.2.0', suite: 'exam-v1' },
};

function material(overrides: Record<string, unknown> = {}) {
  const parsed = parseReleaseMaterial({ ...base, ...overrides });
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.value;
}

describe('sha256', () => {
  it('matches the Node hash and the empty-string test vector', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const sample = canonicalSample();
    expect(sha256Hex(sample)).toBe(createHash('sha256').update(sample).digest('hex'));
  });
});

function canonicalSample(): string {
  return JSON.stringify({ tools: ['browser', 'shell'], versionLabel: '1.2.0' });
}

describe('release fingerprint', () => {
  it('is stable across key order and tool order', () => {
    const a = material();
    const b = parseReleaseMaterial({
      evalConditions: { suite: 'exam-v1', benchmarkVersion: '1.2.0' },
      tools: ['shell', 'browser'],
      config: { prompt: 'exam', temperature: 0 },
      versionLabel: '1.2.0',
    });
    if (!b.ok) throw new Error(b.code);
    expect(fingerprintRelease(a)).toBe(fingerprintRelease(b.value));
  });

  it('changes when config changes even if the version label stays the same', () => {
    const a = fingerprintRelease(material());
    const b = fingerprintRelease(material({ config: { temperature: 1, prompt: 'exam' } }));
    expect(a).not.toBe(b);
  });

  it('changes when tools or evaluation conditions change', () => {
    const a = fingerprintRelease(material());
    expect(fingerprintRelease(material({ tools: ['browser'] }))).not.toBe(a);
    expect(
      fingerprintRelease(material({ evalConditions: { benchmarkVersion: '1.2.0', suite: 'exam-v2' } })),
    ).not.toBe(a);
  });

  it('rejects a non-object config and oversized labels', () => {
    expect(parseReleaseMaterial({ ...base, config: ['nope'] }).ok).toBe(false);
    expect(parseReleaseMaterial({ ...base, versionLabel: '' }).ok).toBe(false);
  });
});

describe('capability reference decision', () => {
  const fp = fingerprintRelease(material());
  const other = fingerprintRelease(material({ config: { temperature: 0.2, prompt: 'exam' } }));

  it('allows a reference only when fingerprints match', () => {
    expect(
      decideCapabilityReference({
        sourceScope: 'capability',
        sourceDimension: 'capability',
        sourceEvidenceSource: 'real-benchmark',
        sourceFingerprint: fp,
        targetFingerprint: fp,
        sourceVersionLabel: '1.2.0',
        targetVersionLabel: '1.2.0',
      }).ok,
    ).toBe(true);
  });

  it('does not treat a matching version label as the same release', () => {
    const decision = decideCapabilityReference({
      sourceScope: 'capability',
      sourceDimension: 'capability',
      sourceEvidenceSource: 'real-benchmark',
      sourceFingerprint: fp,
      targetFingerprint: other,
      sourceVersionLabel: '1.2.0',
      targetVersionLabel: '1.2.0',
    });
    expect(decision).toEqual({ ok: false, code: 'version-label-insufficient' });
  });

  it('refuses fulfillment, identity, and capacity scopes', () => {
    for (const sourceScope of ['fulfillment', 'identity', 'capacity']) {
      expect(
        decideCapabilityReference({
          sourceScope,
          sourceDimension: 'capability',
          sourceEvidenceSource: 'real-benchmark',
          sourceFingerprint: fp,
          targetFingerprint: fp,
          sourceVersionLabel: '1.2.0',
          targetVersionLabel: '1.2.0',
        }),
      ).toEqual({ ok: false, code: 'scope-not-referable' });
    }
  });

  it('refuses a capability label on a non-capability dimension or a self-report', () => {
    expect(
      decideCapabilityReference({
        sourceScope: 'capability',
        sourceDimension: 'delivery',
        sourceEvidenceSource: 'real-benchmark',
        sourceFingerprint: fp,
        targetFingerprint: fp,
        sourceVersionLabel: '1.2.0',
        targetVersionLabel: '1.2.0',
      }).ok,
    ).toBe(false);
    expect(
      decideCapabilityReference({
        sourceScope: 'capability',
        sourceDimension: 'capability',
        sourceEvidenceSource: 'self-reported',
        sourceFingerprint: fp,
        targetFingerprint: fp,
        sourceVersionLabel: '1.2.0',
        targetVersionLabel: '1.2.0',
      }),
    ).toEqual({ ok: false, code: 'source-not-exam' });
  });
});

describe('capacity and scoring boundaries', () => {
  it('does not sum self-declared capacity across instances', () => {
    const summary = capacitySummary([
      { instanceId: 'inst-a', declaredCapacity: 3 },
      { instanceId: 'inst-b', declaredCapacity: 5 },
    ]);
    expect(summary.total).toBeNull();
    expect(summary.perInstance.map((row) => row.declaredCapacity)).toEqual([3, 5]);
    expect(summary.perInstance.every((row) => row.assurance === ASSURANCE.selfDeclared)).toBe(true);
  });

  it('states what a signature is not, and adds no rarity bonus', () => {
    expect(SIGNATURE_DOES_NOT_PROVE).toEqual([
      'physical-uniqueness',
      'performance-truth',
      'exclusive-ownership',
      'scarcity',
    ]);
    expect(NOT_INHERITED_BY_CLONES).toEqual(['identity', 'fulfillment', 'capacity']);
    expect(RARITY_CREDIT_BONUS).toBe(0);
    expect(SCORING_NOTE).toContain('baseline-v0.3');
  });
});
