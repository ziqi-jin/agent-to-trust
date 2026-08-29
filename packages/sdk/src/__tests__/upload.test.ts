import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureKeypair, verifyPayload } from '../keys.js';
import { runSuite } from '../runner.js';
import { buildIngestPayload, uploadResults } from '../upload.js';

const apiBase = 'https://api.test';

async function fixtureSuite() {
  return runSuite({ reply: async () => '不知道' }, { filter: (id) => id === 'neg-keyboard-price' });
}

describe('buildIngestPayload', () => {
  it('contains required fields and valid signature', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-up-'));
    const keypair = ensureKeypair(dir);
    const suite = await fixtureSuite();
    const payload = buildIngestPayload(suite, { name: 'test-agent', endpoint: 'http://x' }, keypair);
    expect(payload.agentName).toBe('test-agent');
    expect(payload.benchmarkVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(payload.nonce).toBeTruthy();
    expect(typeof payload.timestamp).toBe('number');
    const { signature, ...body } = payload;
    expect(verifyPayload(keypair.publicKeyPem, body, signature as string)).toBe(true);
  });
});

describe('uploadResults', () => {
  it('posts to /ingest/results and parses response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-up-'));
    const keypair = ensureKeypair(dir);
    const suite = await fixtureSuite();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ agentId: 'ag_1', verified: false }), { status: 200 }),
    );
    const res = await uploadResults(suite, { meta: { name: 'a' }, apiBase, dir, keypair, fetchImpl });
    expect(res.agentId).toBe('ag_1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${apiBase}/ingest/results`);
    expect(init.method).toBe('POST');
  });

  it('retries once on 5xx then succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-up-'));
    const keypair = ensureKeypair(dir);
    const suite = await fixtureSuite();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ agentId: 'ag_2', verified: false }), { status: 200 }),
      );
    const res = await uploadResults(suite, { meta: { name: 'a' }, apiBase, dir, keypair, fetchImpl });
    expect(res.agentId).toBe('ag_2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-up-'));
    const keypair = ensureKeypair(dir);
    const suite = await fixtureSuite();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad signature', { status: 401 }));
    await expect(
      uploadResults(suite, { meta: { name: 'a' }, apiBase, dir, keypair, fetchImpl }),
    ).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
