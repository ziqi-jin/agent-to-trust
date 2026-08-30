/**
 * 确定性 grader 工具集。
 *
 * 红线：grader 是启发式而非科学验证；必须确定性（同输入同输出），
 * 中英文关键词都覆盖（用户 agent 可能用任一语言回答）。
 */

/** 归一化：去多余空白、小写、trim。 */
export function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 包含任一关键词（大小写不敏感）。 */
export function containsAny(output: string, needles: string[]): boolean {
  const n = norm(output);
  return needles.some((k) => n.includes(k.toLowerCase()));
}

/** 包含全部关键词。 */
export function containsAll(output: string, needles: string[]): boolean {
  const n = norm(output);
  return needles.every((k) => n.includes(k.toLowerCase()));
}

/** 提取第一个数字（容忍千分位逗号；剥离版本号样 token——CLI agent 的 stdout 常带版本 banner，版本号永远不是答案）。 */
export function extractNumber(output: string): number | null {
  const cleaned = output
    .replace(/,/g, '')
    .replace(/\bv\d+(\.\d+)+\b/g, ' ')
    .replace(/\b\d+(\.\d+){2,}\b/g, ' ');
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 输出中的第一个数字落在 [lo, hi]。 */
export function numberInRange(output: string, lo: number, hi: number): boolean {
  const n = extractNumber(output);
  return n !== null && n >= lo && n <= hi;
}

/** 保留两位小数。 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 组合评分：检查项等权重，≥0.6 success，>0 partial，否则 failure。 */
export function checklist(
  checks: { name: string; ok: boolean }[],
): { value: number; result: 'success' | 'partial' | 'failure' } {
  const pass = checks.filter((c) => c.ok).length;
  const value = Math.round((pass / checks.length) * 100) / 100;
  const result = value >= 0.6 ? 'success' : value > 0 ? 'partial' : 'failure';
  return { value, result };
}
