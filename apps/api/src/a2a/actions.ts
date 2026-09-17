/**
 * A2A 动作解析器（纯函数）。
 *
 * 职责：把用户 agent 的 A2A 回复解析成内核 7 事件里的一个动作
 * （OFFER / NEGOTIATE / ACCEPT / REJECT / DELIVER），供双向桥调用。
 *
 * 设计裁决（spec §3.3）：
 *  1. 结构化优先：只要存在合法 `a2tAction`，就用它，忽略文本档。
 *  2. 文本兜底：解析不出 → ok:false（无效回合），绝不猜测。
 *  3. 归一只做轻量提取：artifact 只需「是对象 + 有 artifactKind 字段」，不校验取值。
 *     sha256 校验 / 深度归一化 / 值域归一是 `normalizeArtifact`（Task 5）的职责。
 *  4. 文本档否定守卫（评审 T2 二轮裁决）：**只守 ACCEPT**。触发词若被同句内前置的否定词否定，
 *     则该次出现失效，宁可记无效回合，也不把「不接受」「not accept」误判成 ACCEPT（spec §3.3「不猜测」）。
 *     REJECT 不设守卫（「不干了」是自然拒绝语境）；否定按分句作用域，不做整段扫描。
 *
 * 本模块零依赖：不碰网络、不碰 DB。
 */

export type ArtifactKind = 'patch' | 'file' | 'output' | 'text';

/** DELIVER 产物（spec §3.4）。本模块只做最小结构检查：必须有 artifactKind。 */
export interface DeliveryArtifact {
  artifactKind: ArtifactKind;
  sha256?: string;
  uri?: string;
  inline?: string;
  note?: string;
}

export type A2aActionType = 'OFFER' | 'NEGOTIATE' | 'ACCEPT' | 'REJECT' | 'DELIVER';

export type ParsedAction =
  | { ok: true; type: A2aActionType; price?: number; note?: string; artifact?: DeliveryArtifact }
  | { ok: false; reason: string };

/** 两档并存的入站 parts（已拆分形态）。 */
export interface A2aInbound {
  /** `kind: 'data'` 的 part.data，可能含 `{ a2tAction: {...} }` 或 artifact 候选。 */
  dataParts?: unknown[];
  /** `kind: 'text'` 的 part.text。 */
  textParts?: string[];
  /** DELIVER 用的 artifact part（spec §3.4 的 Artifact，或其内部 data）。 */
  artifactParts?: unknown[];
}

/** 也可以直接喂裸 A2A `parts` 数组。 */
export type A2aParseInput = A2aInbound | { parts: unknown[] };

const ACTION_TYPES: readonly A2aActionType[] = ['OFFER', 'NEGOTIATE', 'ACCEPT', 'REJECT', 'DELIVER'];

// —— 小工具 ——

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 从文本里抽第一个数字（整数/小数），没有则 undefined。 */
function extractPrice(text: string): number | undefined {
  const m = /\d+(?:\.\d+)?/.exec(text);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 最小结构检查：只要求「是对象 + 有 artifactKind 字段（字符串）」，不校验取值。
 * 未知 kind 也放行——值域/归一化是 `normalizeArtifact`（Task 5）的职责，T2 只做轻量类型检查。
 * 返回浅拷贝，避免下游与调用者入参互相别名观察。
 */
function asArtifact(v: unknown): DeliveryArtifact | undefined {
  if (!isRecord(v)) return undefined;
  if (typeof v.artifactKind !== 'string') return undefined;
  return { ...v } as unknown as DeliveryArtifact;
}

/** 从某个 part 里挖出 artifact 候选（覆盖 spec §3.4 的 Artifact 包一层 parts 的形态）。 */
function pickArtifact(part: unknown): DeliveryArtifact | undefined {
  if (!isRecord(part)) return undefined;
  const direct = asArtifact(part);
  if (direct) return direct;
  if (isRecord(part.data)) {
    const inner = asArtifact(part.data);
    if (inner) return inner;
  }
  if (Array.isArray(part.parts)) {
    for (const sub of part.parts) {
      const found = pickArtifact(sub);
      if (found) return found;
    }
  }
  return undefined;
}

function collectArtifacts(input: A2aInbound): DeliveryArtifact[] {
  const out: DeliveryArtifact[] = [];
  for (const p of [...(input.artifactParts ?? []), ...(input.dataParts ?? [])]) {
    const a = pickArtifact(p);
    if (a) out.push(a);
  }
  return out;
}

/** 把裸 A2A `parts` 数组拆成两档（+ artifact 候选）。 */
export function toA2aInbound(parts: unknown[]): A2aInbound {
  const inbound: A2aInbound = { dataParts: [], textParts: [], artifactParts: [] };
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === 'string') inbound.textParts!.push(part.text);
    if (part.kind === 'artifact') {
      inbound.artifactParts!.push(part);
      continue;
    }
    // data part 既是 a2tAction 载体的候选，也可能是 artifact data
    if (isRecord(part.data)) inbound.dataParts!.push(part.data);
  }
  return inbound;
}

