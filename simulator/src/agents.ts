/**
 * @acl/simulator — Agent 池。
 *
 * 生成一批仿真 Agent，每个带行为参数（skill/reliability/honesty）+ 随机能力集 + 初始钱包。
 * 参数由确定性 rng 派生，保证同 seed 同 Agent 池。
 */
import { round2, type Rng } from './rng';
import { DOMAINS, type AcceptanceStrategy, type Domain, type OfferStrategy, type SimAgent } from './types';

/** 报价策略池：模拟真实市场里不同定价风格。 */
export const OFFER_STRATEGIES: readonly OfferStrategy[] = ['market', 'undercut', 'premium'];

/** 接单策略池。 */
export const ACCEPT_STRATEGIES: readonly AcceptanceStrategy[] = ['lowest-price', 'lowest-latency', 'random'];

export function generateAgents(count: number, rng: Rng, initialWallet: number): SimAgent[] {
  const agents: SimAgent[] = [];
  for (let i = 0; i < count; i++) {
    const capCount = rng.int(1, 3);
    const caps = new Set<Domain>();
    while (caps.size < capCount) {
      caps.add(rng.pick(DOMAINS));
    }
    agents.push({
      id: `sim-agent-${String(i + 1).padStart(4, '0')}`,
      name: `sim-agent-${i + 1}`,
      capabilities: [...caps],
      skill: round2(rng.range(0.3, 0.95)),
      reliability: round2(rng.range(0.3, 0.95)),
      honesty: round2(rng.range(0.3, 0.95)),
      wallet: initialWallet,
      // 决策风格：随机分配报价/接单策略，模拟不同个体
      offerStrategy: rng.pick(OFFER_STRATEGIES),
      acceptStrategy: rng.pick(ACCEPT_STRATEGIES),
    });
  }
  return agents;
}
