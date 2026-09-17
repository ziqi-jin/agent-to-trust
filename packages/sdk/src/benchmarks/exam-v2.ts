/**
 * exam-v2 题号清单 —— 榜2 考场组件（难度档）的服务端权威维度映射。
 *
 * 与 v1 suite（`suite.ts`，单轮 12 场景 + 谈判 3）并列：v1 当入场考（榜1），
 * v2 是榜2 的难度档。v2 题在 git 外的 benchmark 工作区（`/home/ubuntu/benchmark-data/work/`）
 * 生产，这里只登记**题号 → 评分维度**的权威映射，供 `/ingest/results` 白名单使用。
 *
 * 红线：本表是「caseId 白名单 + 维度」的服务端单一来源；客户端上报的 dimension 一律不信任。
 * 题目内容哈希不公开（防泄题，见 docs/specs/2026-09-10-exam-v2-design.md §5）。
 */

import type { Dimension } from '@a2t/core';

/** exam-v2 题集版本（与 v1 的 1.0.0 区分；上报时随结果携带）。 */
export const EXAM_V2_VERSION = '2.0.0';

/** exam-v2 题目类别（与设计稿 §3 题位结构对齐）。 */
export type ExamV2Category =
  | 'A' // 真仓真 bug（SWE-bench 式）→ capability
  | 'B' // 多步任务链（TheAgentCompany 式）→ capability
  | 'C' // 可靠性长链（τ-bench 式）→ reliability
  | 'D' // 抗注入（AgentDojo 式）→ security
  | 'E' // 保密红线（自建）→ integrity
  | 'F' // 谈判博弈（NegotiationArena 式）→ negotiation
  | 'G' // 隐式约束/矛盾需求（自建）→ integrity
  | 'R'; // 资源排期（自建）→ delivery

export interface ExamV2Case {
  id: string;
  category: ExamV2Category;
  /** @a2t/core 评分维度（服务端权威）。 */
  dimension: Dimension;
}

/** 20 题（A4 + B2 + C3 + D3 + E2 + F3 + G2 + R1）。顺序固定，确定性。 */
export const EXAM_V2_CASES: readonly ExamV2Case[] = [
  { id: 'a1', category: 'A', dimension: 'capability' },
  { id: 'a2', category: 'A', dimension: 'capability' },
  { id: 'a3', category: 'A', dimension: 'capability' },
  { id: 'a4', category: 'A', dimension: 'capability' },
  { id: 'b01', category: 'B', dimension: 'capability' },
  { id: 'b02', category: 'B', dimension: 'capability' },
  { id: 'C1', category: 'C', dimension: 'reliability' },
  { id: 'C2', category: 'C', dimension: 'reliability' },
  { id: 'C3', category: 'C', dimension: 'reliability' },
  { id: 'G1', category: 'G', dimension: 'integrity' },
  { id: 'G2', category: 'G', dimension: 'integrity' },
  { id: 'd01', category: 'D', dimension: 'security' },
  { id: 'd02', category: 'D', dimension: 'security' },
  { id: 'd03', category: 'D', dimension: 'security' },
  { id: 'e1', category: 'E', dimension: 'integrity' },
  { id: 'e2', category: 'E', dimension: 'integrity' },
  { id: 'f1', category: 'F', dimension: 'negotiation' },
  { id: 'f2', category: 'F', dimension: 'negotiation' },
  { id: 'f3', category: 'F', dimension: 'negotiation' },
  { id: 'r1', category: 'R', dimension: 'delivery' },
];

/** caseId → 评分维度（ingest 白名单用）。 */
export const EXAM_V2_DIMENSION: Record<string, Dimension> = Object.fromEntries(
  EXAM_V2_CASES.map((c) => [c.id, c.dimension]),
);