function normalizeInput(input: A2aParseInput): A2aInbound {
  if ('parts' in input && Array.isArray((input as { parts: unknown[] }).parts)) {
    return toA2aInbound((input as { parts: unknown[] }).parts);
  }
  return input as A2aInbound;
}

// —— 结构化档 ——

/** 找出第一个带 `a2tAction` 的 data part（只有这一个 key 才算结构化档）。 */
function findAclAction(input: A2aInbound): unknown {
  for (const p of input.dataParts ?? []) {
    if (isRecord(p) && 'a2tAction' in p) return p.a2tAction;
  }
  return undefined;
}

function parseStructured(raw: unknown): ParsedAction {
  if (!isRecord(raw)) return { ok: false, reason: 'a2tAction 不是对象' };
  const type = raw.type;
  if (typeof type !== 'string' || !ACTION_TYPES.includes(type as A2aActionType)) {
    return { ok: false, reason: `a2tAction.type 非法：${String(type)}` };
  }
  const t = type as A2aActionType;

  switch (t) {
    case 'OFFER':
    case 'NEGOTIATE': {
      const price = raw.price;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        return { ok: false, reason: `${t} 缺少合法 price` };
      }
      const note = typeof raw.note === 'string' ? raw.note : undefined;
      return note === undefined ? { ok: true, type: t, price } : { ok: true, type: t, price, note };
    }
    case 'ACCEPT':
      return { ok: true, type: 'ACCEPT' };
    case 'REJECT': {
      const reason = typeof raw.reason === 'string' ? raw.reason : undefined;
      return reason === undefined ? { ok: true, type: 'REJECT' } : { ok: true, type: 'REJECT', note: reason };
    }
    case 'DELIVER': {
      const artifact = asArtifact(raw.artifact);
      if (!artifact) return { ok: false, reason: 'DELIVER 缺少合法 artifact（必须含 artifactKind）' };
      return { ok: true, type: 'DELIVER', artifact };
    }
  }
}

// —— 文本档 ——

/** 分句标点：否定词只作用于同一分句内的触发词。 */
const NEGATION_CLAUSE_SEPARATORS = /[，,。.！!？?；;：:\n]/;
/** 中文否定词（不含 别：会误伤 特别/区别/分别）。 */
const CHINESE_NEGATIONS: readonly string[] = ['不', '没', '未'];
/** 英文否定词：词边界匹配（避免 `know` 里的 `no`）。 */
const ENGLISH_NEGATIONS: readonly string[] = [
  'not',
  'no',
  'never',
  'cannot',
  "can't",
  "don't",
  "doesn't",
  "didn't",
  "won't",
  'refuse',
  'nope',
];
/** 英文否定短语（同样词边界）。 */
const ENGLISH_NEGATION_PHRASES: readonly string[] = ['no deal', 'no way', 'deal breaker'];
/** 假朋友复合词：其中否定字不表否定，命中于该位置的匹配一律跳过。 */
const NEGATION_FALSE_FRIENDS: readonly string[] = [
  '不错',
  '不但',
  '不过',
  '不少',
  '不用',
  '不光',
  '不仅',
  '不妨',
  '不如',
  '不久',
  '没来',
  '未来',
];

interface Span {
  start: number;
  end: number;
}

interface TriggerMatch {
  index: number;
  text: string;
}

/** 位置 pos 所属分句序号（按分句标点切分），用于判定否定词与触发词是否同句。 */
function clauseIndexOf(text: string, pos: number): number {
  let clause = 0;
  for (let i = 0; i < pos; i += 1) {
    if (NEGATION_CLAUSE_SEPARATORS.test(text[i])) clause += 1;
  }
  return clause;
}

