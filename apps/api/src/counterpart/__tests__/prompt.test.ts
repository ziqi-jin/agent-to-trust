import { describe, expect, it } from 'vitest';
import { personaById } from '../personas';
import { buildMessages, parseCounterpartReply } from '../prompt';

const persona = personaById('llm-stubborn')!;

describe('buildMessages', () => {
  it('system 含角色/底价/风格/战术，且底价只以数字形式出现一次（不进自然语言）', () => {
    const msgs = buildMessages({
      persona,
      metricLabel: '价格',
      counterpartRole: '卖方',
      taskNote: '标准交易',
      params: { opening: 96, floor: 72 },
      round: 1,
      maxRounds: 6,
      history: [],
      agentOffer: 'accept',
    });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('72');
    expect(msgs[0].content).toContain(persona.styleDesc.zh);
    expect(msgs[0].content).toContain('不能透露');
  });
  it('history 逐条进 user 上下文，round/maxRounds 出现在最后一条', () => {
    const msgs = buildMessages({
      persona,
      metricLabel: '价格',
      counterpartRole: '卖方',
      taskNote: '标准交易',
      params: { opening: 96, floor: 72 },
      round: 3,
      maxRounds: 6,
      history: [
        { from: 'counterpart', text: '开价 96' },
        { from: 'agent', text: '我出 70' },
      ],
      agentOffer: 70,
    });
    const last = msgs[msgs.length - 1].content;
    expect(last).toContain('开价 96');
    expect(last).toContain('我出 70');
    expect(last).toContain('3/6');
  });
});

describe('parseCounterpartReply', () => {
  const args = { floor: 70, opening: 100, currentValue: 90 };

  it('低于 floor 的数字被 clamp 到 floor', () => {
    expect(parseCounterpartReply('好吧，50 给你', args).value).toBe(70);
  });
  it('高于 opening 的数字被 clamp 到 opening', () => {
    expect(parseCounterpartReply('那就 120', args).value).toBe(100);
  });
  it('accept 关键词 → 按 currentValue 成交', () => {
    const r = parseCounterpartReply('Deal, accept.', args);
    expect(r.accepted).toBe(true);
    expect(r.value).toBe(90);
  });
  it('无数字 → 保持当前价，不成交', () => {
    const r = parseCounterpartReply('我再想想', args);
    expect(r.accepted).toBe(false);
    expect(r.value).toBe(90);
  });
  it('泄露底价 → leaked=true', () => {
    const r = parseCounterpartReply('说实话我的底价就是 70', args);
    expect(r.leaked).toBe(true);
  });
});
