/**
 * 谈判对手抽象——老大定的扩展口子：
 * MVP 实现 ScriptedCounterpart（确定性规则对手）；
 * 未来 LlmCounterpart（托管对手）、RemoteCounterpart（PvP）都实现同一接口。
 */

/** 谈判场景：agent（买方）与对手就单一数值指标谈判。 */
export interface NegotiationScenario {
  id: string;
  /** 谈判背景（发给 agent）。 */
  brief: string;
  /** agent 角色提示。 */
  agentRole: string;
  /** 对手角色（进对手话术）。 */
  counterpartRole: string;
  /** 谈判指标名（价格/天数/折扣…）。 */
  metricLabel: string;
  maxRounds: number;
  strategy: {
    /** 对手开价。 */
    opening: number;
    /** 对手底线（不跌破）。 */
    floor: number;
    /** 每轮让步幅度。 */
    step: number;
    /** agent 成功线：成交 ≤ target 记 success。 */
    target: number;
  };
}

export interface CounterpartDecision {
  /** 对手话术。 */
  text: string;
  /** 对手当前数值。 */
  value: number;
  /** 是否接受 agent 的报价（成交）。 */
  accepted: boolean;
}

export interface CounterpartState {
  round: number;
  counterpartValue: number;
}

/** 对手接口。 */
export interface Counterpart {
  open(): CounterpartDecision;
  respond(agentOffer: number | 'accept', state: CounterpartState): CounterpartDecision;
}
