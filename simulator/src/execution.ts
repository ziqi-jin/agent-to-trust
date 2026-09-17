/**
 * @a2t/simulator — Execution Engine（履约引擎）。
 *
 * 把一个已接受的 contract 推进到结算，状态机：
 * EXECUTE（履约）→ DELIVER（交付）→ VERIFY（验证）→ SETTLE（结算）。
 *
 * 核心理念「Don't trust an Agent. Test it.」：
 * 信用来自「验证后的实测表现」，而非 Agent 自报的技能。
 * 作弊者会在 DELIVER 阶段谎报质量，但 VERIFY 有概率识破（CHEAT_CAUGHT_RATE）。
 */
import type { EvidenceResult } from '@a2t/core';
import { round2, type Rng } from './rng';
import type {
  Contract,
  Deliverable,
  ExecutionOutcome,
  Settlement,
  SimAgent,
  SimTask,
  Verification,
} from './types';

/** 作弊被识破的概率。 */
export const CHEAT_CAUGHT_RATE = 0.7;

export class ExecutionEngine {
  constructor(private rng: Rng) {}

  /** EXECUTE：provider 履约，产出实际质量 / 是否准时 / 是否作弊。 */
  execute(contract: Contract, provider: SimAgent): ExecutionOutcome {
    const onTime = this.rng.chance(provider.reliability);
    const cheated = this.rng.chance(1 - provider.honesty);
    return {
      contractId: contract.id,
      providerId: provider.id,
      actualQuality: round2(provider.skill),
      onTime,
      cheated,
    };
  }

  /** DELIVER：提交交付物，作弊者把质量虚报成满分。 */
  deliver(contract: Contract, outcome: ExecutionOutcome): Deliverable {
    return {
      contractId: contract.id,
      providerId: outcome.providerId,
      claimedQuality: outcome.cheated ? 1 : outcome.actualQuality,
      onTime: outcome.onTime,
      cheated: outcome.cheated,
    };
  }

  /** VERIFY：实测交付物，得出最终判定。识破作弊则按真实质量计为 failure。 */
  verify(
    contract: Contract,
    outcome: ExecutionOutcome,
    deliverable: Deliverable,
    task: SimTask,
  ): Verification {
    const caughtCheating = outcome.cheated && this.rng.chance(CHEAT_CAUGHT_RATE);
    // 识破 → 按真实质量；未识破 → 信任声称值
    const measuredQuality = caughtCheating ? outcome.actualQuality : deliverable.claimedQuality;
    const competent = measuredQuality >= task.complexity;

    let result: EvidenceResult;
    if (caughtCheating) result = 'failure';
    else if (competent && outcome.onTime) result = 'success';
    else if (competent && !outcome.onTime) result = 'partial';
    else result = 'failure';

    return {
      contractId: contract.id,
      providerId: outcome.providerId,
      measuredQuality: round2(measuredQuality),
      caughtCheating,
      result,
    };
  }

  /** SETTLE：按验证结果计算实际支付金额（success 全款 / partial 半款 / failure 0）。 */
  settle(contract: Contract, verification: Verification): Settlement {
    let amount = 0;
    if (verification.result === 'success') amount = contract.price;
    else if (verification.result === 'partial') amount = Math.round(contract.price / 2);
    return { contractId: contract.id, amount, result: verification.result };
  }
}
