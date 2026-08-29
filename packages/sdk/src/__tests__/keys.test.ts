import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureKeypair, signPayload, verifyPayload } from '../keys.js';

describe('ensureKeypair', () => {
  it('generates once and reuses (idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-keys-'));
    const a = ensureKeypair(dir);
    const b = ensureKeypair(dir);
    expect(a.publicKeyPem).toBe(b.publicKeyPem);
    expect(a.privateKeyPem).toBe(b.privateKeyPem);
  });

  it('produces valid pem pair with private key 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-keys-'));
    const { publicKeyPem, privateKeyPem } = ensureKeypair(dir);
    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });
});

describe('sign/verify payload', () => {
  it('roundtrip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-keys-'));
    const { publicKeyPem, privateKeyPem } = ensureKeypair(dir);
    const payload = { b: 2, a: 'x', nested: { y: 1, x: 2 }, results: [{ v: 0.5 }] };
    const sig = signPayload(privateKeyPem, payload);
    expect(verifyPayload(publicKeyPem, payload, sig)).toBe(true);
  });

  it('rejects tampered payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-keys-'));
    const { publicKeyPem, privateKeyPem } = ensureKeypair(dir);
    const sig = signPayload(privateKeyPem, { score: 90 });
    expect(verifyPayload(publicKeyPem, { score: 99 }, sig)).toBe(false);
  });

  it('key order does not matter (canonical json)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-keys-'));
    const { publicKeyPem, privateKeyPem } = ensureKeypair(dir);
    const sig = signPayload(privateKeyPem, { a: 1, b: [1, { z: 2, y: 3 }] });
    expect(verifyPayload(publicKeyPem, { b: [1, { y: 3, z: 2 }], a: 1 }, sig)).toBe(true);
  });
});
