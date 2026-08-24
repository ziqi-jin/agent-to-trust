import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb } from '../src/db/client';
import { setupTestDatabase, testDatabaseUrl, truncateAll } from './helpers';

/**
 * P0-10 Vertical Slice 全链路测试：Agent → Evidence → Score 端到端。
 *
 * 覆盖整条 vertical slice：仿真引擎产生 evidence → 经 API 落库 → 评分引擎算分 →
 * 榜单/详情/统计可查询 → 分数可解释 + 可稳定复算。
 * 维度映射见 docs/TESTING.md。
 */

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  await setupTestDatabase();
  app = buildApp(createDb(testDatabaseUrl()));
  await app.ready();
});

beforeEach(async () => {
  await truncateAll();
});

const SMALL_CONFIG = { agentCount: 10, rounds: 20, seed: 42 };

describe('[正确性] P0-10 Vertical Slice 全链路', () => {
  it('仿真 → 落库 → 榜单 → 详情 → 统计 → 事件流 端到端跑通', async () => {
    // 1. 跑一次小规模确定性仿真（source=simulation）
    const run = await app.inject({
      method: 'POST',
      url: '/simulation/run',
      payload: SMALL_CONFIG,
    });
    expect(run.statusCode).toBe(200);
    const runBody = run.json();
    expect(runBody.seeded).toBe(true);

    // 2. 榜单有分数
    const lb = await app.inject({ method: 'GET', url: '/leaderboard' });
    expect(lb.statusCode).toBe(200);
    const rows = lb.json();
    expect(rows).toHaveLength(10);
    const scored = rows.filter((r: { score: number | null }) => r.score !== null);
    expect(scored.length).toBeGreaterThan(0);
    // 每个仿真 agent 都显式标记 simulated
    for (const r of rows) expect(r.isSimulated).toBe(true);

    // 3. 榜单分数与 agent 详情一致，且可解释（evidenceRefs 非空）
    const detail = await app.inject({
      method: 'GET',
      url: `/agents/${scored[0].agentId}/score`,
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json();
    expect(detailBody.score).toBe(scored[0].score);
    expect(detailBody.evidenceRefs.length).toBeGreaterThan(0);

    // 4. 统计数字与落库数据一致
    const stats = await app.inject({ method: 'GET', url: '/stats' });
    expect(stats.statusCode).toBe(200);
    const st = stats.json();
    expect(st.agentCount).toBe(10);
    expect(st.evidenceCount).toBeGreaterThan(0);
    expect(st.scoreCount).toBe(10);

    // 5. 事件流可查询（ticker 数据源）
    const ev = await app.inject({ method: 'GET', url: '/events' });
    expect(ev.statusCode).toBe(200);
    expect(ev.json().length).toBeGreaterThan(0);
  });
});

describe('[确定性] P0-10 可稳定复算', () => {
  it('同 seed 落库后，重复查询分数结果一致', async () => {
    await app.inject({ method: 'POST', url: '/simulation/run', payload: SMALL_CONFIG });
    const lb = await app.inject({ method: 'GET', url: '/leaderboard' });
    const scored = lb.json().filter((r: { score: number | null }) => r.score !== null);

    const a = await app.inject({ method: 'GET', url: `/agents/${scored[0].agentId}/score` });
    const b = await app.inject({ method: 'GET', url: `/agents/${scored[0].agentId}/score` });
    expect(b.json()).toEqual(a.json());
  });
});

describe('[数据完整性] P0-10 幂等 seed', () => {
  it('重复 run 不重复落库（已 seeded 则跳过）', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/simulation/run',
      payload: { agentCount: 5, rounds: 10, seed: 7 },
    });
    expect(first.json().seeded).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/simulation/run',
      payload: { agentCount: 5, rounds: 10, seed: 7 },
    });
    expect(second.json().seeded).toBe(false);

    const stats = await app.inject({ method: 'GET', url: '/stats' });
    expect(stats.json().agentCount).toBe(5); // 未翻倍
  });
});

describe('[数据完整性] P0-10 evidence source 红线', () => {
  it('落库 evidence 全部 source=simulation，绝不伪装真实', async () => {
    await app.inject({ method: 'POST', url: '/simulation/run', payload: SMALL_CONFIG });
    const ev = await app.inject({ method: 'GET', url: '/events' });
    const events = ev.json();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.source).toBe('simulation');
  });
});
