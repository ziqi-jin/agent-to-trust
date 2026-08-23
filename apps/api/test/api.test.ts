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

// 验收维度映射：docs/TESTING.md
// 正确性 / 确定性 / 可解释性 / 鲁棒性 / 数据完整性 / 持久化

describe('[正确性] Correctness', () => {
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

  it('全失败证据 → score 0', async () => {
    const agent = (await createAgent('fail-agent')).json();
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/evidence`, payload: { dimension: 'reliability', source: 'benchmark', result: 'failure' } });
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/evidence`, payload: { dimension: 'reliability', source: 'benchmark', result: 'failure' } });
    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/score` });
    expect(res.json().score).toBe(0);
  });
});

describe('[鲁棒性] Robustness — 输入校验', () => {
  it('缺 name → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/agents', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('重名 → 409', async () => {
    await createAgent();
    const res = await createAgent();
    expect(res.statusCode).toBe(409);
  });

  it('非法维度 → 422', async () => {
    const agent = (await createAgent()).json();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evidence`,
      payload: { dimension: 'not_a_dimension', result: 'success' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('非法 result → 422', async () => {
    const agent = (await createAgent()).json();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/evidence`,
      payload: { dimension: 'capability', result: 'boom' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('不存在的 agent 提交 evidence → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/nope/evidence',
      payload: { dimension: 'capability', result: 'success' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('不存在的 agent 查 score → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/nope/score' });
    expect(res.statusCode).toBe(404);
  });
});

describe('[可解释性] Explainability — 可追溯', () => {
  it('score.evidenceRefs 与提交的 evidence id 一一对应', async () => {
    const agent = (await createAgent('trace-agent')).json();
    const ids: string[] = [];
    for (const d of ['capability', 'reliability', 'delivery']) {
      const r = await app.inject({ method: 'POST', url: `/agents/${agent.id}/evidence`, payload: { dimension: d, source: 'benchmark', result: 'success' } });
      ids.push(r.json().id);
    }
    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/score` });
    const body = res.json();
    expect(body.evidenceCount).toBe(3);
    expect(body.evidenceRefs.sort()).toEqual(ids.sort());
  });
});

describe('[确定性] Determinism + [持久化] Persistence', () => {
  it('落库后重复 GET score 返回一致', async () => {
    const agent = (await createAgent('persist-agent')).json();
    for (const ev of [
      { dimension: 'capability', source: 'benchmark', result: 'success' },
      { dimension: 'reliability', source: 'simulation', result: 'success' },
      { dimension: 'delivery', source: 'simulation', result: 'success' },
    ]) {
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/evidence`, payload: ev });
    }
    const posted = await app.inject({ method: 'POST', url: `/agents/${agent.id}/score` });
    expect(posted.statusCode).toBe(200);
    const body = posted.json();
    expect(body.score).not.toBeNull();
    expect(body.modelVersion).toBe('baseline-v0.1');
    expect(body.confidence).toBeGreaterThan(0);

    const again = await app.inject({ method: 'GET', url: `/agents/${agent.id}/score` });
    expect(again.json().score).toBe(body.score);
    expect(again.json().evidenceRefs).toEqual(body.evidenceRefs);
  });
});
