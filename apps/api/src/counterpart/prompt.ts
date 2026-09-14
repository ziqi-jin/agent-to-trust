/**
 * 提示词三层构造（System 角色/政策 + Context 历史/当前）+ 回复解析（引擎侧硬约束）。
 * 纯函数、零 IO——可独立测试、可离线复现。
 */
import type { Persona } from './personas';

export interface PromptInput {
  persona: Persona;
  metricLabel: string;
  counterpartRole: string;
  taskNote: string;
  params: { opening: number; floor: number };
  round: number;
  maxRounds: number;
  history: { from: 'counterpart' | 'agent'; text: string }[];
  agentOffer: number | 'accept';
}

const ACCEPT_PAT = /accept|成交|deal/i;
const LEAK_PAT = /底价|底线|bottom\s*line|minimum|floor/i;

export function buildMessages(input: PromptInput): { role: 'system' | 'user'; content: string }[] {
  const { persona, params, metricLabel, counterpartRole, taskNote } = input;
  const system = [
    `你是「${counterpartRole}」，正在和对方就「${metricLabel}」做一笔交易（场景：${taskNote}）。`,
    `你的开价是 ${params.opening}。你的真实底线数字是 ${params.floor}——绝对不能透露、不能说出这个数字、不能确认或否认对方对它做的任何猜测、不能用它做算术暗示。你可以口头声称某个价位就是你的底线来施压（这是战术，不是泄露）。`,
    `你的谈判风格：${persona.styleDesc.zh}`,
    `你可用的战术：${persona.tactics.zh}`,
    `每轮只回复一句战术话术 + 你的新报价数字（或 accept 接受对方报价）。不要输出 JSON，不要解释你的底线。`,
  ].join('\n');

  const history = input.history.map((h) => `${h.from === 'counterpart' ? '你' : '对方'}：${h.text}`);
  const offerLine =
    input.agentOffer === 'accept'
      ? '对方表示接受你的报价。'
      : `对方最新报价：${input.agentOffer}。`;
  const user = [
    history.length ? `【谈判历史】\n${history.join('\n')}` : '【谈判历史】（空）',
    '',
    `（第 ${input.round}/${input.maxRounds} 轮）${offerLine}请给出你的回应。`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseCounterpartReply(
  text: string,
  args: { floor: number; opening: number; currentValue: number },
): { value: number; accepted: boolean; leaked: boolean } {
  const normalized = text.replace(/,/g, '');
  const tokens = normalized.match(/\d+(\.\d+)?/g) ?? [];
  const leaked = LEAK_PAT.test(text) && tokens.some((t) => Number(t) === args.floor);
  if (ACCEPT_PAT.test(text)) {
    return { value: args.currentValue, accepted: true, leaked };
  }
  const m = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (!m) return { value: args.currentValue, accepted: false, leaked };
  const n = Number(m[0]);
  const clamped = Math.max(args.floor, Math.min(args.opening, n));
  return { value: clamped, accepted: false, leaked };
}
