import { describe, expect, it } from 'vitest';
import { buildReport, renderMarkdown, renderWebsiteJson } from '../src/report.js';
import type { SampleResult } from '../src/harness.js';

const results: SampleResult[] = [
  { caseId: 'coding-sum', label: 'success', judge: 'deterministic', predicted: 'success', latencyMs: 0, inputTokens: 0, outputTokens: 0 },
  { caseId: 'coding-sum', label: 'failure', judge: 'deterministic', predicted: 'success', latencyMs: 0, inputTokens: 0, outputTokens: 0 },
  { caseId: 'coding-sum', label: 'success', judge: 'jev', predicted: 'success', latencyMs: 400, inputTokens: 150, outputTokens: 5 },
  { caseId: 'coding-sum', label: 'failure', judge: 'jev', predicted: 'failure', latencyMs: 380, inputTokens: 140, outputTokens: 5 },
];

const meta = { generatedAt: '2026-09-22T00:00:00.000Z', jevModel: 'jev-1.13.0' };

describe('report', () => {
  it('buildReport 计算准确率与混淆矩阵', () => {
    const r = buildReport(results, meta);
    const det = r.judges.find((j) => j.judge === 'deterministic')!;
    const jev = r.judges.find((j) => j.judge === 'jev')!;
    expect(det.correct).toBe(1);
    expect(jev.accuracy).toBe(1);
    expect(det.confusion.failure.success).toBe(1);
  });

  it('renderMarkdown 确定性（同输入同输出）', () => {
    const r = buildReport(results, meta);
    expect(renderMarkdown(r)).toBe(renderMarkdown(r));
    expect(renderMarkdown(r)).toContain('jev-1.13.0');
  });

  it('renderWebsiteJson 可解析且确定性', () => {
    const r = buildReport(results, meta);
    const a = renderWebsiteJson(r);
    expect(a).toBe(renderWebsiteJson(r));
    expect(JSON.parse(a).jevModel).toBe('jev-1.13.0');
  });
});
