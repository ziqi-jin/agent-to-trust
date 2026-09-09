/**
 * Playground 场景解析与校验（纯函数，无 IO）。
 *
 * 红线（spec docs/specs/2026-09-02-playground-design.md）：
 * - SSRF 防护：endpoint 必须 http(s) 且 host 非环回/私网/链路本地
 * - 数值关系：0 < floor < target ≤ opening；maxRounds 2..8
 * - 风格三档 → 对手让步步长：tough 0.10 / balanced 0.25 / gentle 0.40（下限 0.5）
 * - apiKey 只透传，不参与存储
 */
import { randomUUID } from 'node:crypto';
import { NEGOTIATION_SCENARIOS, scenarioText, type Locale, type NegotiationScenario } from '@acl/sdk';

export type PlayStyle = 'tough' | 'balanced' | 'gentle';

/** style → 对手让步比例（占 opening−floor 的百分比）。 */
const STYLE_STEP_RATIO: Record<PlayStyle, number> = { tough: 0.1, balanced: 0.25, gentle: 0.4 };
const MIN_STEP = 0.5;

export interface CustomScenario {
  brief: string;
  agentRole: string;
  counterpartRole: string;
  metricLabel: string;
  opening: number;
  floor: number;
  target: number;
  maxRounds?: number;
  style: PlayStyle;
}

export interface SessionInput {
  name?: string;
  endpoint: string;
  apiKey?: string;
  /** 可选：chat-completions 的 model 字段（DeepSeek/智谱等厂商直连必填）。 */
  model?: string;
  /** 会话语言（考题/对手话术/事件流）；非法值忽略，默认 'en'（0904 i18n）。 */
  locale?: Locale;
  scenario: { templateId?: string; custom?: CustomScenario };
}

/** 校验产物：scenario 已解析成 NegotiationScenario（step 已按风格算好；EN 时文案已 materialize）。 */
export interface ValidatedSessionInput {
  name: string;
  endpoint: string;
  apiKey?: string;
  model?: string;
  locale: Locale;
  scenario: NegotiationScenario;
}

type Validated = { ok: true; value: ValidatedSessionInput } | { ok: false; error: string };

const isFinitePos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** 点分十进制 IPv4 是否环回/私网/链路本地/未指定。 */
function isPrivateV4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true; // 环回 / 私网 / 未指定
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网
  if (a === 192 && b === 168) return true; // 私网
  if (a === 169 && b === 254) return true; // 链路本地
  return false;
}

