/**
 * @acl/simulator — Market Engine（撮合引擎）。
 *
 * 阶段：DISCOVERY（发现能力匹配者）→ OFFER（报价）→ ACCEPT（按策略选中并形成 contract）。
 * 这是 P0-6 调度器里内嵌撮合逻辑的独立抽取，供 P0-7 验收「Agent 能找到服务并成交」。
 */
import type { Rng } from './rng';
import type { AcceptanceStrategy, Contract, Offer, OfferStrategy, SimAgent, SimTask } from './types';

/** 纯函数：从报价集合按策略选出一个，空集合返回 null。 */
export function selectOffer(
  offers: Offer[],
  strategy: AcceptanceStrategy,
  rng: Rng,
): Offer | null {
  if (offers.length === 0) return null;
  switch (strategy) {
    case 'random':
      return rng.pick(offers);
    case 'lowest-latency':
      return offers.reduce((a, b) => (a.latency <= b.latency ? a : b));
    case 'lowest-price':
    default:
      return offers.reduce((a, b) => (a.price <= b.price ? a : b));
  }
}

/** 纯函数：按报价策略计算价格（基于任务预算）。 */
export function priceFor(strategy: OfferStrategy, budget: number, rng: Rng): number {
  switch (strategy) {
    case 'undercut':
      // 恶意压价：低于市场价（55%–85% 预算），抢单/刷单动机
      return Math.round(budget * (0.55 + 0.3 * rng.float()));
    case 'premium':
      // 高溢价：高于市场价（115%–145% 预算）
      return Math.round(budget * (1.15 + 0.3 * rng.float()));
    case 'market':
    default:
      // 正常市场价（85%–115% 预算）
      return Math.round(budget * (0.85 + 0.3 * rng.float()));
  }
}

/** 有状态撮合引擎：持有 rng + 合约序号，保证同 seed 同序列、合约 id 唯一递增。 */
export class MarketEngine {
  private rng: Rng;
  private contractSeq = 0;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  /** DISCOVERY：能力匹配 task.domain 且非 buyer 的候选 provider。 */
  discover(task: SimTask, agents: SimAgent[], buyerId: string): SimAgent[] {
    return agents.filter((a) => a.id !== buyerId && a.capabilities.includes(task.domain));
  }

  /** OFFER：单个 agent 报价（按报价策略定价）+ 时延（技能越高时延越低）。 */
  offer(task: SimTask, agent: SimAgent): Offer {
    return {
      taskId: task.id,
      agentId: agent.id,
      price: priceFor(agent.offerStrategy ?? 'market', task.budget, this.rng),
      latency: Math.round(1 + (1 - agent.skill) * 10),
    };
  }

  /** OFFER：候选批量报价。 */
  offerAll(task: SimTask, candidates: SimAgent[]): Offer[] {
    return candidates.map((a) => this.offer(task, a));
  }

  /** ACCEPT：按策略选中报价并形成 contract（status=accepted）。 */
  accept(
    task: SimTask,
    buyerId: string,
    offers: Offer[],
    strategy: AcceptanceStrategy = 'lowest-price',
    now?: Date,
  ): Contract | null {
    const best = selectOffer(offers, strategy, this.rng);
    if (!best) return null;
    const ts = now ?? new Date(0);
    return {
      id: `contract-${String(++this.contractSeq).padStart(4, '0')}`,
      taskId: task.id,
      buyerId,
      providerId: best.agentId,
      price: best.price,
      latency: best.latency,
      status: 'accepted',
      createdAt: ts,
      acceptedAt: ts,
    };
  }
}
