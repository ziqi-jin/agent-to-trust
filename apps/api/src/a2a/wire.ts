/**
 * 事件翻译 wire（纯函数）：内核 7 事件 ↔ A2A 消息的翻译防腐层（spec §3.2 / §3.4）。
 *
 * 出站 `toA2aMessage`：把内核事件变成给用户 agent 的**自包含文本**（带最近历史摘要，
 *   无状态 agent 也能接）+ 结构化 `metadata.acl = { sessionId, round, deadlineMs }`。
 * 入站 `fromParsedAction`：把 `parseA2aAction` 的结果归一化成内核事件载荷（T2 已判定的动作）。
 * 入站 `normalizeArtifact`：从 A2A parts 里找 `name:'delivery'` 的 artifact，**归一化 + 校验值域/字段**。
 *
 * 内核零改动——本模块只做翻译，不碰 DB、不碰网络、无副作用。
 *
 * 裁决（Ruling 1）：T2 `parseA2aAction` 只做轻量提取（不校验 artifactKind 值域）；
 *   真正归一化 + 值域/字段校验统一在 T5 `normalizeArtifact`——未知 kind / 坏 sha256 / 缺 uri&inline
 *   一律挡回 `null`。
 */

import type { A2aPart } from './client.js';
import type { ArtifactKind, DeliveryArtifact, ParsedAction } from './actions.js';

export type { DeliveryArtifact } from './actions.js';

/** 内核事件（宽松建模：够拼文本 + metadata 即可，不追内核全貌）。 */
export interface KernelEvent {
  type: string;
  payload?: any;
  sessionId?: string;
  seq?: number;
}

/** 默认回合截止（毫秒）。 */
export const DEFAULT_DEADLINE_MS = 60_000;

/** 历史摘要最多带多少条（自包含但不臃肿）。 */
const HISTORY_SUMMARY_LIMIT = 5;

const ARTIFACT_KINDS: readonly ArtifactKind[] = ['patch', 'file', 'output', 'text'];
const SHA256_RE = /^[0-9a-f]{64}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

// ——————————————————— 出站：内核事件 → 文本 + metadata ———————————————————

/** 取事件里的报价（OFFER/NEGOTIATE 用），没有则 undefined。 */
function priceOf(e: KernelEvent): number | undefined {
  const p = e.payload;
  if (isRecord(p) && typeof p.price === 'number' && Number.isFinite(p.price)) return p.price;
  return undefined;
}

/**
 * 单事件的简短措辞（用于正文与历史摘要）。
 * 覆盖 kernel 7 事件：五动作有明确文案，VERIFY_RESULT/SETTLE 有兜底，未知 type 也兜底。
 */
function describeEvent(e: KernelEvent): string {
  const price = priceOf(e);
  switch (e.type) {
    case 'OFFER':
      return price === undefined ? '报价' : `报价 ${price}`;
    case 'NEGOTIATE':
      return price === undefined ? '还价磋商' : `还价 ${price}`;
    case 'ACCEPT':
      return '接受成交';
    case 'REJECT':
      return '拒绝';
    case 'DELIVER':
      return '交付产物';
    case 'VERIFY_RESULT':
      return '交付核验结果';
    case 'SETTLE':
      return '本局结算完成';
    default:
      return `事件 ${e.type}`;
  }
}

/** 最近历史摘要（`第N轮 <措辞>`，取末尾若干条，按 seq 稳定展示）。 */
function summarizeHistory(history: KernelEvent[]): string {
  if (history.length === 0) return '';
  const recent = history.slice(-HISTORY_SUMMARY_LIMIT);
  return recent
    .map((e, i) => {
      const round = typeof e.seq === 'number' && Number.isFinite(e.seq) ? e.seq : i + 1;
      return `第${round}轮 ${describeEvent(e)}`;
    })
    .join('；');
}

/** round 规则：优先事件自带 seq；缺省用「历史计数 + 1」兜底（稳定、可测）。 */
function roundOf(event: KernelEvent, history: KernelEvent[]): number {
  if (typeof event.seq === 'number' && Number.isFinite(event.seq) && event.seq > 0) return event.seq;
  return history.length + 1;
}

/**
 * 内核事件 → 给用户 agent 的自包含 A2A 消息。
 *
 * `parts[0].text` 形态：`[第N轮] 对家 <措辞>（历史：…）请回复 OFFER / NEGOTIATE / ACCEPT / REJECT / DELIVER。`
 * 历史为空时省略「（历史：…）」，保证文本仍自洽。
 */
