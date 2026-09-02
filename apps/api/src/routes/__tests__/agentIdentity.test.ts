/**
 * 密钥即身份：同名 agent 补绑 pubkey（dogfood 2026-09-01 发现的 401 bug）。
 * 复现路径：POST /agents 创建无密钥 agent → /arena/register 同名+密钥（CLI 提示"同钥复用"）
 * → 发事件 401 "pubkey 与 agent 注册密钥不符"（pubkey 从未绑定）。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ensureKeypair, signPayload } from '@acl/sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents } from '../../db/schema';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;
let keys: ReturnType<typeof ensureKeypair>;
let dirs: string[] = [];

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces CASCADE`,
  );
  const d = mkdtempSync(join(tmpdir(), 'acl-identity-'));
  dirs = [d];
  keys = ensureKeypair(d);
});

afterAll(async () => {
  await app?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('upsertAgentIdentity 同名补绑 pubkey', () => {
  it('无密钥 agent 同名 arena 注册后必须绑定 pubkey，事件验签通过（端到端）', async () => {
    // 1) 普通注册（无密钥）——dogfood 场景：先 POST /agents 再跑 CLI
    const reg = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'legacy-agent' },
    });
    expect(reg.statusCode).toBe(201);
    const agentId = reg.json().id;

    // 2) Arena 同名注册 + 密钥 → 复用 agentId 且必须补绑 pubkey
    const arena = await app.inject({
      method: 'POST',
      url: '/arena/register',
      payload: { name: 'legacy-agent', pubkey: keys.publicKeyPem },
    });
    expect(arena.statusCode).toBe(201);
    expect(arena.json().agentId).toBe(agentId);

    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(row?.pubkey).toBe(keys.publicKeyPem);
    expect(row?.verificationLevel).toBe('basic');

    // 3) 端到端：建会话 → 该身份发事件 → 不得 401
    const sess = await app.inject({
      method: 'POST',
      url: '/arena/sessions',
      payload: { scenario: 'e2e-identity', buyerAgentId: agentId },
    });
    expect(sess.statusCode).toBe(201);
    const sid = sess.json().id;

    const envelope = {
      sessionId: sid,
      seq: 1,
      type: 'OFFER',
      fromAgent: agentId,
      payload: { price: 10 },
      nonce: `n-${randomUUID()}`,
      ts: Date.now(),
    };
    const ev = await app.inject({
      method: 'POST',
      url: `/arena/sessions/${sid}/events`,
      payload: {
        ...envelope,
        sig: signPayload(keys.privateKeyPem, envelope),
        pubkey: keys.publicKeyPem,
      },
    });
    expect(ev.statusCode).toBe(201);
  });

  it('已绑钥 agent 换钥注册 → 403 name-taken（钥不可被覆盖）', async () => {
    const d = mkdtempSync(join(tmpdir(), 'acl-identity-2-'));
    dirs.push(d);
    const other = ensureKeypair(d);
    const dup = await app.inject({
      method: 'POST',
      url: '/arena/register',
      payload: { name: 'legacy-agent', pubkey: other.publicKeyPem },
    });
    expect(dup.statusCode).toBe(403);
  });
});
