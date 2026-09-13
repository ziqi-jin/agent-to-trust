/**
 * 考题覆盖维度口径一致性 —— 2026-09-13 老大拍板 C。
 *
 * 灰章悬停提示依赖 `@acl/scoring` 的 `EXAM_COVERED_DIMENSIONS`（「该维度有无考题」）。
 * 但该常量的**真源**在 sealit-sdk 题库（v1 `DIMENSION_MAP` + negotiation 场景，exam-v2 `EXAM_V2_CASES`）。
 * scoring 不能反向依赖 sdk（依赖方向），故用本测试守卫两者一致：
 * 谁加了新考题维度、忘了同步常量 → 这里红。
 *
 * 无 DB 依赖（纯静态映射）。
 */

import { describe, expect, it } from 'vitest';
import { DIMENSIONS } from '@acl/core';
import { EXAM_COVERED_DIMENSIONS, hasExamCoverage } from '@acl/scoring';
import { DIMENSION_MAP, EXAM_V2_CASES } from 'sealit-sdk';

describe('考题覆盖维度口径一致性（scoring 常量 ⇄ sdk 题库）', () => {
  it('EXAM_COVERED_DIMENSIONS == v1 映射 + negotiation 场景 + exam-v2 题库的并集', () => {
    const union = new Set<string>(Object.values(DIMENSION_MAP));
    union.add('negotiation'); // v1 的 3 道谈判题（counterpart/scenarios）
    for (const c of EXAM_V2_CASES) union.add(c.dimension);
    expect([...EXAM_COVERED_DIMENSIONS].sort()).toEqual([...union].sort());
  });

  it('economic / collaboration 当前无考题（缺口清单事实，供贡献指南引用）', () => {
    expect(hasExamCoverage('economic')).toBe(false);
    expect(hasExamCoverage('collaboration')).toBe(false);
  });

  it('常量每项都是合法维度，且不重复', () => {
    for (const d of EXAM_COVERED_DIMENSIONS) expect(DIMENSIONS).toContain(d);
    expect(new Set(EXAM_COVERED_DIMENSIONS).size).toBe(EXAM_COVERED_DIMENSIONS.length);
  });
});
