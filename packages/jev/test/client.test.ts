import { describe, expect, it } from 'vitest';
import { JevClient } from '../src/client.js';

const okResponse = {
  model: 'jev-1.13.0',
  answers: {
    grade: {
      type: 'choice',
      choice: 'success',
      confidence: 0.9,
      probabilities: { success: 0.9, partial: 0.1, failure: 0 },
    },
  },
  usage: { input_tokens: 100, output_tokens: 12 },
};

function fakeFetch(capture: { url?: string; body?: string }) {
  return async (url: string, init: { body: string }) => {
    capture.url = url;
    capture.body = init.body;
    return { ok: true, status: 200, statusText: 'OK', json: async () => okResponse };
  };
}

describe('JevClient', () => {
  it('POST /systemone，带 model 与 questions，解析 answers 与 usage', async () => {
    const capture: { url?: string; body?: string } = {};
    let t = 1000;
    const client = new JevClient({
      apiKey: 'k',
      fetchImpl: fakeFetch(capture) as never,
      now: () => (t += 250),
    });
    const out = await client.systemOne('state text', {
      grade: {
        type: 'choice',
        instructions: 'how good',
        criteria: { success: 'ok', partial: 'meh', failure: 'no' },
      },
    });
    expect(capture.url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(capture.body!) as Record<string, unknown>;
    expect(body.model).toBe('jev-latest');
    expect(body.state).toBe('state text');
    expect((body.questions as Record<string, unknown>).grade).toBeDefined();
    expect(out.response.answers.grade.type).toBe('choice');
    expect(out.inputTokens).toBe(100);
    expect(out.outputTokens).toBe(12);
    expect(out.latencyMs).toBe(250);
  });

  it('非 2xx 抛错', async () => {
    const bad = async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({}),
    });
    const client = new JevClient({ apiKey: 'k', fetchImpl: bad as never });
    await expect(client.systemOne('s', {})).rejects.toThrow(/401/);
  });
});
