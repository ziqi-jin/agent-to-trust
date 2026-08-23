/**
 * @acl/simulator — 任务生成器。
 *
 * 每个 round 生成一个仿真任务：随机领域 + 复杂度 + 预算 + 截止轮次。
 */
import { round2, type Rng } from './rng';
import { DOMAINS, type SimTask } from './types';

export function generateTask(round: number, rng: Rng): SimTask {
  return {
    id: `task-${String(round + 1).padStart(4, '0')}`,
    domain: rng.pick(DOMAINS),
    complexity: round2(rng.range(0.2, 0.9)),
    budget: Math.round(rng.range(50, 500)),
    deadlineRound: round + rng.int(1, 3),
  };
}
