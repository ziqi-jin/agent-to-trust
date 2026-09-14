/**
 * 买家 Brain 抽象：把「脚本规则买家」与「LLM 人格买家」统一到一套接口，
 * 由 Task 7 的引擎循环驱动。脚本 Brain 必须复刻旧 runPlatformBuyer 的事件语义。
 */
import type { DeepSeekClient } from '@acl/adapters';
import { decideCounterpart } from './engine';
import type { Persona } from './personas';

export interface BuyerAction { type: string; payload: Record<string, unknown> }
export interface BuyerEvent { type: string; payload: Record<string, unknown> | null }
export interface BrainState { currentPrice: number; accepted: boolean; negotiateRounds: number }

export interface BuyerBrain {
  opening(): BuyerAction;
  react(e: BuyerEvent, state: BrainState): Promise<BuyerAction | null>;
  onTimeout(): BuyerAction;
}

/** 脚本规则买家：确定性、零 token；语义等价旧 runPlatformBuyer。 */
export function createScriptedBrain(cfg: { price: number; maxRounds: number }): BuyerBrain {
  return {
    opening: () => ({ type: 'OFFER', payload: { price: cfg.price, note: '平台一口价，接受即交付' } }),
    async react(e, state) {
      if (e.type === 'ACCEPT' && !state.accepted) {
        return { type: 'NEGOTIATE', payload: { note: '已接受报价，请交付' } };
      }
      if (e.type === 'DELIVER') return null; // 引擎看到 DELIVER 自行推 VERIFY_RESULT + SETTLE
      if (e.type === 'NEGOTIATE' || e.type === 'OFFER') {
        const r = state.negotiateRounds + 1;
        if (r > cfg.maxRounds) return { type: 'REJECT', payload: { reason: '平台一口价，磋商超限，终止' } };
        return { type: 'OFFER', payload: { price: cfg.price, note: `价格不变（磋商 ${r}/${cfg.maxRounds}）` } };
      }
      if (e.type === 'REJECT' || e.type === 'SETTLE') return null; // 引擎退出
      return null;
    },
    onTimeout: () => ({ type: 'REJECT', payload: { reason: '平台对家等待超时，收尾退出' } }),
  };
}

/** LLM 人格买家：每轮调模型，引擎侧 clamp；token 通过 onTokens 上报预算。 */
export function createLiveBrain(
  client: DeepSeekClient,
  ctx: { persona: Persona; params: { opening: number; floor: number }; maxRounds: number; onTokens: (n: number) => void },
): BuyerBrain {
  const history: { from: 'counterpart' | 'agent'; text: string }[] = [];
  return {
    opening: () => ({
      type: 'OFFER',
      payload: { price: ctx.params.opening, note: `${ctx.persona.id} 开价` },
    }),
    async react(e, state) {
      if (e.type === 'DELIVER') return null;              // 引擎负责验收+结算
      if (e.type === 'REJECT' || e.type === 'SETTLE') return null;
      if (e.type === 'ACCEPT' && !state.accepted) {
        return { type: 'NEGOTIATE', payload: { note: '已接受，请按约定交付' } };
      }
      const raw = e.payload?.price;
      const agentOffer = typeof raw === 'number' ? raw : 'accept';
      history.push({ from: 'agent', text: typeof raw === 'number' ? `报价 ${raw}` : String(e.type) });
      const d = await decideCounterpart(client, {
        persona: ctx.persona,
        metricLabel: '价格',
        counterpartRole: '卖方',
        taskNote: '标准交易',
        params: ctx.params,
        round: Math.min(state.negotiateRounds + 1, ctx.maxRounds),
        maxRounds: ctx.maxRounds,
        history,
        agentOffer,
      }, state.currentPrice);
      ctx.onTokens(d.tokens);
      history.push({ from: 'counterpart', text: d.text });
      if (d.accepted) return { type: 'ACCEPT', payload: { price: state.currentPrice } };
      return { type: 'OFFER', payload: { price: d.value, note: d.text.slice(0, 120), leaked: d.leaked } };
    },
    onTimeout: () => ({ type: 'REJECT', payload: { reason: '对家等待超时，收尾退出' } }),
  };
}
