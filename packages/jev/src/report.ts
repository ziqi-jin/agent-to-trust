import type { SampleResult } from './harness.js';
import type { Verdict } from './types.js';

/** Jev 输入价（USD / 百万 token），2026-09 官方口径。 */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

export interface JudgeMetrics {
  judge: string;
  total: number;
  correct: number;
  errors: number;
  accuracy: number;
  avgLatencyMs: number;
  inputTokens: number;
  estCostUsd: number;
  confusion: Record<string, Record<string, number>>;
}

export interface Report {
  generatedAt: string;
  jevModel: string;
  samples: number;
  judges: JudgeMetrics[];
}

export function buildReport(
  results: SampleResult[],
  meta: { generatedAt: string; jevModel: string; samples?: number },
): Report {
  const names = [...new Set(results.map((r) => r.judge))].sort();
  const judges: JudgeMetrics[] = names.map((judge) => {
    const rows = results.filter((r) => r.judge === judge);
    const errors = rows.filter((r) => r.predicted === 'error').length;
    const usable = rows.filter((r) => r.predicted !== 'error');
    const correct = usable.filter((r) => r.predicted === r.label).length;
    const confusion: Record<string, Record<string, number>> = {};
    for (const r of usable) {
      confusion[r.label] ??= {};
      confusion[r.label][r.predicted] = (confusion[r.label][r.predicted] ?? 0) + 1;
    }
    const totalLatency = rows.reduce((a, r) => a + r.latencyMs, 0);
    const inputTokens = rows.reduce((a, r) => a + r.inputTokens, 0);
    return {
      judge,
      total: rows.length,
      correct,
      errors,
      accuracy: usable.length ? Math.round((correct / usable.length) * 1000) / 1000 : 0,
      avgLatencyMs: rows.length ? Math.round(totalLatency / rows.length) : 0,
      inputTokens,
      estCostUsd: Math.round((inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK * 1e6) / 1e6,
      confusion,
    };
  });
  return {
    generatedAt: meta.generatedAt,
    jevModel: meta.jevModel,
    samples: meta.samples ?? new Set(results.map((r) => `${r.caseId}|${r.predicted}|${r.label}`)).size,
    judges,
  };
}

const VERDICTS: Verdict[] = ['success', 'partial', 'failure'];

export function renderMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push('# Jev Judge Cross-Check — 实验报告', '');
  lines.push(`> 模型：\`${r.jevModel}\` · 生成时间：${r.generatedAt} · 样本组：${r.samples}`, '');
  lines.push('> 红线：这是「可复现的标定实验」，不是科学基准；样本为构造法（金标签由构造决定）。', '');
  lines.push('## 总览', '');
  lines.push('| 判官 | 准确率 | 正确/可用 | 错误 | 平均延迟(ms) | 输入token | 估算成本(USD) |');
  lines.push('|------|--------|-----------|------|--------------|-----------|----------------|');
  for (const j of r.judges) {
    lines.push(
      `| ${j.judge} | ${(j.accuracy * 100).toFixed(1)}% | ${j.correct}/${j.total - j.errors} | ${j.errors} | ${j.avgLatencyMs} | ${j.inputTokens} | ${j.estCostUsd} |`,
    );
  }
  lines.push('', '## 混淆矩阵（行=金标签，列=预测）', '');
  for (const j of r.judges) {
    lines.push(`### ${j.judge}`, '');
    lines.push(`| 金标签 \\ 预测 | ${VERDICTS.join(' | ')} |`);
    lines.push('|---|---|---|---|');
    for (const label of VERDICTS) {
      const row = VERDICTS.map((p) => j.confusion[label]?.[p] ?? 0);
      lines.push(`| ${label} | ${row.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## 复现', '', '```bash', 'TYPESAFE_API_KEY=... DEEPSEEK_API_KEY=... npm run jev:crosscheck --workspace @a2t/jev -- --live', '```', '');
  return lines.join('\n');
}

export function renderWebsiteJson(r: Report): string {
  return JSON.stringify(r, null, 2) + '\n';
}
