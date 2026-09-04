import { scenarioText, type Counterpart, type CounterpartDecision, type CounterpartState, type Locale, type NegotiationScenario } from './types.js';

/**
 * ScriptedCounterpart：确定性规则对手（零 token 成本、完美可复现、人人同对手）。
 *
 * 策略：
 * - 开价 = strategy.opening
 * - 接受线 = max(floor, 当前价 - step)：agent 报价达线 → 按 agent 报价成交
 * - 未达线 → 让步到 max(floor, 当前价 - step)，跌破 floor 后价格钉死
 * - agent 回 'accept' → 按对手当前价成交
 * 话术为固定模板：同输入永远同输出。
 * locale（默认 'zh'）：话术语言；默认值保证既有考场路径逐字节不变（分数确定性红线）。
 */
export class ScriptedCounterpart implements Counterpart {
  constructor(
    private readonly scenario: NegotiationScenario,
    private readonly locale: Locale = 'zh',
  ) {}

  open(): CounterpartDecision {
    const s = this.scenario.strategy;
    const t = scenarioText(this.scenario, this.locale);
    if (this.locale === 'en') {
      return {
        text: `${t.counterpartRole}: ${t.metricLabel} ${s.opening} — that's the list price, hard to go any lower.`,
        value: s.opening,
        accepted: false,
      };
    }
    return {
      text: `${t.counterpartRole}：${t.metricLabel} ${s.opening}，这是公开报价，很难再低了。`,
      value: s.opening,
      accepted: false,
    };
  }

  respond(agentOffer: number | 'accept', state: CounterpartState): CounterpartDecision {
    const s = this.scenario.strategy;
    if (agentOffer === 'accept') {
      if (this.locale === 'en') {
        return {
          text: `Deal! We'll close at ${state.counterpartValue}. Pleasure doing business.`,
          value: state.counterpartValue,
          accepted: true,
        };
      }
      return {
        text: `成交！就按 ${state.counterpartValue} 走，合作愉快。`,
        value: state.counterpartValue,
        accepted: true,
      };
    }
    const acceptLine = Math.max(s.floor, state.counterpartValue - s.step);
    if (agentOffer >= acceptLine) {
      if (this.locale === 'en') {
        return {
          text: `Alright, ${agentOffer} it is. Deal.`,
          value: agentOffer,
          accepted: true,
        };
      }
      return {
        text: `行，就按你说的 ${agentOffer} 成交。`,
        value: agentOffer,
        accepted: true,
      };
    }
    const next = Math.max(s.floor, state.counterpartValue - s.step);
    if (this.locale === 'en') {
      const text =
        next <= s.floor
          ? `${next} is my bottom line — I genuinely can't go any lower. Take it or leave it.`
          : `Alright, I'll make a move: ${next}. That's a serious concession.`;
      return { text, value: next, accepted: false };
    }
    const text =
      next <= s.floor
        ? `${next} 是底价了，再低真做不了，你要不考虑就算了。`
        : `这样，我让一步：${next}。这个诚意够多了吧。`;
    return { text, value: next, accepted: false };
  }
}
