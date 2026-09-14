import { describe, expect, it } from 'vitest';
import type { DeepSeekClient } from '@acl/adapters';
import { createLiveBrain, createScriptedBrain } from '../brains';
import { personaById } from '../personas';

const st = { currentPrice: 80, accepted: false, negotiateRounds: 0 };

describe('createScriptedBrain（复刻旧语义）', () => {
  it('开局 OFFER 80', () => {
    expect(createScriptedBrain({ price: 80, maxRounds: 3 }).opening())
      .toEqual({ type: 'OFFER', payload: { price: 80, note: '平台一口价，接受即交付' } });
  });
  it('ACCEPT → 催交付 NEGOTIATE', async () => {
    const a = await createScriptedBrain({ price: 80, maxRounds: 3 })
      .react({ type: 'ACCEPT', payload: { price: 80 } }, { ...st, accepted: false });
    expect(a?.type).toBe('NEGOTIATE');
    expect(a?.payload.note).toBe('已接受报价，请交付');
  });
  it('重复 ACCEPT（accepted 已置位）→ null（不再重发催交付，保 Ruling 1 保真）', async () => {
    const a = await createScriptedBrain({ price: 80, maxRounds: 3 })
      .react({ type: 'ACCEPT', payload: { price: 80 } }, { ...st, accepted: true });
    expect(a).toBeNull();
  });
  it('DELIVER → null（验收+结算由引擎按序推两条，见 Task 7）', async () => {
    const a = await createScriptedBrain({ price: 80, maxRounds: 3 })
      .react({ type: 'DELIVER', payload: { item: 'x' } }, st);
    expect(a).toBeNull();
  });
  it('协商超限 → REJECT', async () => {
    const a = await createScriptedBrain({ price: 80, maxRounds: 3 })
      .react({ type: 'NEGOTIATE', payload: {} }, { ...st, negotiateRounds: 3 });
    expect(a?.type).toBe('REJECT');
  });
});

describe('createLiveBrain', () => {
  it('模型报价被 clamp 到 floor，且 token 回调被调用', async () => {
    const client = { chat: async () => ({
      content: '就 10 块吧', model: 'x', finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 7 },
    }) } as unknown as DeepSeekClient;
    let tokens = 0;
    const brain = createLiveBrain(client, {
      persona: personaById('llm-stubborn')!,
      params: { opening: 96, floor: 72 },
      maxRounds: 6,
      onTokens: (n) => { tokens += n; },
    });
    const a = await brain.react({ type: 'OFFER', payload: { price: 70 } }, st);
    expect(a?.type).toBe('OFFER');
    expect(a?.payload.price).toBe(72);
    expect(tokens).toBe(7);
  });
  it('模型 accept → ACCEPT', async () => {
    const client = { chat: async () => ({
      content: '成交', model: 'x', finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 3 },
    }) } as unknown as DeepSeekClient;
    const brain = createLiveBrain(client, {
      persona: personaById('llm-softer')!, params: { opening: 90, floor: 60 },
      maxRounds: 6, onTokens: () => {},
    });
    const a = await brain.react({ type: 'OFFER', payload: { price: 75 } }, st);
    expect(a?.type).toBe('ACCEPT');
  });
});
