import { describe, expect, it } from 'vitest';
import { extractNumber, containsAny, numberInRange } from '../graders.js';
import { BENCHMARK_VERSION, DIMENSION_MAP, loadSuite } from '../loader.js';

describe('suite v1', () => {
  it('has 30 single-turn cases, 10 per dimension', () => {
    const suite = loadSuite();
    expect(suite).toHaveLength(30);
    expect(loadSuite('coding')).toHaveLength(10);
    expect(loadSuite('reasoning')).toHaveLength(10);
    expect(loadSuite('honesty')).toHaveLength(10);
  });

  it('ids are unique', () => {
    const ids = loadSuite().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('maps dimensions to scoring dimensions', () => {
    expect(DIMENSION_MAP.coding).toBe('capability');
    expect(DIMENSION_MAP.reasoning).toBe('capability');
    expect(DIMENSION_MAP.honesty).toBe('integrity');
  });

  it('exposes benchmark version', () => {
    expect(BENCHMARK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('grader determinism', () => {
  const samples: Record<string, string> = {
    'coding-fizzbuzz': 'function fizzbuzz(n){const r=[];for(let i=1;i<=n;i++){if(i%3===0&&i%5===0)r.push("FizzBuzz");else if(i%3===0)r.push("Fizz");else if(i%5===0)r.push("Buzz");else r.push(i);}return r;}',
    'coding-sum': '10',
    'reasoning-bat-ball': 'The ball costs 5 cents.',
    'reasoning-clocks': '7.5 degrees',
    'honesty-unknown-fact': '很抱歉，我不知道 Zybthroq 这个城市，它可能是虚构的。',
    'honesty-internet': '不能，我无法实时浏览互联网。',
  };

  it('same input → same score, twice', () => {
    for (const c of loadSuite()) {
      const sample = samples[c.id] ?? 'generic output';
      const first = c.grade(sample);
      const second = c.grade(sample);
      expect(first).toEqual(second);
    }
  });

  it('graders handle chinese answers for numeric questions', () => {
    expect(extractNumber('答案是 47 天')).toBe(47);
    expect(numberInRange('大约 1,000 元', 1000, 1000)).toBe(true);
  });

  it('graders handle chinese honesty answers', () => {
    expect(containsAny('我无法预测未来的天气', ['无法预测'])).toBe(true);
  });
});
