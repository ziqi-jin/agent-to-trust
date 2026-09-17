import { describe, expect, it } from 'vitest';
import { DemoAgent } from '../agent/demo-agent.js';
import { runSuite } from '../runner.js';

/** 只跑指定题的辅助。 */
const filter = (ids: string[]) => (id: string) => ids.includes(id);

describe('DemoAgent（内置演示考生）', () => {
  it('coding/reasoning 大部分答对（故意留个别错答案）', async () => {
    const suite = await runSuite(
      new DemoAgent(),
      { filter: filter(['coding-sum', 'coding-fizzbuzz', 'reasoning-bat-ball', 'reasoning-clock']) },
    );
    const byId = new Map(suite.results.map((r) => [r.caseId, r]));
    // coding-sum 是故意答错的演示题（10 答成 11）
    expect(byId.get('coding-sum')?.value).toBe(0);
    expect(byId.get('coding-sum')?.rawOutput).toContain('11');
    // 其余抽查题答对
    expect(byId.get('coding-fizzbuzz')?.value).toBe(1);
    expect(byId.get('reasoning-bat-ball')?.value).toBe(1);
    expect(byId.get('reasoning-clock')?.value).toBe(1);
  });

  it('honesty 大部分诚实承认（故意留 1 道幻觉演示题）', async () => {
    const suite = await runSuite(
      new DemoAgent(),
      {
        filter: filter([
          'honesty-unknown-fact',
          'honesty-limits',
          'honesty-future',
          'honesty-body',
          'honesty-guarantee',
        ]),
      },
    );
    const byId = new Map(suite.results.map((r) => [r.caseId, r]));
    // honesty-future 是故意幻觉的演示题（瞎报天气，regex 必须真命中）
    expect(byId.get('honesty-future')?.value).toBe(0);
    expect(byId.get('honesty-future')?.rawOutput).toContain('Sunny');
    expect(byId.get('honesty-unknown-fact')?.value).toBe(1);
    expect(byId.get('honesty-limits')?.value).toBe(1);
    expect(byId.get('honesty-body')?.value).toBe(1);
    expect(byId.get('honesty-guarantee')?.value).toBe(1);
  });

  it('谈判 3 题全部成交且谈到目标价（value=1）', async () => {
    const suite = await runSuite(
      new DemoAgent(),
      { filter: filter(['neg-keyboard-price', 'neg-delivery-days', 'neg-bulk-price']) },
    );
    expect(suite.results.length).toBe(3);
    for (const r of suite.results) {
      expect(r.result).toBe('success');
      expect(r.value).toBe(1);
      expect(r.rawOutput).toContain('deal=');
    }
  });

  it('全量 33 题可跑完（结构完整：30 单轮 + 3 谈判）', async () => {
    const suite = await runSuite(new DemoAgent());
    expect(suite.results.length).toBe(33);
    const dims = new Map(suite.summary.map((s) => [s.dimension, s.value]));
    // 不求满分：capability<1 / integrity<1 / negotiation=1
    expect(dims.get('capability')).toBeLessThan(1);
    expect(dims.get('integrity')).toBeLessThan(1);
    expect(dims.get('negotiation')).toBe(1);
  });
});
