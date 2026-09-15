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
 */

import { createHash } from 'node:crypto';
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

  it('name 不存在 → 4xx', async () => {
    const res = await post({ name: 'no-such-agent', cardUrl: PUBLIC_CARD });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
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
