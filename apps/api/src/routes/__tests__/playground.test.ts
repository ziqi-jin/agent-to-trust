/**
 * /playground 路由测试（TDD）。
 * 红线：不进官方榜（不写 db）、apiKey 绝不出现在任何响应 JSON、限流 429 带 retry-after。
 * 纯内存路由——db 只是满足 buildApp 签名，不碰库。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

const okFetch = (content: string) => async () =>
  ({
    ok: true,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  }) as unknown as Response;

const hangFetch = async () => new Promise<Response>(() => {});

describe('/playground', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    await migrate(TEST_URL);
    db = createDb(TEST_URL);
    app = buildApp(db, { playgroundFetchImpl: okFetch('accept') });
  });

  afterAll(async () => {
    await app.close();
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end();
  });

  it('GET /playground/templates → 3 个官方模板（含 name/desc/scenario）', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground/templates' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { templates: { id: string; name: string; desc: string; scenario: { strategy: { opening: number } } }[] };
    expect(body.templates).toHaveLength(3);
    expect(body.templates[0].name).toBeTruthy();
    expect(body.templates[0].desc).toBeTruthy();
    expect(body.templates[0].scenario.strategy.opening).toBeGreaterThan(0);
  });

  it('POST 合法（带 apiKey）→ 201；轮询到 done；响应 JSON 搜不到 key', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/playground/sessions',
      payload: {
        name: 'e2e-agent',
        endpoint: 'https://api.example.com/chat',
        apiKey: 'sk-playground-test-key',
        scenario: { templateId: 'neg-keyboard-price' },
      },
    });
    expect(post.statusCode).toBe(201);
    const { id } = post.json() as { id: string };
    expect(id).toMatch(/^pg-/);

    let final: { status: string; events: unknown[]; scorecard?: unknown } | undefined;
    for (let i = 0; i < 20; i++) {
      const g = await app.inject({ method: 'GET', url: `/playground/sessions/${id}` });
      expect(g.statusCode).toBe(200);
      const body = g.json() as { status: string; events: unknown[]; scorecard?: unknown };
      if (body.status === 'done' || body.status === 'failed') {
        final = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(final?.status).toBe('done');
    expect(final?.events.length).toBeGreaterThan(0);
    expect(final?.scorecard).toBeTruthy();
    // 红线：完整响应里搜不到 key
    expect(JSON.stringify(final)).not.toContain('sk-playground-test-key');
  });

  it('POST 缺 endpoint → 400；localhost → 400（SSRF）；坏模板 → 400', async () => {
    const noEndpoint = await app.inject({
      method: 'POST',
      url: '/playground/sessions',
      payload: { scenario: { templateId: 'neg-keyboard-price' } },
    });
    expect(noEndpoint.statusCode).toBe(400);

    const localhost = await app.inject({
      method: 'POST',
      url: '/playground/sessions',
      payload: { endpoint: 'http://localhost:8000/v1', scenario: { templateId: 'neg-keyboard-price' } },
    });
    expect(localhost.statusCode).toBe(400);

    const badTpl = await app.inject({
      method: 'POST',
      url: '/playground/sessions',
      payload: { endpoint: 'https://api.example.com/chat', scenario: { templateId: 'nope' } },
    });
    expect(badTpl.statusCode).toBe(400);
  });

  it('限流：并发 2 局后第 3 局 429 + retry-after（hang 的 fetch 不释放）', async () => {
    const hangApp = buildApp(db, { playgroundFetchImpl: hangFetch as unknown as typeof fetch });
    const payload = {
      endpoint: 'https://api.example.com/chat',
      scenario: { templateId: 'neg-keyboard-price' },
    };
    const r1 = await hangApp.inject({ method: 'POST', url: '/playground/sessions', payload });
    const r2 = await hangApp.inject({ method: 'POST', url: '/playground/sessions', payload });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    const r3 = await hangApp.inject({ method: 'POST', url: '/playground/sessions', payload });
    expect(r3.statusCode).toBe(429);
    expect(r3.headers['retry-after']).toBeTruthy();
    expect((r3.json() as { error: string }).error).toContain('频繁');
    await hangApp.close();
  });

  it('GET 不存在的会话 → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground/sessions/pg-nope' });
    expect(res.statusCode).toBe(404);
  });
});
