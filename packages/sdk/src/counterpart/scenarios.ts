import type { NegotiationScenario } from './types.js';

/**
 * 谈判场景 v1（3 个，全部 vs 脚本对手）。
 * 场景设计原则：目标可达（对手 floor < target）、轮次有限、策略空间清晰。
 */
export const NEGOTIATION_SCENARIOS: readonly NegotiationScenario[] = [
  {
    id: 'neg-keyboard-price',
    brief: '你要为公司采购 100 把定制机械键盘，正在和供应商谈单价。市场参考价约 90 元。',
    agentRole: '采购经理',
    counterpartRole: '供应商销售',
    metricLabel: '单价（元）',
    maxRounds: 4,
    strategy: { opening: 100, floor: 55, step: 15, target: 65 },
    en: {
      brief: 'You are sourcing 100 custom mechanical keyboards for your company and negotiating the unit price with a supplier. Market reference is about 90 CNY per unit.',
      agentRole: 'Procurement Manager',
      counterpartRole: 'Supplier Sales Rep',
      metricLabel: 'Unit price (CNY)',
    },
  },
  {
    id: 'neg-delivery-days',
    brief: '你把一个官网项目外包，正在和外包团队谈交付周期。他们第一次报价 14 天。',
    agentRole: '甲方项目负责人',
    counterpartRole: '外包团队负责人',
    metricLabel: '交付天数',
    maxRounds: 4,
    strategy: { opening: 14, floor: 6, step: 3, target: 7 },
    en: {
      brief: 'You have outsourced a website project and are negotiating the delivery timeline with the contractor. Their opening quote is 14 days.',
      agentRole: 'Client-side Project Lead',
      counterpartRole: 'Outsourcing Team Lead',
      metricLabel: 'Delivery days',
    },
  },
  {
    id: 'neg-bulk-price',
    brief: '你要采购 1000 件文化衫（市场价 10 元/件），正在和服装厂谈折后单价。',
    agentRole: '连锁店主',
    counterpartRole: '服装厂业务员',
    metricLabel: '折后单价（元）',
    maxRounds: 4,
    strategy: { opening: 9.5, floor: 8, step: 0.5, target: 8.5 },
    en: {
      brief: 'You are buying 1,000 T-shirts (market price 10 CNY each) and negotiating a discounted bulk unit price with the garment factory.',
      agentRole: 'Chain Store Owner',
      counterpartRole: 'Garment Factory Sales Rep',
      metricLabel: 'Discounted unit price (CNY)',
    },
  },
];
