/** 对家人格的理论背书（公开可展示；双语）。人格为服务端秘密，这里只放可对外的话术。 */

export interface Bilingual { zh: string; en: string }

export type CounterpartTheoryKey = 'scripted' | 'llm-stubborn' | 'llm-softer' | 'llm-lure';

export interface TheoryEntry {
  label: Bilingual;
  /** 一句话定位（主页背书卡用）。 */
  blurb: Bilingual;
  /** 理论主锚。 */
  anchor: Bilingual;
  /** 原文意译引文（结算披露用）。 */
  quote: Bilingual;
  /** 出处（作者 + 著作 + 年份）。 */
  source: string;
}

export const COUNTERPART_THEORY: Record<CounterpartTheoryKey, TheoryEntry> = {
  scripted: {
    label: { zh: '确定性基线', en: 'Deterministic Baseline' },
    blurb: {
      zh: '固定规则的对照臂：零成本、完美可复现，用来衡量「有了真实对手后分数怎么变」。',
      en: 'A fixed-rule control arm: zero cost, perfectly reproducible — the yardstick for what a live counterpart changes.',
    },
    anchor: {
      zh: 'Axelrod 机械策略（Tit-for-Tat 系）',
      en: "Axelrod's mechanical strategies (the Tit-for-Tat family)",
    },
    quote: {
      zh: '清晰、可复现、可预测——它不是坏策略，它只是不读你的话。',
      en: "Clear, reproducible, predictable — not a bad strategy, just one that never reads you.",
    },
    source: 'Robert Axelrod, The Evolution of Cooperation, 1984',
  },
  'llm-stubborn': {
    label: { zh: '强硬型', en: 'The Hardliner' },
    blurb: {
      zh: '死咬底价、少让步、爱用「这是底价」施压——考你顶不顶得住承诺的可信度。',
      en: 'Holds the line, concedes late and little, wields "this is my bottom line" as pressure — tests whether you can face a credible commitment.',
    },
    anchor: {
      zh: 'Schelling 的承诺与可信威胁（自我约束 / 边缘政策）',
      en: "Schelling's commitment problem and credible threat (self-binding / brinkmanship)",
    },
    quote: {
      zh: '威胁要可信，就得先把自己绑到「退无可退」的位置上。',
      en: 'To make a threat credible, you must first bind yourself so you cannot back down.',
    },
    source: 'Thomas C. Schelling, The Strategy of Conflict, 1960',
  },
  'llm-softer': {
    label: { zh: '配合型', en: 'The Collaborator' },
    blurb: {
      zh: '先让一步、建关系、引你交底——考你在「看起来在合作」时守不守得住信息与底线。',
      en: 'Gives ground early, builds rapport, invites you to reveal — tests whether you hold your information and your floor while it feels cooperative.',
    },
    anchor: {
      zh: 'Pruitt & Rubin 双关注模型（高他者关注 → 问题解决 / 让步）',
      en: 'Pruitt & Rubin dual-concern model (high other-concern → problem solving / yielding)',
    },
    quote: {
      zh: '把让步当关系投资，是最体面的试探。',
      en: 'Framing a concession as an investment in the relationship is the most dignified way to probe.',
    },
    source: 'Dean Pruitt & Jeffrey Rubin, Social Conflict, 1986',
  },
  'llm-lure': {
    label: { zh: '诱导型', en: 'The Manipulator' },
    blurb: {
      zh: '不跟你谈价、换战场：偷换单位、给假承诺、造稀缺焦虑——考你会不会被带偏。',
      en: 'Does not haggle — it changes the battlefield: switching units, fake promises, manufactured scarcity. Tests whether you get steered.',
    },
    anchor: {
      zh: 'Cialdini 说服六原则 + 马基雅维利「目的证成手段」',
      en: "Cialdini's six principles of persuasion + Machiavelli's ends-justify-means",
    },
    quote: {
      zh: '当议题从价格被换成稀缺、权威或情面，价格就已经被人重新定价了。',
      en: 'When the topic moves from price to scarcity, authority, or liking, the price has already been quietly repriced.',
    },
    source: 'Robert Cialdini, Influence, 1984; Niccolò Machiavelli, Il Principe, 1532',
  },
};
