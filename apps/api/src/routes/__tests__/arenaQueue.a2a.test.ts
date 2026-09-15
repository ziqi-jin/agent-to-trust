/**
 * Task 8 集成测试：A2A 开局入口（`POST /arena/connections/:id/runs`）。
 *
 * 覆盖（brief 六断言）：
 *   1. 合法连接 + 合法 token + arenaReady card → 2xx 且返回 sessionId；库里该 session `adapter='a2a'`。
 *   2. token 不对 → 401，且不建 session。
 *   3. 连接不存在 / 已 revoked → 4xx，不建 session。
 *   4. card 未 arenaReady → 4xx，不建 session。
 *   5. `fetchAgentCard` 失败（404 / 网络错误）→ 4xx，不建 session。
 *   6. 桥跑完一局（假对端回 REJECT）→ `a2a_rounds` / `a2a_invalid_rounds` 落库。
 *
 * 只用 acl_test 库；卡片与 A2A 消息走注入式假 `fetchImpl`（不真发网络）。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ensureKeypair } from 'sealit-sdk';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { arenaSessions } from '../../db/schema';
import { __clearCardCache, type AclAgentCard } from '../../a2a/card';
import { resetQueueForTests, stopAllQueueEngines, __setA2aRunOverrides } from '../arenaQueue';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');
if (TEST_URL.includes('://acl:acl@localhost:5432/acl') && !TEST_URL.includes('acl_test')) {
  throw new Error('拒绝在非 acl_test 库上跑 a2a 开局测试（生产库会被 TRUNCATE）');
}

const CARD_URL = 'https://a2a-user.example/.well-known/agent-card.json';

let app: FastifyInstance;
let db: Database;
let platformDir: string;
let platformPubkey: string;
const dirs: string[] = [];
let savedDeepseekKey: string | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** arenaReady 的 Agent Card（x-acl.arenaReady=true + negotiation skill）。 */
function arenaReadyCard(): AclAgentCard {
  return {
    name: 'A2A User Agent',
    description: 'a negotiation agent',
    url: 'https://a2a-user.example/a2a',
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{ id: 'negotiate', tags: ['negotiation'] }],
    'x-acl': { arenaReady: true },
  } as AclAgentCard;
}

/** 未过门槛的卡：`x-acl.arenaReady !== true`。 */
function notReadyCard(): AclAgentCard {
  const c = arenaReadyCard();
  return { ...c, 'x-acl': { arenaReady: false } };
}

/** 卡片 fetch：按 URL 分流（card → 固定卡；其余 → A2A message/send 脚本）。 */
function fetchCard(card: unknown, status = 200): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    return jsonResponse(card, status);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** 卡片 + A2A 消息路由器：card URL 回卡；message/send 回给定 parts。 */
function fetchRouted(parts: unknown[]): { fn: typeof fetch; cardCalls: () => number; msgCalls: () => number } {
  let card = 0;
  let msg = 0;
  const fn = (async (url: string) => {
    if (url === CARD_URL) {
      card += 1;
      return jsonResponse(arenaReadyCard());
    }
    msg += 1;
    return jsonResponse({ jsonrpc: '2.0', id: 'r', result: { parts } });
  }) as unknown as typeof fetch;
  return { fn, cardCalls: () => card, msgCalls: () => msg };
}

async function countSessions(): Promise<number> {
  const rows = await db.select({ id: arenaSessions.id }).from(arenaSessions);
  return rows.length;
}

/** 建一个平台公钥绑定的「用户 agent」+ 一条连接（走真实登记路由）。 */
async function setupConnection(
  cardUrl = CARD_URL,
): Promise<{ agentId: string; connectionId: string; token: string }> {
  const reg = await app.inject({
    method: 'POST',
    url: '/arena/register',
    payload: { name: `a2a-user-${randomUUID().slice(0, 6)}`, pubkey: platformPubkey },
  });
  expect(reg.statusCode).toBe(201);
  const agentId = reg.json().agentId as string;
  const conn = await app.inject({
    method: 'POST',
    url: '/arena/connections',
    payload: { agentId, cardUrl },
  });
  expect(conn.statusCode).toBe(201);
  return { agentId, connectionId: conn.json().connectionId as string, token: conn.json().token as string };
}

