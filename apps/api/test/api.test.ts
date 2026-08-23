import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb } from '../src/db/client';
import { setupTestDatabase, testDatabaseUrl, truncateAll } from './helpers';

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  await setupTestDatabase();
  app = buildApp(createDb(testDatabaseUrl()));
  await app.ready();
});

beforeEach(async () => {
  await truncateAll();
});

function createAgent(name = 'test-agent') {
  return app.inject({
    method: 'POST',
    url: '/agents',
    payload: { name, capabilities: ['research', 'search'] },
  });
}

describe('Agent Registry', () => {
  it('创建 + 查询 Agent', async () => {
    const res = await createAgent();
    expect(res.statusCode).toBe(201);
    const agent = res.json();
    expect(agent.name).toBe('test-agent');
    expect(agent.verificationLevel).toBe('unverified');

    const get = await app.inject({ method: 'GET', url: `/agents/${agent.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().name).toBe('test-agent');
  });

  it('重名返回 409', async () => {
    await createAgent();
    const res = await createAgent();
    expect(res.statusCode).toBe(409);
  });

  it('缺 name 返回 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/agents', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('Evidence → Score 闭环', () => {
  it('完整 vertical slice', async () => {
    const agent = (await createAgent('slice-agent')).json();
    const aid = agent.id;

    // 未评分：unverified
    const before = await app.inject({ method: 'GET', url: `/agents/${aid}/score` });
    expect(before.statusCode).toBe(200);
    expect(before.json().score).toBeNull();
    expect(before.json().confidence).toBe(0);

    // 提交证据
    const evs = [
      { dimension: 'capability', source: 'benchmark', sourceType: 'benchmark', result: 'success' },
      { dimension: 'reliability', source: 'simulation', sourceType: 'simulation', result: 'success' },
      { dimension: 'delivery', source: 'simulation', sourceType: 'simulation', result: 'success' },
    ];
    for (const ev of evs) {
      const r = await app.inject({ method: 'POST', url: `/agents/${aid}/evidence`, payload: ev });
      expect(r.statusCode).toBe(201);
    }

    // 计算分数
    const res = await app.inject({ method: 'POST', url: `/agents/${aid}/score` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).not.toBeNull();
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(1000);
    expect(body.confidence).toBeGreaterThan(0);
    expect(body.modelVersion).toBe('baseline-v0.1');
    expect(body.evidenceCount).toBe(3);

    // 再查：持久化 + 证据可追溯
    const again = await app.inject({ method: 'GET', url: `/agents/${aid}/score` });
    expect(again.json().score).toBe(body.score);
    expect(again.json().evidenceRefs.length).toBe(3);

    const list = await app.inject({ method: 'GET', url: `/agents/${aid}/evidence` });
    expect(list.json().length).toBe(3);
  });

  it('非法维度返回 422', async () => {
    const agent = (await createAgent()).json();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evidence`,
      payload: { dimension: 'not_a_dimension', result: 'success' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('全部失败证据 → 分数为 0', async () => {
    const agent = (await createAgent('fail-agent')).json();
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/evidence`, payload: { dimension: 'reliability', source: 'benchmark', result: 'failure' } });
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/evidence`, payload: { dimension: 'reliability', source: 'benchmark', result: 'failure' } });
    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/score` });
    expect(res.json().score).toBe(0);
  });
});
