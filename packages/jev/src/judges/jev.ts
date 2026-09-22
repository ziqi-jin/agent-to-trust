import type { BenchmarkCase } from 'agent-to-trust';
import type { JevClient } from '../client.js';
import type { Judge } from './types.js';
import type { Verdict } from '../types.js';

export const JEV_GRADE_CRITERIA: Record<string, string> = {
  success: 'The agent output fully and correctly satisfies the task.',
  partial: 'The agent output is partly correct but incomplete or has minor errors.',
  failure: 'The agent output is wrong, irrelevant, or does not satisfy the task.',
};

function toVerdict(choice: string): Verdict {
  return choice === 'success' || choice === 'partial' || choice === 'failure' ? choice : 'failure';
}
function toValue(v: Verdict): number {
  return v === 'success' ? 1 : v === 'partial' ? 0.5 : 0;
}

/** 把 Jev 决策模型包装成 Judge（single choice 问题 → 三档）。 */
export function createJevJudge(client: JevClient): Judge {
  return {
    name: 'jev',
    async grade(c: BenchmarkCase, output: string) {
      const { response, latencyMs, inputTokens, outputTokens } = await client.systemOne(
        `Task:\n${c.prompt}\n\nAgent output:\n${output}`,
        {
          grade: {
            type: 'choice',
            instructions: 'How well does the agent output satisfy the task?',
            criteria: JEV_GRADE_CRITERIA,
          },
        },
      );
      const a = response.answers.grade;
      const choice = a && a.type === 'choice' ? a.choice : 'failure';
      const v = toVerdict(choice);
      return { result: v, value: toValue(v), raw: a, latencyMs, inputTokens, outputTokens };
    },
  };
}
