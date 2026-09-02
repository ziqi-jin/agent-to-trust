import { describe, expect, it } from 'vitest';
import type { AclAgent } from '../agent/types.js';
import { runSuite } from '../runner.js';

/** 按 prompt 关键词返回序列回复的 fixture agent（每键独立计数）。 */
class SeqAgent implements AclAgent {
  private counters = new Map<string, number>();
  constructor(private readonly rules: { key: string; replies: string[] }[]) {}
  async reply(prompt: string): Promise<string> {
    for (const r of this.rules) {
      if (prompt.includes(r.key)) {
        const i = this.counters.get(r.key) ?? 0;
        this.counters.set(r.key, i + 1);
        return r.replies[Math.min(i, r.replies.length - 1)];
      }
    }
    return '（无有效回复）';
  }
}

class EchoAgent implements AclAgent {
  async reply(prompt: string): Promise<string> {
    return `echo: ${prompt.slice(0, 10)}`;
  }
}

/** 第一次 reply 报错，之后正常（模拟厂商瞬时 5xx）。 */
class FlakyAgent implements AclAgent {
  private failed = false;
  async reply(prompt: string): Promise<string> {
    if (!this.failed) {
      this.failed = true;
      throw new Error('模型 API 返回 500');
    }
    return `echo: ${prompt.slice(0, 10)}`;
  }
}

/** 永远报错（模型服务彻底不可用）。 */
class AlwaysFailAgent implements AclAgent {
  async reply(_prompt: string): Promise<string> {
    throw new Error('连接超时');
  }
}

describe('runSuite', () => {
  it('runs 33 cases (30 single-turn + 3 negotiation) and summarizes', async () => {
    const res = await runSuite(new EchoAgent());
    expect(res.results).toHaveLength(33);
    expect(res.benchmarkVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.results.filter((r) => r.dimension === 'negotiation')).toHaveLength(3);
    const dims = res.summary.map((s) => s.dimension);
    expect(dims).toContain('capability');
    expect(dims).toContain('integrity');
    expect(dims).toContain('negotiation');
  }, 30000);

  it('is deterministic for the same agent', async () => {
    const a = await runSuite(new EchoAgent(), { filter: (id) => id.startsWith('neg') });
    const b = await runSuite(new EchoAgent(), { filter: (id) => id.startsWith('neg') });
    expect(a.results).toEqual(b.results);
  }, 30000);

  it('retries once when a single reply fails transiently (vendor 5xx)', async () => {
    const res = await runSuite(new FlakyAgent(), {
      filter: (_id, dim) => dim === 'coding',
    });
    expect(res.results.length).toBeGreaterThan(0);
    // 重试后成功：不应有「执行失败」标记（区别于正常答题的 partial/failure）
    expect(res.results.every((r) => !r.rawOutput.startsWith('[执行失败]'))).toBe(true);
  }, 30000);

  it('records failure cases (value 0) instead of aborting when model is dead', async () => {
    const res = await runSuite(new AlwaysFailAgent(), {
      filter: (_id, dim) => dim === 'coding',
    });
    expect(res.results.length).toBe(10);
    expect(res.results.every((r) => r.result === 'failure' && r.value === 0)).toBe(true);
    expect(res.results[0].rawOutput).toContain('执行失败');
  }, 30000);

  it('patient incremental bidding closes near floor (success)', async () => {
    const agent = new SeqAgent([{ key: '键盘', replies: ['60', '62', '64', 'accept'] }]);
    const res = await runSuite(agent, { filter: (id) => id === 'neg-keyboard-price' });
    const r = res.results.find((x) => x.caseId === 'neg-keyboard-price')!;
    expect(r.result).toBe('success');
    expect(r.rawOutput).toContain('deal=64');
    expect(r.value).toBe(1);
  });

  it('eager high offer closes expensive (partial)', async () => {
    const agent = new SeqAgent([{ key: '键盘', replies: ['95'] }]);
    const res = await runSuite(agent, { filter: (id) => id === 'neg-keyboard-price' });
    const r = res.results.find((x) => x.caseId === 'neg-keyboard-price')!;
    expect(r.result).toBe('partial');
    expect(r.value).toBe(0.14);
  });

  it('stubborn lowballing breaks the deal (failure)', async () => {
    const agent = new SeqAgent([{ key: '键盘', replies: ['50', '50', '50', '50'] }]);
    const res = await runSuite(agent, { filter: (id) => id === 'neg-keyboard-price' });
    const r = res.results.find((x) => x.caseId === 'neg-keyboard-price')!;
    expect(r.result).toBe('failure');
    expect(r.value).toBe(0);
  });

  it('double invalid replies break the negotiation', async () => {
    const agent = new SeqAgent([{ key: '键盘', replies: ['你好呀', '再说吧', '120'] }]);
    const res = await runSuite(agent, { filter: (id) => id === 'neg-keyboard-price' });
    const r = res.results.find((x) => x.caseId === 'neg-keyboard-price')!;
    expect(r.result).toBe('failure');
  });
});
