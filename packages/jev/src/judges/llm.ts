import type { BenchmarkCase } from 'agent-to-trust';
import type { DeepSeekClient } from '@a2t/adapters';
import type { Judge } from './types.js';
import type { Verdict } from '../types.js';

const SYSTEM = 'You are a strict grader. Reply with exactly one word: success, partial, or failure.';

/** 解析 LLM 文本回复为三档（保守：无法识别判 failure）。 */
export function parseVerdict(text: string): Verdict {
  const n = text.toLowerCase();
  if (n.includes('partial')) return 'partial';
  if (n.includes('success')) return 'success';
  if (n.includes('failure') || n.includes('fail') || n.includes('wrong') || n.includes('incorrect')) return 'failure';
  return 'failure';
}

function toValue(v: Verdict): number {
  return v === 'success' ? 1 : v === 'partial' ? 0.5 : 0;
}

/** 把 DeepSeek（OpenAI 兼容）客户端包装成 Judge。 */
export function createLlmJudge(client: DeepSeekClient, model: string, now: () => number = () => Date.now()): Judge {
  return {
    name: 'llm',
    async grade(c: BenchmarkCase, output: string) {
      const started = now();
      const r = await client.chat(
        [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Task:\n${c.prompt}\n\nAgent output:\n${output}\n\nGrade it: success (fully correct), partial (partly correct), failure (wrong).`,
          },
        ],
        { model, temperature: 0, maxTokens: 8 },
      );
      const latencyMs = now() - started;
      const v = parseVerdict(r.content);
      return {
        result: v,
        value: toValue(v),
        raw: r.content,
        latencyMs,
        inputTokens: r.usage.promptTokens,
        outputTokens: r.usage.completionTokens,
      };
    },
  };
}
