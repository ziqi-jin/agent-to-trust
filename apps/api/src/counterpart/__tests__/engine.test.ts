import { describe, expect, it } from 'vitest';
import type { DeepSeekClient } from '@acl/adapters';
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

function fakeClient(content: string, totalTokens = 42): DeepSeekClient {
  return {
    chat: async () => ({
      content, model: LIVE_COUNTERPART_MODEL, finishReason: 'stop',
      usage: { promptTokens: 30, completionTokens: 12, totalTokens },
    }),
  } as unknown as DeepSeekClient;
}

describe('decideCounterpart', () => {
  it('模型报 50 → 引擎 clamp 到 floor 60', async () => {
    const r = await decideCounterpart(fakeClient('就 50 吧'), { ...baseInput });
    expect(r.value).toBe(60);
    expect(r.tokens).toBe(42);
  });
  it('模型 accept → 成交于当前价', async () => {
    const r = await decideCounterpart(fakeClient('成交，deal'), { ...baseInput });
    expect(r.accepted).toBe(true);
  });
  it('模型报错 → 抛错（由上层降级处理）', async () => {
    const bad = { chat: async () => { throw new Error('DeepSeek 500'); } } as unknown as DeepSeekClient;
    await expect(decideCounterpart(bad, { ...baseInput })).rejects.toThrow('DeepSeek 500');
  });
});
