/**
 * A2A 客户端：`message/send` 单轮（spec §3.2）。
 *
 * 职责：平台作为 A2A **客户端**，向**用户 agent**（其 Agent Card 的 `card.url`）发一条
 * JSON-RPC `message/send` 请求，拿回它的一轮回复 parts。
 *
 * 请求约定（spec §3.2）：
 *  - `POST {card.url}`，`Content-Type: application/a2a+json`
 *  - HTTP 头 `Authorization: Bearer <token>`（平台侧始终强制带 token；接口 token 可空则不加头）
 *  - body：JSON-RPC 2.0，`id = msg.taskId`，`method = 'message/send'`，
 *    `params.message.parts[0].text` 自包含（带最近历史摘要）→ 用户 agent 无状态也能接；
 *    `params.message.metadata.a2t = { sessionId, round, deadlineMs }`。
 *
 * 响应解析：A2A 的 `result` 是一个 `Task` 或 `Message`。稳妥提取 parts：
 *  `result.parts` → `result.message.parts` → `result.artifacts[*].parts`（DELIVER 走 artifact）。
 *
 * 失败路径**绝不抛异常**，一律映射成 `{ ok:false, reason }`：
 *  - 超时 → `timeout`；网络错误 / 非 2xx → `http`（带 `status`）；坏 JSON / 缺 result / JSON-RPC error → `parse`。
 *
 * 本模块零业务依赖：不碰 DB、不碰内核；网络经 `fetchImpl` 可注入（测试不真发请求）。
 */

import type { AclAgentCard } from './card.js';

/** A2A part（宽松结构，不过度建模：text / data / file 或未来扩展）。 */
export interface A2aPart {
  kind: string;
  text?: string;
  data?: unknown;
  file?: unknown;
  [k: string]: unknown;
}

/** 平台发往用户 agent 的单轮消息（自包含文本 + A2T 元数据）。 */
export interface A2aOutboundMessage {
  contextId: string;
  taskId: string;
  text: string;
  metadata: {
    a2t: {
      sessionId: string;
      round: number;
      deadlineMs: number;
    };
  };
}

/** 发送结果：成功带 parts；失败带可区分的 reason（+ 可选 HTTP status）。 */
export type A2aSendResult =
  | { ok: true; parts: A2aPart[] }
  | { ok: false; reason: 'timeout' | 'http' | 'parse'; status?: number };

export interface SendA2aMessageOpts {
  /** Bearer token。存在则加 `Authorization: Bearer <token>`；缺省则不加头。 */
  token?: string;
  /** 注入 fetch（默认全局 fetch）。测试用假实现，不真发网络。 */
  fetchImpl?: typeof fetch;
  /** 超时毫秒（默认 60_000）。 */
  timeoutMs?: number;
}

/** 默认超时：60s。 */
export const DEFAULT_SEND_TIMEOUT_MS = 60_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 从 JSON-RPC 响应里稳妥提取 parts（A2A `result` 为 Task 或 Message）。
 * 找不到任何 parts 返回 null（调用方映射成 `parse`）。
 */
function extractParts(json: Record<string, unknown>): A2aPart[] | null {
  const result = json.result;
  if (!isRecord(result)) return null;

  // 1) result.parts（Task / Message 直接挂 parts）
  if (Array.isArray(result.parts)) return result.parts as A2aPart[];

  // 2) result.message.parts
  const message = result.message;
  if (isRecord(message) && Array.isArray(message.parts)) {
    return message.parts as A2aPart[];
  }

  // 3) result.artifacts[*].parts（DELIVER 走 artifact）——合并所有 artifact 的 parts
  const artifacts = result.artifacts;
  if (Array.isArray(artifacts)) {
    const collected: A2aPart[] = [];
    let found = false;
    for (const artifact of artifacts) {
      if (isRecord(artifact) && Array.isArray(artifact.parts)) {
        found = true;
        collected.push(...(artifact.parts as A2aPart[]));
      }
    }
    if (found) return collected;
  }

  return null;
}

/**
 * 向用户 agent 发一条 `message/send` 单轮消息，拿回它的一轮回复 parts。
 * 失败不抛异常，返回 `{ ok:false, reason }`。
 */
export async function sendA2aMessage(
  card: AclAgentCard,
  msg: A2aOutboundMessage,
  opts: SendA2aMessageOpts = {},
): Promise<A2aSendResult> {
  const url = card?.url;
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, reason: 'http' };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;

  const headers: Record<string, string> = { 'Content-Type': 'application/a2a+json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const body = {
    jsonrpc: '2.0',
    id: msg.taskId,
    method: 'message/send',
    params: {
      contextId: msg.contextId,
      taskId: msg.taskId,
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: msg.text }],
        metadata: msg.metadata,
      },
    },
  };

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
      fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      timeout,
    ]);

    if (isRecord(raced) && raced.__timedOut === true) {
      return { ok: false, reason: 'timeout' };
    }

    const res = raced as Response;
    if (!res.ok) return { ok: false, reason: 'http', status: res.status };

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, reason: 'parse' };
    }
    if (!isRecord(json)) return { ok: false, reason: 'parse' };

    // JSON-RPC 错误对象 → parse（无 result，无法取 parts）
    if (isRecord(json.error)) return { ok: false, reason: 'parse' };

    const parts = extractParts(json);
    if (parts === null) return { ok: false, reason: 'parse' };

    return { ok: true, parts };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'AbortError' ? 'timeout' : 'http' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
