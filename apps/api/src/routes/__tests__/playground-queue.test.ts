/**
 * /playground 全局队列测试（TDD，0903 老大指令：playground 需要队列否则网站扛不住）。
 *
 * 验收语义：
 * - 全局并发上限 maxActive：占满后新会话 → status 'queued'，GET 可见 queued + queuePosition
 * - FIFO 放行：占坑者终局后，等位者按先来后到依次转 running
 * - 等待超时 → failed「排队超时」+ 归还 per-IP 限流额度（排队不白烧配额）
 * - 等待队列满 → 503 快速拒绝
 * - 红线不变：排队中的会话响应里搜不到 apiKey
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

const payload = {
  name: 'q-agent',
  endpoint: 'https://api.example.com/chat',
  apiKey: 'sk-queue-test-key',
  scenario: { templateId: 'neg-keyboard-price' },
} as const;

const post = (app: FastifyInstance, ip?: string) =>
  app.inject({
    method: 'POST',
    url: '/playground/sessions',
    payload,
    // 指定私网 remoteAddress（uniquelocal 信任段）+ XFF → req.ip 取 XFF，模拟不同用户
    ...(ip ? { remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip } } : {}),
  });

const get = (app: FastifyInstance, id: string) =>
  app.inject({ method: 'GET', url: `/playground/sessions/${id}` });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 轮询直到 body 满足 pred 或超次数（防挂死）。 */
async function pollUntil<T extends { status: string }>(
  app: FastifyInstance,
  id: string,
  pred: (b: T) => boolean,
  tries = 40,
): Promise<T> {
  let body!: T;
  for (let i = 0; i < tries; i++) {
    const res = await get(app, id);
    expect(res.statusCode).toBe(200);
    body = res.json() as T;
    if (pred(body)) return body;
    await sleep(50);
  }
  return body;
}

describe('/playground 队列', () => {
  let db: Database;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    await migrate(TEST_URL);
    db = createDb(TEST_URL);
  });

  afterAll(async () => {
    for (const a of apps) await a.close();
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end();
  });

  const mkApp = (
    fetchImpl: typeof fetch,
    queueOpts: { maxActive: number; maxWaiting: number; waitTimeoutMs: number },
  ): FastifyInstance => {
    const app = buildApp(db, { playgroundFetchImpl: fetchImpl, playgroundQueueOpts: queueOpts });
    apps.push(app);
    return app;
  };

  it('全局并发占满 → 新会话 201 queued，GET 可见 queued + queuePosition；apiKey 不泄漏', async () => {
    const app = mkApp((() => new Promise<Response>(() => {})) as unknown as typeof fetch, {
      maxActive: 1,
      maxWaiting: 5,
      waitTimeoutMs: 60_000,
    });

    const r1 = await post(app);
    expect(r1.statusCode).toBe(201);
    expect((r1.json() as { status: string }).status).toBe('running');

    const r2 = await post(app);
    expect(r2.statusCode).toBe(201);
    expect((r2.json() as { status: string }).status).toBe('queued');

    const g = await get(app, (r2.json() as { id: string }).id);
    const body = g.json() as { status: string; queuePosition?: number };
    expect(body.status).toBe('queued');
    expect(body.queuePosition).toBe(1);
    // 红线：排队中的响应也绝不能带 key
    expect(JSON.stringify(body)).not.toContain('sk-queue-test-key');
  });

  it('FIFO 放行：占坑者终局后，等位者按先来后到依次转 running', async () => {
    // 可控 fetch：第 1 次挂起（手动放行），其余立即成功
    let release1: (() => void) | null = null;
    const fetchImpl = ((): Promise<Response> => {
      if (release1 === null) {
        return new Promise<Response>((resolve) => {
          release1 = () =>
            resolve({
              ok: true,
              text: async () => JSON.stringify({ choices: [{ message: { content: 'accept' } }] }),
            } as unknown as Response);
        });
      }
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'accept' } }] }),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const app = mkApp(fetchImpl, { maxActive: 1, maxWaiting: 5, waitTimeoutMs: 60_000 });

    const s1 = (await (await post(app, '10.1.0.1')).json()) as { id: string; status: string };
    expect(s1.status).toBe('running');
    const s2 = (await (await post(app, '10.1.0.2')).json()) as { id: string; status: string };
    const s3 = (await (await post(app, '10.1.0.3')).json()) as { id: string; status: string };
    expect(s2.status).toBe('queued');
    expect(s3.status).toBe('queued');

    release1?.(); // 第 1 局放行 → 走完 → 空出坑位
    const f2 = await pollUntil(app, s2.id, (b) => b.status !== 'queued');
    expect(f2.status).toBe('done'); // accept 一轮成交

    const f3 = await pollUntil(app, s3.id, (b) => b.status !== 'queued');
    expect(f3.status).toBe('done'); // s2 出局后 s3 顶上并完成
  });

  it('等待超时 → failed 排队超时 + 释放限流额度（同 IP 能继续提交）', async () => {
    const app = mkApp((() => new Promise<Response>(() => {})) as unknown as typeof fetch, {
      maxActive: 1,
      maxWaiting: 5,
      waitTimeoutMs: 300,
    });

    const s1 = (await (await post(app)).json()) as { id: string };
    const s2 = (await (await post(app)).json()) as { id: string };
    expect(s1.status).toBe('running');
    expect(s2.status).toBe('queued');

    await sleep(600); // > waitTimeoutMs
    const g = await get(app, s2.id);
    const body = g.json() as { status: string; error?: string };
    expect(body.status).toBe('failed');
    expect(body.error).toContain('排队');

    // per-IP 并发 2：s1 占 1，s2 超时后必须已归还额度 → 本 POST 可入队
    const r3 = await post(app);
    expect(r3.statusCode).toBe(201);
    expect((r3.json() as { status: string }).status).toBe('queued');
  });

  it('等待队列满 → 503 快速拒绝（排队也排不进）', async () => {
    const app = mkApp((() => new Promise<Response>(() => {})) as unknown as typeof fetch, {
      maxActive: 1,
      maxWaiting: 1,
      waitTimeoutMs: 60_000,
    });

    const s1 = (await (await post(app)).json()) as { id: string };
    expect(s1.status).toBe('running');
    const s2 = (await (await post(app)).json()) as { id: string };
    expect(s2.status).toBe('queued');

    const r3 = await post(app);
    expect(r3.statusCode).toBe(503);
    expect((r3.json() as { error: string }).error).toContain('排队');
  });
});
