/**
 * A2A 动作解析器（纯函数）。
 *
 * 职责：把用户 agent 的 A2A 回复解析成内核 7 事件里的一个动作
 * （OFFER / NEGOTIATE / ACCEPT / REJECT / DELIVER），供双向桥调用。
 *
 * 设计裁决（spec §3.3）：
 *  1. 结构化优先：只要存在合法 `aclAction`，就用它，忽略文本档。
 *  2. 文本兜底：解析不出 → ok:false（无效回合），绝不猜测。
 *  3. 归一只做轻量提取：artifact 取到对象 + 最小结构检查（有 artifactKind）。
 *     sha256 校验 / 深度归一化是 `normalizeArtifact`（Task 5）的职责。
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
  /** `kind: 'data'` 的 part.data，可能含 `{ aclAction: {...} }` 或 artifact 候选。 */
  dataParts?: unknown[];
  /** `kind: 'text'` 的 part.text。 */
  textParts?: string[];
  /** DELIVER 用的 artifact part（spec §3.4 的 Artifact，或其内部 data）。 */
  artifactParts?: unknown[];
}

/** 也可以直接喂裸 A2A `parts` 数组。 */
export type A2aParseInput = A2aInbound | { parts: unknown[] };

const ACTION_TYPES: readonly A2aActionType[] = ['OFFER', 'NEGOTIATE', 'ACCEPT', 'REJECT', 'DELIVER'];
const ARTIFACT_KINDS: readonly ArtifactKind[] = ['patch', 'file', 'output', 'text'];

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

/** 最小结构检查：对象且 artifactKind 在允许集合内 → 直接取对象，不做深挖。 */
function asArtifact(v: unknown): DeliveryArtifact | undefined {
  if (!isRecord(v)) return undefined;
  const kind = v.artifactKind;
  if (typeof kind !== 'string' || !ARTIFACT_KINDS.includes(kind as ArtifactKind)) return undefined;
  return v as unknown as DeliveryArtifact;
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
    // data part 既是 aclAction 载体的候选，也可能是 artifact data
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

/** 找出第一个带 `aclAction` 的 data part（只有这一个 key 才算结构化档）。 */
function findAclAction(input: A2aInbound): unknown {
  for (const p of input.dataParts ?? []) {
    if (isRecord(p) && 'aclAction' in p) return p.aclAction;
  }
  return undefined;
}

function parseStructured(raw: unknown): ParsedAction {
  if (!isRecord(raw)) return { ok: false, reason: 'aclAction 不是对象' };
  const type = raw.type;
  if (typeof type !== 'string' || !ACTION_TYPES.includes(type as A2aActionType)) {
    return { ok: false, reason: `aclAction.type 非法：${String(type)}` };
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

function parseText(text: string, artifacts: DeliveryArtifact[]): ParsedAction {
  const t = text.trim();
  if (t === '') return { ok: false, reason: '文本为空，无法解析' };
  const lower = t.toLowerCase();

  if (/accept|接受|成交|deal/.test(lower)) return { ok: true, type: 'ACCEPT' };
  if (/reject|拒绝|不干了/.test(lower)) return { ok: true, type: 'REJECT' };

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
 * 结构化优先（存在合法 aclAction 即用、忽略文本）；否则文本兜底；再不行 ok:false。
 */
export function parseA2aAction(input: A2aParseInput): ParsedAction {
  const inbound = normalizeInput(input);

  const aclAction = findAclAction(inbound);
  if (aclAction !== undefined) {
    // 有结构化意图就按结构化办：即便写坏了也是「无效回合」，绝不用文本兜底去猜
    return parseStructured(aclAction);
  }

  const artifacts = collectArtifacts(inbound);
  const textParts = inbound.textParts ?? [];
  const text = textParts.find((p) => typeof p === 'string' && p.trim() !== '');
  if (text === undefined) return { ok: false, reason: '没有可解析的 text part' };
  return parseText(text, artifacts);
}