export function toA2aMessage(
  event: KernelEvent,
  history: KernelEvent[] = [],
): { text: string; metadata: { acl: { sessionId: string; round: number; deadlineMs: number } } } {
  const round = roundOf(event, history);
  const summary = summarizeHistory(history);
  const body = `[第${round}轮] 对家 ${describeEvent(event)}`;
  const historyPart = summary === '' ? '' : `（历史：${summary}）`;
  const ask = '请回复 OFFER / NEGOTIATE / ACCEPT / REJECT / DELIVER。';

  return {
    text: `${body}${historyPart}${ask}`,
    metadata: {
      acl: {
        sessionId: event.sessionId ?? '',
        round,
        deadlineMs: DEFAULT_DEADLINE_MS,
      },
    },
  };
}

// ——————————————————— 入站：ParsedAction → 内核事件载荷 ———————————————————

/**
 * T2 解析结果 → 内核事件载荷。
 * `ok:false` → `null`（调用方据此计 `invalid_rounds`）；`ok:true` → 五动作各自映射。
 */
export function fromParsedAction(a: ParsedAction): { type: string; payload: object } | null {
  if (!a || a.ok !== true) return null;
  switch (a.type) {
    case 'OFFER':
      return { type: 'OFFER', payload: { price: a.price } };
    case 'NEGOTIATE':
      return { type: 'NEGOTIATE', payload: { price: a.price, note: a.note } };
    case 'ACCEPT':
      return { type: 'ACCEPT', payload: {} };
    case 'REJECT':
      return { type: 'REJECT', payload: { reason: a.note } };
    case 'DELIVER':
      return { type: 'DELIVER', payload: { artifact: a.artifact } };
    default:
      return null;
  }
}

// ——————————————————— 入站：artifact 归一化 + 校验（Ruling 1） ———————————————————

/** 从 artifact part 里取它的 data 对象（直接 `part.data` 或嵌套 `part.parts[*].data`）。 */
function extractData(part: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(part.data)) return part.data;
  if (Array.isArray(part.parts)) {
    for (const sub of part.parts) {
      if (isRecord(sub) && isRecord(sub.data)) return sub.data;
    }
  }
  return null;
}

/** 递归找第一个 `name:'delivery'` 的 artifact，返回其 data 对象。 */
function findDeliveryData(parts: unknown[]): Record<string, unknown> | null {
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.name === 'delivery') {
      const data = extractData(part);
      if (data) return data;
    }
    if (Array.isArray(part.parts)) {
      const nested = findDeliveryData(part.parts);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * 把用户 agent 回复 parts 里的 `name:'delivery'` artifact 归一化成 `DeliveryArtifact`。
 * 校验（Ruling 1，T2 放行的脏 artifact 在此挡回）：
 *  - `artifactKind` 必须存在且属值域 `patch|file|output|text`；
 *  - `sha256` 若存在必须是 64 位 hex；
 *  - `uri` / `inline` 至少一个为非空字符串（且若给出必须是字符串）。
 * 任一不满足 → `null`；找不到 delivery artifact → `null`。
 */
export function normalizeArtifact(parts: A2aPart[]): DeliveryArtifact | null {
  const data = findDeliveryData(parts as unknown[]);
  if (!data) return null;

  const kind = data.artifactKind;
  if (typeof kind !== 'string' || !ARTIFACT_KINDS.includes(kind as ArtifactKind)) return null;

  const out: DeliveryArtifact = { artifactKind: kind as ArtifactKind };

  if (data.sha256 !== undefined) {
    if (typeof data.sha256 !== 'string' || !SHA256_RE.test(data.sha256)) return null;
    out.sha256 = data.sha256;
  }

  const hasUri = isNonEmptyString(data.uri);
  const hasInline = isNonEmptyString(data.inline);
  // 给出了字段但类型/空值不合法（且不是「未提供」）→ 挡回
  if (data.uri !== undefined && !isNonEmptyString(data.uri)) return null;
  if (data.inline !== undefined && !isNonEmptyString(data.inline)) return null;
  if (!hasUri && !hasInline) return null;

  if (hasUri) out.uri = data.uri as string;
  if (hasInline) out.inline = data.inline as string;
  if (typeof data.note === 'string') out.note = data.note;

  return out;
}
