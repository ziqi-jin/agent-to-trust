/**
 * Task 10：端到端免 SDK 全链路（mock A2A server，node:http）。
 *
 * 目标：不引 SDK，纯 HTTP + JSON-RPC，把用户侧 A2A agent 跑通「登记 → 触发 → 结算 → 证据 → 榜单」：
 *   1. 起一个真实 `node:http` **mock A2A server**：实现 `GET /agent-card.json`（arenaReady 卡）
 *      + `POST /a2a`（JSON-RPC `message/send`，按回合返回 ACCEPT / DELIVER）。
 *   2. 经真实 `POST /arena/connections` 登记（Ruling 16：未知 name → 铸造平台托管身份）
 *      → 拿 `{connectionId, token, agentId}`。
 *   3. 经真实 `POST /arena/connections/:id/runs` 触发 → 202 + `{sessionId}`。
 *   4. 桥（`runA2aBridge`）真打 mock server 收发 A2A 消息，签名注入内核安全链；
 *      平台买家引擎（live 人格，无 LLM 调用）OFFER → 用户 ACCEPT → 催交付 → 用户 DELIVER
 *      → VERIFY_RESULT(pass) → SETTLE。
 *   5. 断言（直读真实表）：
 *      - `arena_sessions.adapter='a2a'`、`a2a_card_url` = 登记 URL、`counterpart_mode='live'`、`status='settled'`；
 *      - `arena_sessions.a2a_rounds ≥ 1`；
 *      - 卖家 `evidence.source_type='arena-behavior-a2a'`；
 *      - 卖家有 `credit_scores` 行，且行为榜（`GET /leaderboard?board=behavior`）聚合可见。
 *
 * SSRF × 注入说明：mock server 跑在 127.0.0.1（SSRF 卡口会拒），故登记用**公网形态** URL，
 * 由 Ruling 16 指定的测试钩子 `__setA2aRunOverrides({ fetchImpl })` 把 card 读取与 message/send
 * 都转发到本机 mock server（真实 HTTP 往返，非模拟）。生产恒 undefined，走真实公网 fetch。
 *
 * 身份托管（Ruling 16）：卖家 agent 由登记铸造（pubkey 暂空），开局入口在 a2a 分支把其 pubkey
 * 绑到平台公钥；桥以平台私钥签名的注入因此通过内核「密钥即身份」校验——这是免 SDK 用户能跑通的关键。
 *
 * 名字用 `a2a-e2e-user` 而非 `e2e-user`：榜单公开口径以 `/^e2e/i` 前缀剔除 E2E 号，
 * 若以 `e2e` 开头则「榜单可见」断言恒不成立（口径与 stats/leaderboard 同源）。
 *
 * 只用 acl_test 库；红线见 TEST_URL 守卫。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ensureKeypair } from 'sealit-sdk';
import { buildApp } from '../../app';
import { __clearCardCache } from '../../a2a/card';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents, arenaSessions, creditScores, evidence } from '../../db/schema';
import { __setA2aRunOverrides, resetQueueForTests, stopAllQueueEngines } from '../../routes/arenaQueue';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');
if (TEST_URL.includes('://acl:acl@localhost:5432/acl') && !TEST_URL.includes('acl_test')) {
  throw new Error('拒绝在非 acl_test 库上跑 a2a e2e 测试（生产库会被 TRUNCATE）');
}

/** 登记进库的公网形态 card URL（SSRF 卡口放行）；实际内容由注入 fetchImpl 路由到 mock server。 */
const REGISTERED_CARD_URL = 'https://e2e.example.com/agent-card.json';
/** 用户 agent 名（不得以 e2e 开头，否则被榜单 E2E 口径剔除）。 */
const USER_AGENT_NAME = 'a2a-e2e-user';

let app: FastifyInstance;
let db: Database;
let server: Server;
let port = 0;
let localCardUrl = '';
const a2aSends: Array<{ auth?: string; body: Record<string, any> }> = [];
const dirs: string[] = [];
let platformDir = '';
let savedDeepseekKey: string | undefined;

/** arenaReady 的 Agent Card（x-acl.arenaReady=true + negotiation skill）；url 指向 mock 的 /a2a。 */
function arenaReadyCard(): Record<string, unknown> {
  return {
    name: 'A2A E2E User Agent',
    description: 'a negotiation agent',
    url: localCardUrl,
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{ id: 'negotiate', tags: ['negotiation'] }],
    'x-acl': { arenaReady: true },
  };
}

