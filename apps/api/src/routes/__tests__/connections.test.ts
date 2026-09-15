/**
 * /arena/connections 路由测试（Task 7）：登记 / 列表 / 撤销。
 *
 * 覆盖（brief 六断言）：
 *   1. 正常登记 → 201 + 明文 token；库里只存 hash（token_hash === sha256(token) ≠ token）。
 *   2. SSRF：内网/保留地址 + 非 http(s) 协议 → 4xx 且库里零新增行。
 *   3. body 不合法（缺 cardUrl / 既无 agentId 又无 name / name 不存在）→ 4xx。
 *   4. 列表绝不回 token / tokenHash 字段。
 *   5. 撤销置 revokedAt；重复 DELETE 幂等；不存在 id → 404。
 *   6. 边界正例：合法公网 https URL → 201。
 *
 * 红线：测试库只用 TEST_DATABASE_URL（acl_test），生产库零接触。
 *
 * 已知局限（Task 7 范围外，不测）：DNS-rebinding —— cardUrl 先解析为公网、调用时再解析回内网，
 * 属连接期防护（解析后 pin IP / 校验实际拨号地址），本任务只做登记期字面量卡口。
 */

import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agentConnections, agents } from '../../db/schema';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

const PUBLIC_CARD = 'https://example.com/.well-known/agent-card.json';
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

let app: FastifyInstance;
let db: Database;

function post(body: unknown) {
  return app.inject({ method: 'POST', url: '/arena/connections', payload: body as object });
}

async function countConnections(): Promise<number> {
  const rows = await db.select({ id: agentConnections.id }).from(agentConnections);
  return rows.length;
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(sql`TRUNCATE agent_connections, agents CASCADE`);
  await db.insert(agents).values([
    { id: 'ag-conn-a', name: 'conn-agent-a', pubkey: 'pem-a' },
    { id: 'ag-conn-b', name: 'conn-agent-b', pubkey: 'pem-b' },
  ]);
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE agent_connections, agents CASCADE`);
  await app.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
});

describe('POST /arena/connections — 登记', () => {
  it('正常登记（agentId）→ 201，返回明文 token，库里存 sha256 hash 而非明文', async () => {
    const res = await post({ agentId: 'ag-conn-a', cardUrl: PUBLIC_CARD });
    expect(res.statusCode).toBe(201);
    const { connectionId, token } = res.json() as { connectionId: string; token: string };
    expect(typeof connectionId).toBe('string');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const [row] = await db
      .select()
      .from(agentConnections)
      .where(sql`${agentConnections.id} = ${connectionId}`);
    expect(row).toBeTruthy();
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(sha256hex(token));
  });

  it('按 name 解析身份 → 201', async () => {
    const res = await post({ name: 'conn-agent-b', cardUrl: PUBLIC_CARD });
    expect(res.statusCode).toBe(201);
    const { connectionId } = res.json() as { connectionId: string };
    const [row] = await db
      .select()
      .from(agentConnections)
      .where(sql`${agentConnections.id} = ${connectionId}`);
    expect(row.agentId).toBe('ag-conn-b');
  });

  it('SSRF 边界正例：合法公网 https URL → 201', async () => {
    const res = await post({
      agentId: 'ag-conn-a',
      cardUrl: 'https://agents.example.org/card.json',
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /arena/connections — SSRF 拒绝（不得入库）', () => {
  const badUrls = [
    'http://127.0.0.1/x',
    'http://localhost/x',
    'http://169.254.169.254/',
    'http://10.1.2.3/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'file:///etc/passwd',
  ];

  it.each(badUrls)('拒绝 %s → 4xx 且零新增行', async (url) => {
    const before = await countConnections();
    const res = await post({ agentId: 'ag-conn-a', cardUrl: url });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await countConnections()).toBe(before);
  });
});

// 评审 T7 补测：binding-spec 明列的网段/字面量，旧表未覆盖。
// 与上表同款卡口（isPublicEndpoint），此处收紧为精确 400 + 零新增行，防止 
// 私自放宽到「4xx 也算过」掩盖 SSRF 放行。
describe('POST /arena/connections — SSRF 边界补测（精确 400，不得入库）', () => {
  const ssrfBypassUrls = [
    'http://[::1]/', // IPv6 环回
    'http://[fc00::1]/', // ULA fc00::/7
    'http://0.0.0.0/', // 未指定地址
    'http://172.31.255.255/', // 172.16.0.0/12 上界
    'http://[::ffff:127.0.0.1]/', // IPv4-mapped 环回（代码注释声称堵住的绕过）
  ];

  it.each(ssrfBypassUrls)('拒绝 %s → 精确 400 且零新增行', async (url) => {
    const before = await countConnections();
    const res = await post({ agentId: 'ag-conn-a', cardUrl: url });
    expect(res.statusCode).toBe(400);
    expect(await countConnections()).toBe(before);
  });
});

describe('POST /arena/connections — body 校验', () => {
  it('缺 cardUrl → 4xx', async () => {
    const res = await post({ agentId: 'ag-conn-a' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('既无 agentId 又无 name → 4xx', async () => {
    const res = await post({ cardUrl: PUBLIC_CARD });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  // Ruling 16：未知 name 不再是 4xx，而是**铸造**平台托管身份（免 SDK 用户首登即建 agent）。
  // 断言：201 + 返回新鲜 agentId，且库里确有该 agents 行（pubkey 为空）。
  it('name 不存在 → 201，铸造新 agent（pubkey 为空，库内有行）', async () => {
    const res = await post({ name: 'no-such-agent', cardUrl: PUBLIC_CARD });
    expect(res.statusCode).toBe(201);
    const { agentId } = res.json() as { agentId: string };
    expect(typeof agentId).toBe('string');
    expect(agentId.startsWith('ag-')).toBe(true);

    const [row] = await db
      .select()
      .from(agents)
      .where(sql`${agents.id} = ${agentId}`);
    expect(row).toBeTruthy();
    expect(row.name).toBe('no-such-agent');
    expect(row.pubkey).toBeNull();
  });

  // 评审 T7 补测：语法合法但不存在的 agentId 必须 404（守住 FK 500 的预防路径）。
  // connections.ts:57 实测返回 404（非 5xx）——此处按实现真实行为断言。
  it('agentId 不存在 → 404（不得 5xx，不得入库）', async () => {
    const before = await countConnections();
    const res = await post({ agentId: 'ag-does-not-exist', cardUrl: PUBLIC_CARD });
    expect(res.statusCode).toBe(404);
    expect(await countConnections()).toBe(before);
  });
});

describe('POST /arena/connections — 同名并发登记（Task 10 fix2 竞态收敛）', () => {
  // 确定性重放 TOCTOU：另一会话先插入同名行（未提交）→ 路由的 SELECT 看不见
  // → 走铸造分支 → INSERT 撞 UNIQUE(name) 阻塞 → 对方 COMMIT → 23505。
  // 修复前：23505 冒泡为未捕获 500；修复后：回头按 name 重选、复用胜者 id。
  it('同名 TOCTOU（另一会话已插入未提交）→ 收敛复用胜者 id，不 500', async () => {
    const name = `conn-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const winnerId = `ag-race-${Date.now()}`;
    const pool = new Pool({ connectionString: TEST_URL, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO agents (id, name, pubkey, status) VALUES ($1, $2, $3, $4)',
        [winnerId, name, null, 'active'],
      );
      // 悬而未决的登记请求：其 INSERT 会阻塞在未提交行上
      const pending = post({ name, cardUrl: PUBLIC_CARD });
      await new Promise((r) => setTimeout(r, 300));
      await client.query('COMMIT');

      const res = await pending;
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().agentId, '应复用胜者 id').toBe(winnerId);
      const rows = await db.select().from(agents).where(sql`${agents.name} = ${name}`);
      expect(rows.length, '同名只应有一行').toBe(1);
    } finally {
      client.release();
      await pool.end();
    }
  });
});

