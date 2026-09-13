/**
 * 勋章派生（Badge）—— 维度 × 三档成就系统。
 *
 * 设计稿：docs/specs/2026-09-12-badge-system-design.md §3。
 *
 * 纯函数、零副作用、确定性：输入 = 各维度分数 + 真实证据统计，输出 = 已达成勋章列表。
 * 「每维最多一枚，取最高档」；输出顺序固定为 @acl/core 的 DIMENSIONS 顺序（前后端同源）。
 *
 * 红线：
 * - 只认真实证据（由调用方按 realEvidenceCount 传入；自报/仿真不计数）；
 * - 证据量下限 MIN_BADGE_EVIDENCE（防单条满分骗专家）；
 * - 时效下限（证据过旧不亮，防吃老本）。
 */

import { DIMENSIONS, type Dimension } from '@acl/core';

export type BadgeTier = 'bronze' | 'silver' | 'gold';

export interface Badge {
  dimension: Dimension;
  tier: BadgeTier;
  /** 达成时该维度分（0–100），便于回溯。 */
  score: number;
}

export interface BadgeInput {
  dimension: Dimension;
  /** 该维度分（0–100）；null = 该维无证据。 */
  score: number | null;
  /** 该维度**真实**证据条数（real-benchmark / real / verified）。 */
  realEvidenceCount: number;
  /** 时效因子 0..1（引擎 freshnessFactor）；未提供则不因时效拦截（向后兼容）。 */
  freshnessFactor?: number;
}

/**
 * 各维度三档阈值（0–100）。**校准状态：provisional**（按 2026-09-12 真实分分布 P50/P75/P90 锚定）。
 * 正式启用前须跑基线校准，见设计稿 §3.2 / §8。
 */
export const BADGE_THRESHOLDS: Record<Dimension, Record<BadgeTier, number>> = {
  capability: { bronze: 60, silver: 75, gold: 88 },
  reliability: { bronze: 50, silver: 65, gold: 80 },
  delivery: { bronze: 60, silver: 75, gold: 88 },
  economic: { bronze: 70, silver: 85, gold: 93 },
  collaboration: { bronze: 60, silver: 75, gold: 88 },
  security: { bronze: 60, silver: 75, gold: 88 },
  negotiation: { bronze: 60, silver: 75, gold: 88 },
  integrity: { bronze: 65, silver: 80, gold: 90 },
};

/** 发勋章的真实证据量下限（防单条满分骗专家）。 */
export const MIN_BADGE_EVIDENCE = 3;

/** 时效下限：freshnessFactor 低于此值不发（约等于 30 天半衰期下 >30 天的旧证据）。 */
export const BADGE_FRESHNESS_MIN = 0.5;

/** 判定单维达成档位；未达标返回 null。 */
function tierFor(dimension: Dimension, score: number): BadgeTier | null {
  const t = BADGE_THRESHOLDS[dimension];
  if (score >= t.gold) return 'gold';
  if (score >= t.silver) return 'silver';
  if (score >= t.bronze) return 'bronze';
  return null;
}

/**
 * 派生勋章列表：每维最多一枚（最高档），按 DIMENSIONS 固定顺序输出。
 */
export function badgesFor(inputs: readonly BadgeInput[]): Badge[] {
  // 同维多条 → 取分数最高者（并对真实证据数与时效做「任一达标即可」合并：取最宽松的可发条）
  const byDim = new Map<Dimension, BadgeInput[]>();
  for (const inp of inputs) {
    const arr = byDim.get(inp.dimension);
    if (arr) arr.push(inp);
    else byDim.set(inp.dimension, [inp]);
  }

  const out: Badge[] = [];
  for (const dim of DIMENSIONS) {
    const cands = byDim.get(dim);
    if (!cands || cands.length === 0) continue;

    let best: Badge | null = null;
    for (const c of cands) {
      if (c.score === null) continue;
      // 红线：证据量下限 + 时效（未提供 freshnessFactor 则不拦）
      if (c.realEvidenceCount < MIN_BADGE_EVIDENCE) continue;
      if (c.freshnessFactor !== undefined && c.freshnessFactor < BADGE_FRESHNESS_MIN) continue;
      const tier = tierFor(dim, c.score);
      if (!tier) continue;
      const cur = { dimension: dim, tier, score: c.score };
      if (!best || rank(tier) > rank(best.tier) || (tier === best.tier && c.score > best.score)) best = cur;
    }
    if (best) out.push(best);
  }
  return out;
}

function rank(t: BadgeTier): number {
  return t === 'gold' ? 3 : t === 'silver' ? 2 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 口径单处（榜行 / 详情页 / 徽章外链共用）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 真实证据源白名单——勋章/行为榜门槛的唯一口径。
 * simulation（自报/仿真）**永不**计数；real-confidential 为酒馆保密单，计入但不外泄明细。
 */
export const REAL_EVIDENCE_SOURCES = ['real-benchmark', 'real', 'real-confidential'] as const;

/**
 * **有考题覆盖**的维度（v1 suite + exam-v2 题库的维度并集）——用于灰章悬停提示：
 * 未解锁勋章里，哪些维度是**暂无考题**（欢迎贡献），哪些是**已有考题但尚未达标**。
 *
 * 口径单处：本常量与 sealit-sdk 题库映射（v1 `DIMENSION_MAP` + `negotiation` 场景，
 * exam-v2 `EXAM_V2_CASES`）的一致性由 apps/api 的回归测试守卫（scoring 不反向依赖 sdk）。
 * 当前**无考题**的维度：`economic`（仅靠酒馆交易真实证据）、`collaboration`（零证据来源）——
 * 正是 GitHub 贡献指南里最缺的两维。
 */
export const EXAM_COVERED_DIMENSIONS: readonly Dimension[] = [
  'capability',
  'reliability',
  'delivery',
  'security',
  'negotiation',
  'integrity',
];

/** 该维度是否有考题支持（灰章提示分支用）。 */
export function hasExamCoverage(dimension: Dimension): boolean {
  return (EXAM_COVERED_DIMENSIONS as readonly string[]).includes(dimension);
}

/** 时效因子（30 天半衰期，与引擎一致）；null/undefined → undefined（不拦，向后兼容）。 */
export function freshnessFactorFromDays(days: number | null | undefined): number | undefined {
  return days == null ? undefined : Math.pow(0.5, days / 30);
}

/** 按维度归集真实证据条数（输入须已过滤为 REAL_EVIDENCE_SOURCES）。 */
export function realEvidenceCounts(
  rows: readonly { dimension: string }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.dimension, (m.get(r.dimension) ?? 0) + 1);
  return m;
}

/**
 * 维度分 + 真实证据计数 + 时效 → 勋章（服务端权威派生）。
 * 榜单行与详情页共用同一口径，避免前端各自实现导致漂移。
 */
export function badgesFromDimensions(
  dimensions: readonly { dimension: string; score: number | null }[],
  realCounts: ReadonlyMap<string, number>,
  freshnessDays: number | null | undefined,
): Badge[] {
  const f = freshnessFactorFromDays(freshnessDays);
  const byDim = new Map(dimensions.map((d) => [d.dimension, d.score]));
  return badgesFor(
    DIMENSIONS.map((dim) => ({
      dimension: dim,
      score: byDim.get(dim) ?? null,
      realEvidenceCount: realCounts.get(dim) ?? 0,
      ...(f !== undefined ? { freshnessFactor: f } : {}),
    })),
  );
}