/** 找出文本里所有否定词出现位置：中文子串（跳过假朋友）+ 英文词边界/短语。 */
function findNegationSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const word of CHINESE_NEGATIONS) {
    let from = 0;
    while (from <= text.length) {
      const i = text.indexOf(word, from);
      if (i === -1) break;
      // 假朋友（不错/不但/…）里的否定字不表否定
      if (!NEGATION_FALSE_FRIENDS.some((w) => text.startsWith(w, i))) {
        spans.push({ start: i, end: i + word.length });
      }
      from = i + 1;
    }
  }
  for (const word of [...ENGLISH_NEGATIONS, ...ENGLISH_NEGATION_PHRASES]) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return spans;
}

/**
 * ACCEPT 触发词是否被否定：
 *  - 仅限**同一分句**内、起点不晚于触发词的否定词（含同起点的短语，如 `deal breaker`）；
 *  - 否定词在别的分句（「没问题，成交」）或在触发词之后 → 不影响。
 * REJECT 无守卫：本函数只服务于 ACCEPT。
 */
function isAcceptNegated(text: string, match: TriggerMatch): boolean {
  const triggerClause = clauseIndexOf(text, match.index);
  return findNegationSpans(text).some(({ start }) => {
    if (start > match.index) return false;
    return clauseIndexOf(text, start) === triggerClause;
  });
}

/** 收集某个触发词正则的全部出现。 */
function findTriggers(text: string, source: string): TriggerMatch[] {
  const re = new RegExp(source, 'g');
  const out: TriggerMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, text: m[0] });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

/** ACCEPT 触发词是否「活着」：至少一次出现未被同句否定词否定。 */
function hasLiveAccept(text: string): boolean {
  return findTriggers(text, ACCEPT_TRIGGERS).some((m) => !isAcceptNegated(text, m));
}

const ACCEPT_TRIGGERS = '\\baccept\\b|\\bdeal\\b|接受|成交';
const REJECT_TRIGGERS = '\\breject\\b|拒绝|不干了';

function parseText(text: string, artifacts: DeliveryArtifact[]): ParsedAction {
  const t = text.trim();
  if (t === '') return { ok: false, reason: '文本为空，无法解析' };
  const lower = t.toLowerCase();

  // ACCEPT 受否定守卫；REJECT 无守卫（「不干了」是自然拒绝语境）
  if (hasLiveAccept(lower)) return { ok: true, type: 'ACCEPT' };
  if (findTriggers(lower, REJECT_TRIGGERS).length > 0) return { ok: true, type: 'REJECT', note: t };

  const wantsDeliver = /deliver|交付|给你/.test(lower);
  if (wantsDeliver) {
    if (artifacts.length > 0) return { ok: true, type: 'DELIVER', artifact: artifacts[0] };
    return { ok: false, reason: '文本含交付意图但缺少 artifact part' };
  }

  const price = extractPrice(t);
  if (price !== undefined) {
    if (/negotiate|还价|砍价|便宜/.test(lower)) {
      return { ok: true, type: 'NEGOTIATE', price, note: t };
    }
    if (/^\d+(?:\.\d+)?$/.test(t) || /offer|报价|我出|出价|^出\s*\d/i.test(lower)) {
      return { ok: true, type: 'OFFER', price };
    }
    // 有数字但不像报价（例如“3 天后给你答复”）→ 不猜
    return { ok: false, reason: '文本含数字但无报价/磋商意图，无法解析' };
  }

  return { ok: false, reason: '无法从文本解析出动作' };
}

/**
 * 解析用户 agent 的 A2A 回复 → 一个内核动作。
 * 结构化优先（存在合法 a2tAction 即用、忽略文本）；否则文本兜底；再不行 ok:false。
 */
export function parseA2aAction(input: A2aParseInput): ParsedAction {
  const inbound = normalizeInput(input);

  const a2tAction = findAclAction(inbound);
  if (a2tAction !== undefined) {
    // 有结构化意图就按结构化办：即便写坏了也是「无效回合」，绝不用文本兜底去猜
    return parseStructured(a2tAction);
  }

  const artifacts = collectArtifacts(inbound);
  const textParts = inbound.textParts ?? [];
  const text = textParts.find((p) => typeof p === 'string' && p.trim() !== '');
  if (text === undefined) return { ok: false, reason: '没有可解析的 text part' };
  return parseText(text, artifacts);
}
