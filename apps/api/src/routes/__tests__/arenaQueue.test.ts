/**
 * /arena/queue 路由测试（T12）：
 * - 门槛拒绝：无 real-benchmark 证据 → 403
 * - 两人撮合：队列两个合格 agent → 同步互为对手（先入=buyer）
 * - solo 平台对家：QUEUE_SOLO_WAIT_MS 超时 → 配平台脚本买家（引擎后台跑，测试 teardown 停掉）
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ensureKeypair } from '@acl/sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { arenaSessions, creditScores, evidence } from '../../db/schema';
import { resetQueueForTests, stopAllQueueEngines } from '../arenaQueue';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;
let platformDir: string;
const dirs: string[] = [];

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  platformDir = mkdtempSync(join(tmpdir(), 'aclq-platform-'));
  dirs.push(platformDir);
  process.env.PLATFORM_KEY_DIR = platformDir;
});

afterAll(() => {
  stopAllQueueEngines();
  delete process.env.PLATFORM_KEY_DIR;
  delete process.env.QUEUE_SOLO_WAIT_MS;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// 内存队列是模块级单例：每个用例前清空，避免上一用例的 waiting entry 影响撮合路径
beforeEach(() => {
  resetQueueForTests();
});

/** 造一个合格身份：用外部钥注册 + real-benchmark 证据 + score≥800。 */
async function makeQualifiedAgent(name: string, pubkey: string): Promise<void> {
  const reg = await app.inject({
    method: 'POST',
    url: '/arena/register',
    payload: { name, pubkey },
  });
  expect(reg.statusCode).toBe(201);
  const agentId = reg.json().agentId as string;
  // 门槛只查 evidence.source + creditScores.score，直接注入测试夹具
  await db.insert(evidence).values({
    id: `ev-${randomUUID().slice(0, 8)}`,
    agentId,
    dimension: 'capability',
    source: 'real-benchmark',
    sourceType: 'benchmark',
    result: 'success',
    value: 0.9,
  });
  await db.insert(creditScores).values({
    id: `cs-${randomUUID().slice(0, 8)}`,
    agentId,
    score: 800,
    modelVersion: 'test',
  });
}

async function enqueue(name: string, pubkey: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/arena/queue',
    payload: { name, pubkey },
  });
  if (res.statusCode !== 201) console.log('[enqueue non-201]', name, res.body);
  return res;
}

describe('POST /arena/queue — 准入门槛', () => {
  it('无考场证据的 agent 被拒（403）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aclq-agent-'));
    dirs.push(dir);
    const keys = ensureKeypair(dir);
    const res = await enqueue(`gate-reject-${randomUUID().slice(0, 6)}`, keys.publicKeyPem);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('考场门槛');
  });

  it('同名异钥被拒（403）', async () => {
    const name = `taken-${randomUUID().slice(0, 6)}`;
    const dir1 = mkdtempSync(join(tmpdir(), 'aclq-agent-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'aclq-agent-'));
    dirs.push(dir1, dir2);
    await makeQualifiedAgent(name, ensureKeypair(dir1).publicKeyPem);
    const res = await enqueue(name, ensureKeypair(dir2).publicKeyPem);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('已被其他密钥绑定');
  });
});

describe('POST /arena/queue — 两人撮合', () => {
  it('两个合格 agent 排队 → 同步互为对手（先入=buyer），票转为 matched', async () => {
    const aName = `pair-a-${randomUUID().slice(0, 6)}`;
    const bName = `pair-b-${randomUUID().slice(0, 6)}`;
    const dirA = mkdtempSync(join(tmpdir(), 'aclq-agent-'));
    const dirB = mkdtempSync(join(tmpdir(), 'aclq-agent-'));
    dirs.push(dirA, dirB);
    const keysA = ensureKeypair(dirA);
    const keysB = ensureKeypair(dirB);

    await makeQualifiedAgent(aName, keysA.publicKeyPem);
    await makeQualifiedAgent(bName, keysB.publicKeyPem);

    const resA = await enqueue(aName, keysA.publicKeyPem);
    expect(resA.statusCode).toBe(201);
    expect(resA.json().status).toBe('waiting');

    const resB = await enqueue(bName, keysB.publicKeyPem);
    expect(resB.statusCode).toBe(201);
    expect(resB.json().status).toBe('matched');
    const sessionId = resB.json().sessionId as string;

    // 会话角色：先入队者 = buyer
    const [session] = await db
      .select()
      .from(arenaSessions)
      .where(eq(arenaSessions.id, sessionId));
    expect(session).toBeDefined();
    expect(session!.scenario).toBe('标准交易');
    expect(session!.buyerAgentId).toBeTruthy();
    expect(session!.sellerAgentId).toBeTruthy();
    expect(session!.buyerAgentId).not.toBe(session!.sellerAgentId);
  });

  it('重复排队幂等：同一 agent 已 waiting 时复用票', async () => {
    const name = `dup-${randomUUID().slice(0, 6)}`;
    const dir = mkdtempSync(join(tmpdir(), 'aclq-agent-'));
    dirs.push(dir);
    const keys = ensureKeypair(dir);
    await makeQualifiedAgent(name, keys.publicKeyPem);

    const res1 = await enqueue(name, keys.publicKeyPem);
    expect(res1.json().status).toBe('waiting');
    const ticket1 = res1.json().ticket as string;

    const res2 = await enqueue(name, keys.publicKeyPem);
    expect(res2.json().ticket).toBe(ticket1);
  });
});

describe('POST /arena/queue — solo 平台对家撮合', () => {
  it('单人排队超时 → 自动配平台脚本买家', async () => {
    process.env.QUEUE_SOLO_WAIT_MS = '300';
    const name = `solo-${randomUUID().slice(0, 6)}`;
    const dir = mkdtempSync(join(tmpdir(), 'aclq-agent-'));
    dirs.push(dir);
    const keys = ensureKeypair(dir);
    await makeQualifiedAgent(name, keys.publicKeyPem);

    const res = await enqueue(name, keys.publicKeyPem);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('waiting');
    const ticket = res.json().ticket as string;

    // solo wait=300ms，引擎 2s 轮询；等待后查票
    let sessionId: string | undefined;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = await app.inject({ method: 'GET', url: `/arena/queue/${ticket}` });
      const body = st.json() as { status: string; sessionId?: string };
      if (body.status === 'matched') {
        sessionId = body.sessionId;
        break;
      }
    }
    expect(sessionId).toBeDefined();

    const [session] = await db
      .select()
      .from(arenaSessions)
      .where(eq(arenaSessions.id, sessionId!));
    expect(session).toBeDefined();
    // 平台买家 = buyer，用户 = seller
    expect(session!.buyerAgentId).toContain('arena-buyer-platform');
    expect(session!.sellerAgentId).not.toContain('arena-buyer-platform');
  }, 20000);
});
