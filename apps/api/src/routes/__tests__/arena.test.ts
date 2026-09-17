/**
 * /arena 路由测试：会话注册、事件验签入库（seq 单调 + nonce 防重放 + 角色绑定）、
 * 长轮询事件流、状态机（open→negotiating→settled/failed）。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ensureKeypair, signPayload } from 'agent-to-trust';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents } from '../../db/schema';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

type Keys = { publicKeyPem: string; privateKeyPem: string };

let app: FastifyInstance;
let db: Database;
let buyerKeys: Keys;
let sellerKeys: Keys;
let dirs: string[] = [];

function makeEvent(
  sessionId: string,
  seq: number,
  opts: {
    type?: string;
    fromAgent?: string;
    payload?: unknown;
    signer?: Keys;
    pubkey?: string;
  } = {},
) {
  const signer = opts.signer ?? buyerKeys;
  const envelope = {
    sessionId,
    seq,
    type: opts.type ?? 'OFFER',
    fromAgent: opts.fromAgent ?? 'ag-buyer',
    payload: (opts.payload ?? { price: 100 }) as unknown,
    nonce: `n-${randomUUID()}`,
    ts: Date.now(),
  };
  return {
    ...envelope,
    sig: signPayload(signer.privateKeyPem, envelope),
    pubkey: opts.pubkey ?? buyerKeys.publicKeyPem,
  };
}

async function postEvents(id: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url: `/arena/sessions/${id}/events`,
    payload: body as Record<string, unknown>,
  });
}

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
  await db.execute(
    sql`TRUNCATE arena_events, arena_sessions, agents, ingest_nonces CASCADE`,
  );
  const d1 = mkdtempSync(join(tmpdir(), 'a2t-arena-b-'));
  const d2 = mkdtempSync(join(tmpdir(), 'a2t-arena-s-'));
  dirs = [d1, d2];
  buyerKeys = ensureKeypair(d1);
  sellerKeys = ensureKeypair(d2);
  await db.insert(agents).values([
    { id: 'ag-buyer', name: 'buyer-test', pubkey: buyerKeys.publicKeyPem },
    { id: 'ag-seller', name: 'seller-test', pubkey: sellerKeys.publicKeyPem },
  ]);
});

afterAll(async () => {
  await app.close();
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
  await client?.end();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('/arena', () => {
  let sessionId: string;

  it('创建会话 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/arena/sessions',
      payload: {
        scenario: 'market-delivery',
        taskSpec: { item: 'keyboard', deliverable: '物流单号' },
        budget: 500,
        buyerAgentId: 'ag-buyer',
        sellerAgentId: 'ag-seller',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('open');
    sessionId = res.json().id;
  });

  it('GET 会话 200，事件为空', async () => {
    const res = await app.inject({ method: 'GET', url: `/arena/sessions/${sessionId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().scenario).toBe('market-delivery');
    expect(res.json().events).toEqual([]);
  });

  it('正确签名事件 201，会话转 negotiating', async () => {
    const res = await postEvents(sessionId, makeEvent(sessionId, 1));
    expect(res.statusCode).toBe(201);
    expect(res.json().sessionStatus).toBe('negotiating');
  });

  it('GET events 返回已入库事件', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/arena/sessions/${sessionId}/events?after=0`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(1);
    expect(res.json().events[0].seq).toBe(1);
    expect(res.json().events[0].type).toBe('OFFER');
  });

  it('pubkey 与 agent 绑定不符 401（签名身份必须匹配注册密钥）', async () => {
    const res = await postEvents(sessionId, makeEvent(sessionId, 2, { signer: sellerKeys }));
    expect(res.statusCode).toBe(401);
  });

  it('重放已入库事件 409', async () => {
    const ev = makeEvent(sessionId, 2);
    const first = await postEvents(sessionId, ev);
    expect(first.statusCode).toBe(201);
    const replay = await postEvents(sessionId, ev);
    expect(replay.statusCode).toBe(409);
  });

  it('跳号 409', async () => {
    const res = await postEvents(sessionId, makeEvent(sessionId, 9));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('seq 不连续');
  });

  it('非参与者 403', async () => {
    const res = await postEvents(
      sessionId,
      makeEvent(sessionId, 3, { fromAgent: 'ag-outsider' }),
    );
    expect(res.statusCode).toBe(403);
  });

  it('长轮询：挂起直到新事件到达', async () => {
    const started = Date.now();
    const polling = app.inject({
      method: 'GET',
      url: `/arena/sessions/${sessionId}/events?after=2&wait=5`,
    });
    setTimeout(() => {
      void postEvents(
        sessionId,
        makeEvent(sessionId, 3, {
          type: 'ACCEPT',
          fromAgent: 'ag-seller',
          signer: sellerKeys,
          pubkey: sellerKeys.publicKeyPem,
        }),
      );
    }, 300);
    const res = await polling;
    expect(res.statusCode).toBe(200);
    expect(res.json().events.map((e: { seq: number }) => e.seq)).toContain(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it('长轮询超时返回空数组', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/arena/sessions/${sessionId}/events?after=99&wait=1`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([]);
  });

  it('REJECT → failed，之后再推事件 409', async () => {
    const rej = await postEvents(
      sessionId,
      makeEvent(sessionId, 4, { type: 'REJECT', fromAgent: 'ag-buyer' }),
    );
    expect(rej.statusCode).toBe(201);
    expect(rej.json().sessionStatus).toBe('failed');
    const after = await postEvents(sessionId, makeEvent(sessionId, 5));
    expect(after.statusCode).toBe(409);
  });

  it('seller 用自己的密钥正常发事件', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/arena/sessions',
      payload: { scenario: 'market-delivery', buyerAgentId: 'ag-buyer', sellerAgentId: 'ag-seller' },
    });
    const sid = create.json().id;
    const res = await postEvents(
      sid,
      makeEvent(sid, 1, {
        type: 'OFFER',
        fromAgent: 'ag-seller',
        signer: sellerKeys,
        pubkey: sellerKeys.publicKeyPem,
      }),
    );
    expect(res.statusCode).toBe(201);
  });
});
