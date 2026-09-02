/**
 * Playground 谈判 runner（TDD）。
 * 语义复刻考场 runNegotiation：accept 关键词成交、extractNumber 报价、
 * 连续 2 次无效破裂、报价 capped 到对手当前价、单次超时记事件继续、连续 2 次调用失败 failed。
 * 红线：apiKey 只在参数里，绝不落入 session 对象。
 */
import { describe, expect, it } from 'vitest';
import { validateSessionInput } from '../scenario';
import { runSession } from '../runner';
import type { StoredSession } from '../store';

const fixed = validateSessionInput({
  endpoint: 'https://api.example.com/chat',
  apiKey: 'sk-runner-secret',
  scenario: {
    custom: {
      brief: '你要采购一批咖啡豆，正在和供应商谈单价。',
      agentRole: '咖啡馆主',
      counterpartRole: '豆商',
      metricLabel: '单价（元/kg）',
      opening: 100,
      floor: 50,
      target: 75,
      maxRounds: 4,
      style: 'balanced', // step = (100-50)×0.25 = 12.5
    },
  },
});
if (!fixed.ok) throw new Error('fixture 校验失败');
const scenario = fixed.value.scenario;

function makeSession(): StoredSession {
  return {
    id: 'pg-test',
    name: 'tester',
    endpoint: 'https://api.example.com/chat',
    status: 'running',
    events: [],
    createdAt: Date.now(),
  };
}

const okFetch =
  (content: string | (() => string)) =>
  async () =>
    ({
      ok: true,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: typeof content === 'function' ? content() : content } }] }),
    }) as unknown as Response;

const seqMonotonic = (s: StoredSession) => s.events.every((e, i) => i === 0 || e.seq > s.events[i - 1].seq);

describe('runSession', () => {
  it('第 1 轮 accept → 按对手开价成交；partial；dealQuality=0；事件 seq 单调', async () => {
    const s = makeSession();
    await runSession(s, 'sk-runner-secret', scenario, okFetch('accept') as typeof fetch);
    expect(s.status).toBe('done');
    expect(s.scorecard?.result).toBe('partial');
    expect(s.scorecard?.dealValue).toBe(100);
    expect(s.scorecard?.dealQuality).toBe(0);
    expect(s.scorecard?.roundsUsed).toBe(1);
    expect(s.scorecard?.protocolCompliance).toBe(1);
    expect(s.events[0].type).toBe('scenario');
    expect(s.events.some((e) => e.type === 'accept' && e.actor === 'agent')).toBe(true);
    expect(s.events.at(-1)?.type).toBe('deal');
    expect(seqMonotonic(s)).toBe(true);
  });

  it('每轮报 target=75：第 2 轮达线成交 → success、dealQuality=1', async () => {
    const s = makeSession();
    await runSession(s, undefined, scenario, okFetch('75') as typeof fetch);
    expect(s.status).toBe('done');
    expect(s.scorecard?.result).toBe('success');
    expect(s.scorecard?.dealValue).toBe(75);
    expect(s.scorecard?.dealQuality).toBe(1);
    expect(s.scorecard?.roundsUsed).toBe(2);
    // 让步轨迹：100 → 87.5 → 成交 75
    expect(s.events.filter((e) => e.type === 'concede').map((e) => e.value)).toEqual([87.5]);
  });

  it('连续两轮无效回复 → 破裂；failure；protocolCompliance=0', async () => {
    const s = makeSession();
    await runSession(s, undefined, scenario, okFetch('我不知道你在说什么') as typeof fetch);
    expect(s.status).toBe('done');
    expect(s.scorecard?.result).toBe('failure');
    expect(s.scorecard?.dealValue).toBeNull();
    expect(s.scorecard?.protocolCompliance).toBe(0);
    expect(s.events.at(-1)?.type).toBe('breakdown');
  });

  it('轮次耗尽未成交 → failure；协议合规 4/4', async () => {
    const s = makeSession();
    await runSession(s, undefined, scenario, okFetch('49') as typeof fetch);
    expect(s.status).toBe('done');
    expect(s.scorecard?.result).toBe('failure');
    expect(s.scorecard?.roundsUsed).toBe(4);
    expect(s.scorecard?.protocolCompliance).toBe(1);
  });

  it('报价高于对手当前价 → capped 到对手价（不按 200 成交）', async () => {
    const s = makeSession();
    await runSession(s, undefined, scenario, okFetch('200') as typeof fetch);
    expect(s.scorecard?.dealValue).toBe(100);
    expect(s.scorecard?.result).toBe('partial');
  });

  it('单次超时记 timeout 事件后继续；下一轮 accept 照常成交', async () => {
    const s = makeSession();
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('aborted due to timeout'), { name: 'TimeoutError' });
      return {
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'accept' } }] }),
      } as unknown as Response;
    };
    await runSession(s, undefined, scenario, flaky as unknown as typeof fetch);
    expect(s.status).toBe('done');
    expect(s.scorecard?.dealValue).toBe(100);
    expect(s.events.some((e) => e.type === 'timeout')).toBe(true);
  });

  it('连续 2 次调用失败 → status=failed + error；无 scorecard', async () => {
    const s = makeSession();
    const boom = async () => {
      throw new Error('boom: connect ECONNREFUSED');
    };
    await runSession(s, undefined, scenario, boom as unknown as typeof fetch);
    expect(s.status).toBe('failed');
    expect(s.error).toContain('boom');
    expect(s.scorecard).toBeUndefined();
  });

  it('红线：session 序列化后搜不到 apiKey', async () => {
    const s = makeSession();
    await runSession(s, 'sk-runner-secret', scenario, okFetch('accept') as typeof fetch);
    expect(JSON.stringify(s)).not.toContain('sk-runner-secret');
  });

  it('agent 长文本截断到 200 字符入库', async () => {
    const s = makeSession();
    const long = '好'.repeat(500);
    await runSession(s, undefined, scenario, okFetch(long) as typeof fetch);
    const agentEvent = s.events.find((e) => e.actor === 'agent');
    expect((agentEvent?.text ?? '').length).toBeLessThanOrEqual(200);
  });

  it('请求体携带 model（给了就带，没给就不带字段）', async () => {
    const bodies: string[] = [];
    const capture = async (_url: unknown, init?: { body?: string }) => {
      bodies.push(init?.body ?? '');
      return {
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'accept' } }] }),
      } as unknown as Response;
    };
    await runSession(makeSession(), undefined, scenario, capture as unknown as typeof fetch, 'deepseek-chat');
    await runSession(makeSession(), undefined, scenario, capture as unknown as typeof fetch);
    expect(JSON.parse(bodies[0]).model).toBe('deepseek-chat');
    expect(JSON.parse(bodies[1])).not.toHaveProperty('model');
  });

  it('非 2xx 错误消息带响应体摘要（厂商真实原因在 body 里）', async () => {
    const s = makeSession();
    const bad = async () =>
      ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message: 'model is required' } }),
      }) as unknown as Response;
    await runSession(s, undefined, scenario, bad as unknown as typeof fetch);
    expect(s.status).toBe('failed');
    expect(s.error).toContain('model is required');
  });
});
