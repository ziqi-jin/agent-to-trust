import { buildSamples, findCase, type BuiltSample } from './samples/builder.js';
import type { Judge } from './judges/types.js';
import type { Verdict } from './types.js';

export interface SampleResult {
  caseId: string;
  label: Verdict;
  judge: string;
  predicted: Verdict | 'error';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

/** 并行跑：样本 × 判官。单条失败不打断整体。 */
export async function runHarness(judges: Judge[], samples: BuiltSample[] = buildSamples()): Promise<SampleResult[]> {
  const jobs: Promise<SampleResult>[] = [];
  for (const s of samples) {
    const c = findCase(s.caseId);
    for (const j of judges) {
      jobs.push(
        (async (): Promise<SampleResult> => {
          const base = { caseId: s.caseId, label: s.label, judge: j.name };
          if (!c)
            return {
              ...base,
              predicted: 'error',
              latencyMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              error: 'case not found',
            };
          try {
            const v = await j.grade(c, s.output);
            return {
              ...base,
              predicted: v.result,
              latencyMs: v.latencyMs ?? 0,
              inputTokens: v.inputTokens ?? 0,
              outputTokens: v.outputTokens ?? 0,
            };
          } catch (e) {
            return {
              ...base,
              predicted: 'error',
              latencyMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              error: (e as Error).message,
            };
          }
        })(),
      );
    }
  }
  return Promise.all(jobs);
}
