/**
 * 用户 A2A Agent Card 读取 + Arena 分流 + TTL 缓存（spec §3.1）。
 *
 * 职责：拉取**用户 agent** 的 Agent Card（RFC 8615：`GET {base}/.well-known/agent-card.json`），
 *  1. `fetchAgentCard`：获取 + 结构解析 + TTL 缓存（同 URL 命中不二次发网络）。
 *  2. `isArenaReady`：分流判定——是否达到进入 Arena 的门槛。
 *
 * 分流规则（本任务判定核心，逐字遵守 spec §3.1）：
 *  `isArenaReady(card) === true` 当且仅当
 *    a. `card['x-a2t']?.arenaReady === true`，**且**
 *    b. `skills` 数组里至少一个 skill 的 `tags` 数组含 `'negotiation'` 或 `'trade'`。
 *  其他一律 false（x-a2t 缺失 / arenaReady 非 true / skills 缺失或空 / tags 不含适配词 / 结构畸形）。
 *
 * 失败路径不抛异常：一切失败走 `{ ok:false, reason }`（reason 可区分：http-404 / timeout / bad-json / not-object / http-* / network-error）。
 *
 * 本模块零业务依赖：不碰 DB、不碰内核；网络经 `fetchImpl` 可注入（测试不真发请求）。
 */

export interface AclAgentCardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  [k: string]: unknown;
}

export interface AclAgentCardSkill {
  id: string;
  tags: string[];
  [k: string]: unknown;
}

export interface AclAgentCardX {
  arenaReady?: boolean;
  protocolVersion?: string;
  [k: string]: unknown;
}

/** 用户 Agent Card（spec §3.1 必需字段；`x-a2t` 为可选扩展块）。 */
export interface AclAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: AclAgentCardCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AclAgentCardSkill[];
  securitySchemes?: Record<string, unknown>;
  'x-a2t'?: AclAgentCardX;
  [k: string]: unknown;
}

export type CardResult = { ok: true; card: AclAgentCard } | { ok: false; reason: string };

export interface FetchAgentCardOpts {
  /** 注入 fetch（默认全局 fetch）。测试用假实现，不真发网络。 */
  fetchImpl?: typeof fetch;
  /** TTL 毫秒（默认 60_000）。`<= 0` 表示禁用缓存。 */
  cacheMs?: number;
}

/** 默认 TTL：60s。 */
export const DEFAULT_CARD_CACHE_MS = 60_000;

/** 默认超时：5s。 */
export const DEFAULT_CARD_TIMEOUT_MS = 5_000;

interface CacheEntry {
  expiresAt: number;
  result: CardResult;
}

/** url → 缓存条目。仅缓存成功结果（瞬时失败不固化）。 */
const cardCache = new Map<string, CacheEntry>();

/** 测试用清缓存入口（避免跨用例泄漏）。 */
export function __clearCardCache(): void {
  cardCache.clear();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 分流判定：Arena-ready 才返回 true；畸形结构安全返回 false，不抛。 */
export function isArenaReady(card: AclAgentCard): boolean {
  if (!isRecord(card)) return false;

  const xacl = card['x-a2t'];
  if (!isRecord(xacl) || xacl.arenaReady !== true) return false;

  const skills = card.skills;
  if (!Array.isArray(skills)) return false;

  return skills.some((skill) => {
    if (!isRecord(skill)) return false;
    const tags = skill.tags;
    if (!Array.isArray(tags)) return false;
    return tags.includes('negotiation') || tags.includes('trade');
  });
}

/** 单次抓取 + 解析（不含缓存）。失败不抛，一律映射成 `{ ok:false, reason }`。 */
async function loadCard(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<CardResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // 超时用 Promise.race 兜底：即便 fetch 实现不响应 abort signal，也能按时收口。
  const timeout = new Promise<{ __timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ __timedOut: true });
    }, timeoutMs);
  });

  try {
    const raced = await Promise.race([
      fetchImpl(url, { method: 'GET', signal: controller.signal }),
      timeout,
    ]);

    if (isRecord(raced) && raced.__timedOut === true) {
      return { ok: false, reason: 'timeout' };
    }

    const res = raced as Response;
    if (res.status === 404) return { ok: false, reason: 'http-404' };
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: 'bad-json' };
    }

    if (!isRecord(body)) return { ok: false, reason: 'not-object' };

    return { ok: true, card: body as AclAgentCard };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'AbortError' ? 'timeout' : 'network-error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 读取用户 Agent Card。同一 url 在 cacheMs 内命中缓存（不二次发网络）。
 * 失败不抛异常，返回 `{ ok:false, reason }`。
 */
export async function fetchAgentCard(
  url: string,
  opts: FetchAgentCardOpts = {},
): Promise<CardResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cacheMs = opts.cacheMs ?? DEFAULT_CARD_CACHE_MS;

  if (cacheMs > 0) {
    const hit = cardCache.get(url);
    if (hit && hit.expiresAt > Date.now()) return hit.result;
  }

  const result = await loadCard(url, fetchImpl, DEFAULT_CARD_TIMEOUT_MS);

  if (cacheMs > 0 && result.ok) {
    cardCache.set(url, { expiresAt: Date.now() + cacheMs, result });
  }

  return result;
}
