/**
 * D3【封 source=real】—— 2026-09-09 13:17 老大拍板。
 *
 * 问题：POST /agents/:id/evidence 原先 `source: (body.source ?? 'simulation')` 无白名单，
 * 可传 source=real（SOURCE_WEIGHTS.real = 1.0）无鉴权灌分，绕过 Ed25519 验签链路。
 *
 * 拍板：source 白名单只允许 'simulation'。real（及其他未授权值）→ 400，错误信息
 * 指引走 POST /ingest/results（Ed25519 验签链路）。
 *
 * 复现测试：POST source=real → 400 且分数/证据不变；POST simulation → 照常 201。
 */

import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createDb, type Database } from '../../db/client';
import { migrate } from '../../db/migrate';
import { agents } from '../../db/schema';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL 未设置');

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  await migrate(TEST_URL);
  db = createDb(TEST_URL);
  app = buildApp(db);
});

beforeEach(async () => {
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ('TRUNCATE TABLE feedback, test_queue, arena_events, arena_sessions, credit_scores, score_snapshots, evidence, ingest_nonces, agents CASCADE' as any),
  );
});

async function seedAgent(): Promise<string> {
  const id = `ag-${randomUUID().slice(0, 8)}`;
  await db.insert(agents).values({ id, name: `d3-${id}` });
  return id;
}

const postEvidence = (id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/agents/${id}/evidence`, payload: body });

describe('D3：POST /agents/:id/evidence 的 source 白名单', () => {
  it('source=real → 400，且不落证据、分数不变', async () => {
    const id = await seedAgent();
    // 先经合法 simulation 源建立基线分
    const ok = await postEvidence(id, {
      dimension: 'capability',
      source: 'simulation',
      result: 'success',
      value: 80,
    });
    expect(ok.statusCode).toBe(201);
    const before = (await app.inject({ method: 'GET', url: `/agents/${id}/score` })).json() as {
      score: number;
    };

    const res = await postEvidence(id, {
      dimension: 'capability',
      source: 'real',
      result: 'success',
      value: 100,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('/ingest/results');

    // 证据没有增加（仍然只有基线那一条）
    const evs = (await app.inject({ method: 'GET', url: `/agents/${id}/evidence` })).json() as unknown[];
    expect(evs).toHaveLength(1);
    // 分数未被 real 灌高
    const after = (await app.inject({ method: 'GET', url: `/agents/${id}/score` })).json() as {
      score: number;
    };
    expect(after.score).toBe(before.score);
  });

  it('其他未授权 source（benchmark/real-confidential/任意串）→ 400', async () => {
    const id = await seedAgent();
    for (const source of ['benchmark', 'real-confidential', 'verified', 'self-reported', 'bogus']) {
      const res = await postEvidence(id, { dimension: 'capability', source, result: 'success' });
      expect(res.statusCode).toBe(400);
    }
  });

  it('source=simulation → 照常 201（SDK/前端正常用法不受影响）', async () => {
    const id = await seedAgent();
    const res = await postEvidence(id, {
      dimension: 'capability',
      source: 'simulation',
      result: 'success',
      value: 70,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().evidence.source).toBe('simulation');
  });

  it('不传 source → 默认 simulation，201', async () => {
    const id = await seedAgent();
    const res = await postEvidence(id, { dimension: 'integrity', result: 'success' });
    expect(res.statusCode).toBe(201);
    expect(res.json().evidence.source).toBe('simulation');
  });
});
