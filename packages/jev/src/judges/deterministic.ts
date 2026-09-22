import type { BenchmarkCase } from 'agent-to-trust';
import type { Judge } from './types.js';

/** 把 SDK 现有确定性 grader 包装成 Judge。 */
export function createDeterministicJudge(): Judge {
  return {
    name: 'deterministic',
    async grade(c: BenchmarkCase, output: string) {
      const g = c.grade(output);
      return { result: g.result, value: g.value, raw: g };
    },
  };
}