/** IPv6 字面量（方括号已剥）→ 8 段 hextet；非法返回 null。 */
function parseIpv6(host: string): number[] | null {
  let s = host;
  // 防御：内嵌点分 IPv4（URL 归一化后通常已转 hex，直接调用时需稳）
  if (s.includes('.')) {
    const colon = s.lastIndexOf(':');
    const v4 = s.slice(colon + 1).split('.').map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, colon + 1)}${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (str: string): number[] | null => {
    if (str === '') return [];
    const out: number[] = [];
    for (const g of str.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const left = parseGroups(halves[0] ?? '');
  const right = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

/** 取末两段 hextet 还原点分十进制（IPv4-mapped/compatible）。 */
function mappedIpv4(v6: number[]): string {
  const hi = v6[6];
  const lo = v6[7];
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  // IPv6 字面量（URL 方括号已剥）
  if (h.includes(':')) {
    const v6 = parseIpv6(h.replace(/^\[|\]$/g, ''));
    if (!v6) return true; // 解析不了 → 保守拒绝
    // 审计 A5【P2】：IPv4-mapped ::ffff:a.b.c.d / IPv4-compatible ::a.b.c.d
    // 先归一化回 IPv4 再判私网，堵 ::ffff:127.0.0.1 类绕过。
    if (v6.slice(0, 5).every((x) => x === 0) && v6[5] === 0xffff) {
      return isPrivateV4(mappedIpv4(v6));
    }
    if (v6.slice(0, 6).every((x) => x === 0)) {
      // ::（未指定）/ ::1（环回）/ ::x.y.z.w（IPv4-compatible）
      return isPrivateV4(mappedIpv4(v6));
    }
    const hi = v6[0];
    if ((hi & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
    if ((hi & 0xffc0) === 0xfe80) return true; // 链路本地 fe80::/10
    if ((hi & 0xff00) === 0xff00) return true; // 组播 ff00::/8
    return false;
  }
  return isPrivateV4(h);
}

/** SSRF 防护：http(s) 且 host 非环回/私网/链路本地。 */
export function isPublicEndpoint(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (!u.hostname) return false;
  return !isPrivateHost(u.hostname);
}

function validateCustom(c: CustomScenario): { ok: true; scenario: NegotiationScenario } | { ok: false; error: string } {
  if (typeof c.brief !== 'string' || !c.brief.trim()) return { ok: false, error: 'custom.brief 必填' };
  if (typeof c.agentRole !== 'string' || !c.agentRole.trim()) return { ok: false, error: 'custom.agentRole 必填' };
  if (typeof c.counterpartRole !== 'string' || !c.counterpartRole.trim()) return { ok: false, error: 'custom.counterpartRole 必填' };
  if (typeof c.metricLabel !== 'string' || !c.metricLabel.trim()) return { ok: false, error: 'custom.metricLabel 必填' };
  if (!isFinitePos(c.opening) || !isFinitePos(c.floor) || !isFinitePos(c.target)) {
    return { ok: false, error: 'opening/floor/target 必须为正数' };
  }
  if (!(c.floor < c.target && c.target <= c.opening)) {
    return { ok: false, error: '数值关系必须满足 floor < target ≤ opening' };
  }
  const maxRounds = c.maxRounds ?? 4;
  if (!Number.isInteger(maxRounds) || maxRounds < 2 || maxRounds > 8) {
    return { ok: false, error: 'maxRounds 必须 2..8' };
  }
  const ratio = STYLE_STEP_RATIO[c.style];
  if (ratio === undefined) return { ok: false, error: 'style 必须是 tough | balanced | gentle' };
  const step = Math.max(MIN_STEP, (c.opening - c.floor) * ratio);
  return {
    ok: true,
    scenario: {
      id: `pg-custom-${randomUUID().slice(0, 8)}`,
      brief: c.brief.trim(),
      agentRole: c.agentRole.trim(),
      counterpartRole: c.counterpartRole.trim(),
      metricLabel: c.metricLabel.trim(),
      maxRounds,
      strategy: { opening: c.opening, floor: c.floor, step, target: c.target },
    },
  };
}

/** 模板命中后按 locale materialize 文案：EN 时用 en 字段覆盖（id/strategy/maxRounds 不动）。 */
function materializeScenario(sc: NegotiationScenario, locale: Locale): NegotiationScenario {
  if (locale === 'en' && sc.en) {
    const t = scenarioText(sc, 'en');
    return { ...sc, brief: t.brief, agentRole: t.agentRole, counterpartRole: t.counterpartRole, metricLabel: t.metricLabel };
  }
  return { ...sc };
}

/** 校验并解析 Playground 会话入参。所有非法路径都返回 ok:false + 中文 error（前端映射）。locale 默认 'en'。 */
export function validateSessionInput(body: unknown): Validated {
  if (typeof body !== 'object' || body === null) return { ok: false, error: '请求体必须是 JSON 对象' };
  const b = body as Record<string, unknown>;
  if (typeof b.endpoint !== 'string' || !b.endpoint.trim()) return { ok: false, error: 'endpoint 必填' };
  if (!isPublicEndpoint(b.endpoint.trim())) {
    return { ok: false, error: 'endpoint 必须是公网 http(s) 地址（拒绝环回/私网）' };
  }
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 60) : 'anonymous';
  const apiKey = typeof b.apiKey === 'string' && b.apiKey.trim() ? b.apiKey.trim() : undefined;
  const model = typeof b.model === 'string' && b.model.trim() ? b.model.trim().slice(0, 120) : undefined;
  const locale: Locale = b.locale === 'zh' ? 'zh' : 'en'; // 非法值一律回默认 en
  const sc = b.scenario;
  if (typeof sc !== 'object' || sc === null) return { ok: false, error: 'scenario 必填' };
  const s = sc as { templateId?: unknown; custom?: unknown };

  if (typeof s.templateId === 'string' && s.templateId) {
    const tpl = NEGOTIATION_SCENARIOS.find((t) => t.id === s.templateId);
    if (!tpl) return { ok: false, error: `未知模板：${s.templateId}` };
    return {
      ok: true,
      value: { name, endpoint: b.endpoint.trim(), apiKey, model, locale, scenario: materializeScenario(tpl, locale) },
    };
  }
  if (s.custom !== undefined && s.custom !== null) {
    const r = validateCustom(s.custom as CustomScenario);
    if (!r.ok) return r;
    return {
      ok: true,
      value: { name, endpoint: b.endpoint.trim(), apiKey, model, locale, scenario: r.scenario },
    };
  }
  return { ok: false, error: 'scenario.templateId 与 scenario.custom 至少给一个' };
}
