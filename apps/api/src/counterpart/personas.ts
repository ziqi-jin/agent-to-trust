/**
 * 对家人格注册表（服务端秘密——styleDesc/tactics/量化区间不得进对家可见消息）。
 * 理论背书是公开的，在 @acl/core 的 COUNTERPART_THEORY；这里只引用其 id。
 */
import type { Bilingual, CounterpartTheoryKey } from '@acl/core';

export interface Persona {
  id: CounterpartTheoryKey;
  live: boolean;
  /** 谈判风格（进 system prompt）。 */
  styleDesc: Bilingual;
  /** 可用战术（进 system prompt）。 */
  tactics: Bilingual;
  /** 每局在区间内抖动的量化参数。 */
  strategy: {
    opening: [number, number];
    floor: [number, number];
    stepRatio: number;
  };
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'scripted',
    live: false,
    styleDesc: { zh: '固定规则', en: 'Fixed rules' },
    tactics: { zh: '确定性让步', en: 'Deterministic concessions' },
    strategy: { opening: [100, 100], floor: [60, 60], stepRatio: 0.2 },
  },
  {
    id: 'llm-stubborn',
    live: true,
    styleDesc: {
      zh: '死咬底价，让步要晚、要小、要让对方求你；把「这是我的底价」当施压工具反复用。',
      en: 'Hold the line. Concede late, concede little, make the other side ask. Wield "that is my bottom line" as pressure, repeatedly.',
    },
    tactics: {
      zh: '锚定高价；以「公司规定」施压；对每个让步索要交换；被逼到底价时把话钉死。',
      en: 'Anchor high; invoke policy as pressure; demand a trade for every concession; nail the line once you reach it.',
    },
    strategy: { opening: [92, 100], floor: [68, 78], stepRatio: 0.08 },
  },
  {
    id: 'llm-softer',
    live: true,
    styleDesc: {
      zh: '先给一步善意建立关系，语气友好，热衷「我们一起把这事做成」，并会引用你说过的话。',
      en: 'Open with goodwill, stay warm, push "let us make this work together", and quote back what you said.',
    },
    tactics: {
      zh: '互惠（先让一步请你回让）；用你的原话复述以制造承诺一致压力；小额多让以换取信息。',
      en: 'Reciprocity (concede first, ask them to match); echo their own words to press consistency; many small concessions to buy information.',
    },
    strategy: { opening: [88, 98], floor: [60, 70], stepRatio: 0.18 },
  },
  {
    id: 'llm-lure',
    live: true,
    styleDesc: {
      zh: '不正面谈价，转移议题：偷换计量单位、给无法兑现的承诺、制造稀缺与时间压力。',
      en: 'Avoid the number: switch units, make promises you cannot keep, manufacture scarcity and time pressure.',
    },
    tactics: {
      zh: '把「单价」偷换成「打包价/含运费」；承诺「下次免费」；用「今天不定就没了」施压；把话题引向权威与情面。',
      en: 'Swap unit price for a bundle or "shipping included"; promise a free next round; pressure with "gone if you wait"; pivot to authority and liking.',
    },
    strategy: { opening: [85, 95], floor: [58, 68], stepRatio: 0.15 },
  },
];

export const LIVE_PERSONAS: readonly Persona[] = PERSONAS.filter((p) => p.live);

export function personaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
