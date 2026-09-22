import { describe, expect, it } from 'vitest';
import type { BenchmarkCase } from 'agent-to-trust';
import { createDeterministicJudge } from '../src/judges/deterministic.js';
import { createLlmJudge, parseVerdict } from '../src/judges/llm.js';
import { createJevJudge } from '../src/judges/jev.js';

const c: BenchmarkCase = {
  id: 'coding-sum',
  dimension: 'coding',
  prompt: 'sum?',
  grade: (o) => ({ value: o.includes('10') ? 1 : 0, result: o.includes('10') ? 'success' : 'failure' }),
};

describe('deterministic judge', () => {
  it('包装 case.grade，透传 result/value', async () => {
    const j = createDeterministicJudge();
    expect(j.name).toBe('deterministic');
    const v = await j.grade(c, 'the answer is 10');
    expect(v.result).toBe('success');
    expect(v.value).toBe(1);
  });
});

describe('llm judge', () => {
  it('parseVerdict 解析三档', () => {
    expect(parseVerdict('partial')).toBe('partial');
    expect(parseVerdict('Success.')).toBe('success');
    expect(parseVerdict('This is wrong')).toBe('failure');
    expect(parseVerdict('???')).toBe('failure');
  });

  it('调用注入的 chat 客户端', async () => {
    const calls: unknown[] = [];
    const fake = {
      chat: async (_m: unknown, o: unknown) => {
        calls.push(o);
        return { content: 'partial', model: 'x', finishReason: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      },
    };
    const j = createLlmJudge(fake as never, 'deepseek-chat');
    const v = await j.grade(c, 'half right');
    expect(j.name).toBe('llm');
    expect(v.result).toBe('partial');
    expect(v.value).toBe(0.5);
    expect(calls).toHaveLength(1);
  });
});

function jevStub(choice: string, latencyMs = 400, inputTokens = 150) {
  return {
    systemOne: async () => ({
      response: {
        model: 'jev-1.13.0',
        answers: { grade: { type: 'choice', choice, confidence: 0.8, probabilities: {} } },
        usage: {},
      },
      latencyMs,
      inputTokens,
      outputTokens: 5,
    }),
  };
}

describe('jev judge', () => {
  it('choice → verdict，带延迟/token', async () => {
    const j = createJevJudge(jevStub('partial') as never);
    expect(j.name).toBe('jev');
    const v = await j.grade(c, 'half right');
    expect(v.result).toBe('partial');
    expect(v.value).toBe(0.5);
    expect(v.latencyMs).toBe(400);
    expect(v.inputTokens).toBe(150);
  });

  it('未知 choice 兜底 failure', async () => {
    const j = createJevJudge(jevStub('banana') as never);
    const v = await j.grade(c, 'x');
    expect(v.result).toBe('failure');
  });
});
