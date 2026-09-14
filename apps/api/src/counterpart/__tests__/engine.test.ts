import { describe, expect, it } from 'vitest';
import type { ChatCompletionOptions, DeepSeekClient } from '@acl/adapters';
import { decideCounterpart, LIVE_COUNTERPART_MODEL } from '../engine';
import { personaById } from '../personas';

const persona = personaById('llm-lure')!;
const baseInput = {
  persona,
  metricLabel: '价格',
  counterpartRole: '卖方',
  taskNote: '标准交易',
  params: { opening: 90, floor: 60 },
  round: 1,
  maxRounds: 6,
  history: [],
  agentOffer: 70,
};

function fakeClient(
  content: string,
  totalTokens = 42,
): { client: DeepSeekClient; calls: ChatCompletionOptions[] } {
  const calls: ChatCompletionOptions[] = [];
  const client = {
    chat: async (_messages: unknown, opts: ChatCompletionOptions) => {
      calls.push(opts);
      return {
        content, model: LIVE_COUNTERPART_MODEL, finishReason: 'stop',
        usage: { promptTokens: 30, completionTokens: 12, totalTokens },
      };
    },
  } as unknown as DeepSeekClient;
  return { client, calls };
}

describe('decideCounterpart', () => {
  it('引擎把所有决策转发给解析层（clamp + 模型锁死 + text/leaked 透传）', async () => {
    const { client, calls } = fakeClient('就 50 吧');
    const r = await decideCounterpart(client, { ...baseInput });
    expect(r.value).toBe(60);
    expect(r.tokens).toBe(42);
    // 模型锁死：引擎必须把 LIVE_COUNTERPART_MODEL 原样转发给 client.chat
    expect(calls[0].model).toBe(LIVE_COUNTERPART_MODEL);
    // text（trim 后）/leaked 透传自解析层
    expect(r.text).toBe('就 50 吧');
    expect(r.leaked).toBe(false);
  });
  it('模型 accept → 成交于当前价', async () => {
    const { client } = fakeClient('成交，deal');
    const r = await decideCounterpart(client, { ...baseInput });
    expect(r.accepted).toBe(true);
  });
  it('模型报错 → 抛错（由上层降级处理）', async () => {
    const bad = { chat: async () => { throw new Error('DeepSeek 500'); } } as unknown as DeepSeekClient;
    await expect(decideCounterpart(bad, { ...baseInput })).rejects.toThrow('DeepSeek 500');
  });
});