/** 起一个真实 `node:http` mock A2A server（卡片 + JSON-RPC message/send）。 */
function startMockA2aServer(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = req.url ?? '/';
        if (req.method === 'GET' && url.startsWith('/agent-card.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(arenaReadyCard()));
          return;
        }
        if (req.method === 'POST' && url.startsWith('/a2a')) {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, any> = {};
          try {
            body = JSON.parse(raw) as Record<string, any>;
          } catch {
            /* 坏 JSON：按空处理，下面仍回结构化错误 part */
          }
          a2aSends.push({ auth: req.headers['authorization'] as string | undefined, body });

          // 逐轮应答：首轮 ACCEPT；其后 DELIVER（artifacts[].parts + name:'delivery' 走 normalizeArtifact）；
          // 以 metadata.acl.round 为准（缺省按调用序）。
          const round = Number(body?.params?.message?.metadata?.acl?.round ?? a2aSends.length);
          const parts =
            round >= 2
              ? [
                  { kind: 'text', text: '交付' },
                  {
                    kind: 'artifact',
                    name: 'delivery',
                    data: { artifactKind: 'file', inline: 'artifact-body-e2e' },
                  },
                ]
              : [{ kind: 'data', data: { aclAction: { type: 'ACCEPT' } } }];

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? 'r', result: { parts } }),
          );
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      localCardUrl = `http://127.0.0.1:${port}/a2a`;
      resolve();
    });
  });
}

/**
 * 注入 fetchImpl：登记 URL → 真 GET mock 的 /agent-card.json；其余（message/send 打 card.url）→
 * 真 POST 转发到 mock server。全程真实 HTTP，仅把「公网 URL → 本机 mock」这一跳改道（SSRF 之外的测试钩子）。
 */
function makeInjectedFetch(): typeof fetch {
  return (async (url: string | URL, init?: unknown) => {
    const u = String(url);
    if (u === REGISTERED_CARD_URL) {
      return globalThis.fetch(`http://127.0.0.1:${port}/agent-card.json`, { method: 'GET' });
    }
    return globalThis.fetch(u, init as RequestInit);
  }) as unknown as typeof fetch;
}

async function truncate(): Promise<void> {
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agent_connections, agents CASCADE' as any),
  );
}