describe('GET /arena/connections — 列表', () => {
  it('绝不回 token/tokenHash；白名单字段齐全', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/arena/connections?agentId=ag-conn-a',
    });
    expect(res.statusCode).toBe(200);
    const { connections } = res.json() as { connections: Array<Record<string, unknown>> };
    expect(Array.isArray(connections)).toBe(true);
    expect(connections.length).toBeGreaterThan(0);

    const raw = res.body;
    expect(raw).not.toContain('"token"');
    expect(raw).not.toContain('"tokenHash"');
    expect(raw).not.toContain('token_hash');
    for (const c of connections) {
      expect(Object.keys(c)).not.toContain('token');
      expect(Object.keys(c)).not.toContain('tokenHash');
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('cardUrl');
      expect(c).toHaveProperty('arenaReady');
      expect(c).toHaveProperty('revokedAt');
      expect(c.agentId).toBe('ag-conn-a');
    }
  });
});

describe('DELETE /arena/connections/:id — 撤销', () => {
  it('置 revokedAt；重复 DELETE 幂等；不存在 → 404', async () => {
    const reg = await post({ agentId: 'ag-conn-a', cardUrl: PUBLIC_CARD });
    const { connectionId } = reg.json() as { connectionId: string };

    const del1 = await app.inject({
      method: 'DELETE',
      url: `/arena/connections/${connectionId}`,
    });
    expect(del1.statusCode).toBe(200);
    expect(del1.json().revokedAt).toBeTruthy();

    const [row] = await db
      .select()
      .from(agentConnections)
      .where(sql`${agentConnections.id} = ${connectionId}`);
    expect(row.revokedAt).toBeTruthy();

    // 幂等
    const del2 = await app.inject({
      method: 'DELETE',
      url: `/arena/connections/${connectionId}`,
    });
    expect(del2.statusCode).toBe(200);

    // 不存在
    const del3 = await app.inject({
      method: 'DELETE',
      url: '/arena/connections/ac-nonexistent',
    });
    expect(del3.statusCode).toBe(404);
  });
});
