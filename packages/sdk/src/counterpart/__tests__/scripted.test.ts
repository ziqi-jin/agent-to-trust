import { describe, expect, it } from 'vitest';
import { ScriptedCounterpart } from '../scripted.js';
import type { NegotiationScenario } from '../types.js';

const SC: NegotiationScenario = {
  id: 'test-sc',
  brief: '',
  agentRole: '',
  counterpartRole: '卖家',
  metricLabel: '单价',
  maxRounds: 4,
  strategy: { opening: 100, floor: 55, step: 15, target: 65 },
};

describe('ScriptedCounterpart', () => {
  it('opens at strategy.opening', () => {
    const d = new ScriptedCounterpart(SC).open();
    expect(d.value).toBe(100);
    expect(d.accepted).toBe(false);
  });

  it('concedes by step, never below floor', () => {
    const cp = new ScriptedCounterpart(SC);
    let v = cp.open().value;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const d = cp.respond(0, { round: i + 1, counterpartValue: v }); // 报 0 → 永不接受
      expect(d.accepted).toBe(false);
      v = d.value;
      seen.push(v);
    }
    expect(seen).toEqual([85, 70, 55, 55, 55]);
  });

  it('accepts agent offer at or above accept line', () => {
    const cp = new ScriptedCounterpart(SC);
    const d = cp.respond(85, { round: 1, counterpartValue: 100 }); // 线 = max(55, 85) = 85
    expect(d.accepted).toBe(true);
    expect(d.value).toBe(85);
  });

  it('rejects below accept line', () => {
    const cp = new ScriptedCounterpart(SC);
    const d = cp.respond(84, { round: 1, counterpartValue: 100 });
    expect(d.accepted).toBe(false);
  });

  it("agent 'accept' closes at counterpart current value", () => {
    const cp = new ScriptedCounterpart(SC);
    const d = cp.respond('accept', { round: 2, counterpartValue: 70 });
    expect(d.accepted).toBe(true);
    expect(d.value).toBe(70);
  });

  // ── 0904 i18n：locale 双语（默认 zh 逐字节回归红线）──

  it('回归红线：默认构造（不传 locale）话术与旧中文逐字节一致', () => {
    const sc: NegotiationScenario = {
      id: 'zh-regression',
      brief: '背景',
      agentRole: '买方',
      counterpartRole: '供应商销售',
      metricLabel: '单价（元）',
      maxRounds: 4,
      strategy: { opening: 100, floor: 55, step: 15, target: 65 },
      en: { brief: 'EN brief', agentRole: 'Buyer', counterpartRole: 'Sales', metricLabel: 'Price' },
    };
    const cp = new ScriptedCounterpart(sc); // 默认 zh
    expect(cp.open().text).toBe('供应商销售：单价（元） 100，这是公开报价，很难再低了。');
    expect(cp.respond('accept', { round: 1, counterpartValue: 100 }).text).toBe('成交！就按 100 走，合作愉快。');
    expect(cp.respond(85, { round: 1, counterpartValue: 100 }).text).toBe('行，就按你说的 85 成交。');
    expect(cp.respond(0, { round: 1, counterpartValue: 100 }).text).toBe('这样，我让一步：85。这个诚意够多了吧。');
    expect(cp.respond(0, { round: 2, counterpartValue: 85 }).text).toBe('这样，我让一步：70。这个诚意够多了吧。');
    const atFloor = cp.respond(0, { round: 3, counterpartValue: 70 });
    expect(atFloor.text).toBe('55 是底价了，再低真做不了，你要不考虑就算了。');
  });

  it('locale=en：话术走英文模板且确定（同输入同输出）；数值行为与 zh 一致', () => {
    const sc: NegotiationScenario = {
      id: 'en-dialog',
      brief: '背景',
      agentRole: '买方',
      counterpartRole: 'Supplier Sales Rep',
      metricLabel: 'Unit price (CNY)',
      maxRounds: 4,
      strategy: { opening: 100, floor: 55, step: 15, target: 65 },
    };
    const cp = new ScriptedCounterpart(sc, 'en');
    const open = cp.open();
    expect(open.text).toBe('Supplier Sales Rep: Unit price (CNY) 100 — that\'s the list price, hard to go any lower.');
    expect(cp.open().text).toBe(open.text); // 确定性
    expect(cp.respond('accept', { round: 1, counterpartValue: 100 }).text).toBe("Deal! We'll close at 100. Pleasure doing business.");
    expect(cp.respond(85, { round: 1, counterpartValue: 100 }).text).toBe('Alright, 85 it is. Deal.');
    expect(cp.respond(0, { round: 1, counterpartValue: 100 }).text).toBe("Alright, I'll make a move: 85. That's a serious concession.");
    expect(cp.respond(0, { round: 3, counterpartValue: 55 }).text).toBe("55 is my bottom line — I genuinely can't go any lower. Take it or leave it.");
    // 数值行为与语言无关
    expect(open.value).toBe(100);
    let v = open.value;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const d = cp.respond(0, { round: i + 1, counterpartValue: v });
      v = d.value;
      seen.push(v);
    }
    expect(seen).toEqual([85, 70, 55, 55, 55]);
  });

  it('scenarioText：en 缺失回退中文源；en 存在返回英文（纯函数）', async () => {
    const { scenarioText } = await import('../types.js');
    const sc: NegotiationScenario = {
      id: 'st',
      brief: '中文背景',
      agentRole: '买方',
      counterpartRole: '卖方',
      metricLabel: '单价',
      maxRounds: 4,
      strategy: { opening: 10, floor: 5, step: 1, target: 6 },
    };
    expect(scenarioText(sc, 'zh').brief).toBe('中文背景');
    expect(scenarioText(sc, 'en').brief).toBe('中文背景'); // 无 en 字段 → 回退
    const withEn = { ...sc, en: { brief: 'EN brief', agentRole: 'B', counterpartRole: 'S', metricLabel: 'P' } };
    expect(scenarioText(withEn, 'en')).toEqual({ brief: 'EN brief', agentRole: 'B', counterpartRole: 'S', metricLabel: 'P' });
  });
});