async function waitForTerminal(
  sessionId: string,
  timeoutMs = 15_000,
): Promise<typeof arenaSessions.$inferSelect | undefined> {
  const deadline = Date.now() + timeoutMs;
  let row: typeof arenaSessions.$inferSelect | undefined;
  while (Date.now() < deadline) {
    [row] = await db.select().from(arenaSessions).where(eq(arenaSessions.id, sessionId));
    if (row && (row.status === 'settled' || row.status === 'failed') && row.a2aRounds !== null) {
      return row;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return row;
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  platformDir = mkdtempSync(join(tmpdir(), 't10-a2a-platform-'));
  dirs.push(platformDir);
  process.env.PLATFORM_KEY_DIR = platformDir;
  ensureKeypair(platformDir);
  // 强制 live 对家：注入 dummy key 让 buildLiveClient() 非空（→ counterpart_mode='live'）。
  // live 人格 brain 在本链路里只出「本地 OFFER」（opening 不调 LLM），对家看到 DELIVER 即收尾，
  // 全程零真实 LLM 调用，无网络/无 token 消耗。
  savedDeepseekKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-dummy-key-not-used';
  await startMockA2aServer();
  await truncate();
});

afterAll(async () => {
  stopAllQueueEngines();
  __setA2aRunOverrides(undefined);
  await new Promise<void>((r) => server.close(() => r()));
  if (savedDeepseekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = savedDeepseekKey;
  delete process.env.PLATFORM_KEY_DIR;
  await app.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  // Ruling 6：共享 acl_test 库用完清干净（同行内 beforeEach 同机制），不给后续套件留脏行。
  await truncate();
});

beforeEach(async () => {
  resetQueueForTests();
  __clearCardCache();
  __setA2aRunOverrides(undefined);
  a2aSends.length = 0;
  await truncate();
});

describe('Task 10 — 免 SDK 端到端全链路（mock A2A server）', () => {
  it('登记 → 触发 → 桥真打 mock → 结算 → arena-behavior-a2a 证据 → 榜单可见', async () => {
    // ① 真实登记：未知 name → 铸造平台托管身份（Ruling 16），返回 {connectionId, token, agentId}
    const reg = await app.inject({
      method: 'POST',
      url: '/arena/connections',
      payload: { name: USER_AGENT_NAME, cardUrl: REGISTERED_CARD_URL },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const { connectionId, token, agentId } = reg.json() as {
      connectionId: string;
      token: string;
      agentId: string;
    };
    expect(typeof connectionId).toBe('string');
    expect(typeof token).toBe('string');
    expect(typeof agentId).toBe('string');
    const [agentRow] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agentRow, '登记应铸造 agents 行').toBeTruthy();
    expect(agentRow.name).toBe(USER_AGENT_NAME);
    expect(agentRow.pubkey, '登记时 pubkey 为空（开局才绑平台公钥）').toBeNull();

    // 代表「已过考场门槛」的真实证据（行为榜资格三件套之一；arena 证据由本局结算产出）
    await db.insert(evidence).values({
      id: `ev-${agentId}-bench`,
      agentId,
      dimension: 'delivery',
      source: 'real-benchmark',
      result: 'success',
    });

    // ② 注入 fetch：card 读取 + message/send 都真打本机 mock server（全链路真 HTTP）
    __setA2aRunOverrides({
      fetchImpl: makeInjectedFetch(),
      pollMs: 20,
      maxRounds: 10,
      maxWaitMs: 10_000,
    });

    // ③ 触发开局
    const run = await app.inject({
      method: 'POST',
      url: `/arena/connections/${connectionId}/runs`,
      payload: { token },
    });
    expect(run.statusCode, run.body).toBe(202);
    const sessionId = run.json().sessionId as string;
    expect(typeof sessionId).toBe('string');

    // ④ 有界轮询至终局（引擎 2s 一拍，通常 ~4s 内结算）
    const session = await waitForTerminal(sessionId);
    expect(session, '会话应在限时内进入终局').toBeTruthy();

    // ⑤ 会话落库：adapter / cardUrl / live 对家 / 结算
    expect(session!.adapter).toBe('a2a');
    expect(session!.a2aCardUrl).toBe(REGISTERED_CARD_URL);
    expect(session!.sellerAgentId).toBe(agentId);
    expect(session!.counterpartMode).toBe('live');
    expect(session!.status).toBe('settled');
    expect(session!.a2aRounds ?? 0).toBeGreaterThanOrEqual(1);

    // 卖家 pubkey 已被开局入口绑到平台公钥（身份托管闭环）
    const [boundAgent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(boundAgent.pubkey).toBeTruthy();

    // 桥确实真打了 mock A2A server（≥2 轮 message/send），且携带登记 token
    expect(a2aSends.length).toBeGreaterThanOrEqual(2);
    expect(a2aSends[0].auth).toBe(`Bearer ${token}`);

    // ⑥ 证据：卖家有 source_type='arena-behavior-a2a' 行（live + adapter=a2a 口径）
    const evs = await db
      .select()
      .from(evidence)
      .where(and(eq(evidence.agentId, agentId), eq(evidence.sourceType, 'arena-behavior-a2a')));
    expect(evs.length, '应有 arena-behavior-a2a 证据').toBeGreaterThanOrEqual(1);
    expect(evs[0].source).toBe('arena');

    // ⑦ 信用分聚合（settle → computeAndPersist）
    const scores = await db.select().from(creditScores).where(eq(creditScores.agentId, agentId));
    expect(scores.length, '应有 credit_scores 聚合行').toBeGreaterThanOrEqual(1);

    // ⑧ 榜单聚合可见：行为榜含本 agent（inArena + hasBenchmark + 分数 ≥ 门槛）
    const board = await app.inject({ method: 'GET', url: '/leaderboard?board=behavior' });
    expect(board.statusCode).toBe(200);
    const rows = board.json() as Array<{ agentId: string; score: number | null; inArena: boolean }>;
    const mine = rows.find((r) => r.agentId === agentId);
    expect(mine, '本局 agent 应在行为榜聚合可见').toBeTruthy();
    expect(mine!.inArena).toBe(true);
    expect(mine!.score ?? 0).toBeGreaterThanOrEqual(400);

    // 能力榜（聚合主路由）同样能看到该 agent 且分数非空
    const capBoard = await app.inject({ method: 'GET', url: '/leaderboard' });
    expect(capBoard.statusCode).toBe(200);
    const capRow = (capBoard.json() as Array<{ agentId: string; score: number | null }>).find(
      (r) => r.agentId === agentId,
    );
    expect(capRow, '能力榜应含该 agent').toBeTruthy();
    expect(capRow!.score).not.toBeNull();
  }, 40_000);

  it('回归：同一 name 再次登记复用同一 agent（幂等，不重复铸造）', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/arena/connections',
      payload: { name: USER_AGENT_NAME, cardUrl: REGISTERED_CARD_URL },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/arena/connections',
      payload: { name: USER_AGENT_NAME, cardUrl: REGISTERED_CARD_URL },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().agentId).toBe(first.json().agentId);
    const all = await db.select().from(agents);
    expect(all.filter((a) => a.name === USER_AGENT_NAME).length).toBe(1);
    // 连接 id 各自独立（每次登记一枚新 token/连接）
    expect(second.json().connectionId).not.toBe(first.json().connectionId);
  });
});
