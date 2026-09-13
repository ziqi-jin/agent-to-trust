/**
 * 审计 A4【P1·安全】POST /ingest/results 的 agentEndpoint 零校验 → 盲 SSRF。
 *
 * 证据：ingest.ts 只判 typeof string，直接交给 upsertAgentIdentity 落库；
 * reverify.ts 随后用服务端 fetch 盲打该 endpoint（15s 超时，无 SSRF 校验）。
 * SSRF 防护 isPublicEndpoint 已存在但只在 playground 使用。
 *
 * 修法：ingest 落库前用 isPublicEndpoint 校验 agentEndpoint，非法 → 400；
 * reverify 发起 fetch 前再校验一次（覆盖历史脏数据）→ 非法直接 basic，不发起请求。
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  buildIngestPayload,
  ensureKeypair,
  runSuite,
  signPayload,
  type SuiteResult,
} from 'sealit-sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, evidence } from '../../db/schema';
import { reverifyAgent } from '../../services/reverify';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;
let keypair: { publicKeyPem: string; privateKeyPem: string };
let suiteFixture: SuiteResult;

/** 任何真实网络出站都直接失败：本文件不应有真实 fetch（防止测试打外网/卡 15s）。 */
const fetchSpy = vi.fn(async () => {
  throw new Error('no network in test');
});

async function post(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/ingest/results',
    payload: body as Record<string, unknown>,
  });
}

/** 复用 SDK 组装器，再把 agentEndpoint 替换成任意（可能非法）值并重新签名。 */
function payloadWithEndpoint(name: string, endpoint: unknown): Record<string, unknown> {
  const base = buildIngestPayload(suiteFixture, { name }, keypair);
  const { signature: _s, ...rest } = base;
  const body = { ...rest, agentEndpoint: endpoint };
  return { ...body, signature: signPayload(keypair.privateKeyPem, body) };
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE evidence, credit_scores, score_snapshots, agents, ingest_nonces CASCADE`,
  );
  keypair = ensureKeypair(mkdtempSync(join(tmpdir(), 'acl-a4-')));
  suiteFixture = await runSuite({ reply: async () => '10' }, { filter: (id) => id === 'coding-sum' });
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('审计 A4：POST /ingest/results 拒绝非公网 agentEndpoint', () => {
  const cases: Array<[string, string]> = [
    ['环回 IPv4', 'http://127.0.0.1:9/v1'],
    ['云元数据', 'http://169.254.169.254/latest/meta-data'],
    ['私网', 'http://10.1.2.3:8080/v1'],
    ['localhost', 'http://localhost:8000/v1'],
    ['环回 IPv6', 'http://[::1]:9000/v1'],
    ['非 http(s) 协议', 'ftp://example.com/x'],
    ['非法 URL', 'not a url'],
  ];

  for (const [label, endpoint] of cases) {
    it(`${label} → 400，且不落库 agent`, async () => {
      const name = `a4-reject-${randomUUID().slice(0, 8)}`;
      const res = await post(payloadWithEndpoint(name, endpoint));
      expect(res.statusCode).toBe(400);
      const row = await db.query.agents.findFirst({ where: sql`name = ${name}` as never });
      expect(row).toBeUndefined();
    });
  }

  it('非字符串 endpoint → 400（零校验漏洞的另一种形态）', async () => {
    const res = await post(payloadWithEndpoint('a4-reject-nonstring', 12345));
    expect(res.statusCode).toBe(400);
    expect(
      await db.query.agents.findFirst({ where: sql`name = 'a4-reject-nonstring'` as never }),
    ).toBeUndefined();
  });

  it('公网 http(s) endpoint → 200 且落库', async () => {
    const name = `a4-accept-${randomUUID().slice(0, 8)}`;
    const res = await post(payloadWithEndpoint(name, 'https://agent.example.com/v1/chat'));
    expect(res.statusCode).toBe(200);
    const row = await db.query.agents.findFirst({ where: sql`name = ${name}` as never });
    expect(row?.endpoint).toBe('https://agent.example.com/v1/chat');
  });

  it('省略 endpoint → 200（model 模式不回归）', async () => {
    const name = `a4-nomodel-${randomUUID().slice(0, 8)}`;
    const payload = buildIngestPayload(suiteFixture, { name }, keypair);
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
  });
});

describe('审计 A4：reverify 对历史脏数据二次校验（不发请求）', () => {
  it('库内已有私网 endpoint → reverify basic，且不调用 fetch', async () => {
    const agentId = `ext-a4-dirty-${randomUUID().slice(0, 8)}`;
    await db.insert(agents).values({
      id: agentId,
      name: `a4-dirty-${randomUUID().slice(0, 8)}`,
      pubkey: keypair.publicKeyPem,
      endpoint: 'http://169.254.169.254/latest/meta-data',
      verificationLevel: 'basic',
    });
    // 有可复算的客观题证据，否则 reverify 会在 fetch 前就返回 basic（测不到校验点）
    await db.insert(evidence).values({
      id: randomUUID(),
      agentId,
      dimension: 'capability',
      source: 'real-benchmark',
      sourceType: 'real-benchmark',
      issuer: 'sdk',
      result: 'success',
      value: 0.5,
      evidenceUri: 'acl://benchmark/coding-sum',
    });
    fetchSpy.mockClear();
    expect(await reverifyAgent(app, agentId)).toBe('basic');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