function run(connectionId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: `/arena/connections/${connectionId}/runs`,
    payload: body,
    headers,
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  platformDir = mkdtempSync(join(tmpdir(), 't8-a2a-platform-'));
  dirs.push(platformDir);
  process.env.PLATFORM_KEY_DIR = platformDir;
  platformPubkey = ensureKeypair(platformDir).publicKeyPem;
  // 强制 scripted 对家：避免测试环境带 key 时真调 LLM（慢/不稳定）。
  savedDeepseekKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

afterAll(() => {
  stopAllQueueEngines();
  __setA2aRunOverrides(undefined);
  if (savedDeepseekKey !== undefined) process.env.DEEPSEEK_API_KEY = savedDeepseekKey;
  delete process.env.PLATFORM_KEY_DIR;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(async () => {
  resetQueueForTests();
  __clearCardCache();
  __setA2aRunOverrides(undefined);
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agent_connections, agents CASCADE' as any),
  );
});

describe('Task 8 — A2A 开局入口', () => {
  it('1. 合法连接 + 合法 token + arenaReady card → 2xx + sessionId，且库里 adapter=a2a', async () => {
    const { agentId, connectionId, token } = await setupConnection();
    const { fn } = fetchCard(arenaReadyCard());
    // maxRounds=0：桥立刻退出，避免测试挂后台（本用例只验建会话）
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run(connectionId, { token });
    expect([200, 201, 202]).toContain(res.statusCode);
    const sessionId = res.json().sessionId as string;
    expect(typeof sessionId).toBe('string');

    const [session] = await db.select().from(arenaSessions).where(eq(arenaSessions.id, sessionId));
    expect(session).toBeTruthy();
    expect(session.adapter).toBe('a2a');
    expect(session.sellerAgentId).toBe(agentId);
    expect(session.a2aCardUrl).toBe(CARD_URL);
  });

  it('1b. token 也可走 Authorization: Bearer 头', async () => {
    const { connectionId, token } = await setupConnection();
    const { fn } = fetchCard(arenaReadyCard());
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run(connectionId, {}, { authorization: `Bearer ${token}` });
    expect([200, 201, 202]).toContain(res.statusCode);
    expect(typeof res.json().sessionId).toBe('string');
  });

  it('2. token 不对 → 401，且不建 session（连卡片都不拉）', async () => {
    const { connectionId } = await setupConnection();
    const { fn, calls } = fetchCard(arenaReadyCard());
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run(connectionId, { token: 'wrong-token-xxxx' });
    expect(res.statusCode).toBe(401);
    expect(await countSessions()).toBe(0);
    expect(calls.length).toBe(0); // 身份校验先于卡片读取
  });

  it('3a. 连接不存在 → 4xx，不建 session', async () => {
    const { fn } = fetchCard(arenaReadyCard());
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run('ac-does-not-exist', { token: 'whatever' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await countSessions()).toBe(0);
  });

  it('3b. 连接已 revoked → 4xx，不建 session', async () => {
    const { connectionId, token } = await setupConnection();
    const del = await app.inject({ method: 'DELETE', url: `/arena/connections/${connectionId}` });
    expect(del.statusCode).toBe(200);

    const { fn } = fetchCard(arenaReadyCard());
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run(connectionId, { token });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await countSessions()).toBe(0);
  });

  it('4. card 未 arenaReady → 4xx，不建 session', async () => {
    const { connectionId, token } = await setupConnection();
    const { fn } = fetchCard(notReadyCard());
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run(connectionId, { token });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await countSessions()).toBe(0);
  });

  it('5a. fetchAgentCard 404 → 4xx，不建 session', async () => {
    const { connectionId, token } = await setupConnection();
    const { fn } = fetchCard({ error: 'nope' }, 404);
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run(connectionId, { token });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await countSessions()).toBe(0);
  });

  it('5b. fetchAgentCard 网络错误 → 4xx，不建 session', async () => {
    const { connectionId, token } = await setupConnection();
    const fn = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    __setA2aRunOverrides({ fetchImpl: fn, maxRounds: 0 });

    const res = await run(connectionId, { token });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await countSessions()).toBe(0);
  });

  it('6. 桥跑完一局（假对端 REJECT）→ a2a_rounds / a2a_invalid_rounds 落库', async () => {
    const { connectionId, token } = await setupConnection();
    // 对家出 OFFER → 桥打 A2A → 假对端回 REJECT → 桥注入 seller REJECT → 会话终结、桥退出
    const { fn } = fetchRouted([{ kind: 'data', data: { aclAction: { type: 'REJECT' } } }]);
    __setA2aRunOverrides({ fetchImpl: fn, pollMs: 5, maxRounds: 5, maxWaitMs: 3000 });

    const res = await run(connectionId, { token });
    expect([200, 201, 202]).toContain(res.statusCode);
    const sessionId = res.json().sessionId as string;

    // 等桥退出后把 stats 落库
    let session: typeof arenaSessions.$inferSelect | undefined;
    for (let i = 0; i < 80; i += 1) {
      const [row] = await db.select().from(arenaSessions).where(eq(arenaSessions.id, sessionId));
      if (row && row.a2aRounds !== null) {
        session = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(session?.a2aRounds).toBe(1);
    expect(session?.a2aInvalidRounds).toBe(0);
  });
});
