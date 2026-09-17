import { randomUUID } from 'node:crypto';
import type { A2tAgent } from './types.js';

/** 拉卡/发送默认超时（毫秒）。 */
const CARD_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 60_000;

/** Agent Card（宽松结构：只强依赖 url）。 */
interface A2aCard {
  url?: unknown;
  name?: unknown;
  [k: string]: unknown;
}

/** A2A part（宽松结构，不过度建模）。 */
interface A2aPart {
  kind?: unknown;
  text?: unknown;
  [k: string]: unknown;
}

interface A2aSendBody {
  jsonrpc: string;
  id: string;
  method: string;
  params: {
    message: {
      role: string;
      parts: { kind: string; text: string }[];
      metadata: Record<string, unknown>;
    };
    [k: string]: unknown;
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 从 JSON-RPC 响应提取 parts：result.parts → result.message.parts → result.artifacts[*].parts。 */
function extractParts(json: Record<string, unknown>): A2aPart[] | null {
  const result = json.result;
  if (!isRecord(result)) return null;
  if (Array.isArray(result.parts)) return result.parts as A2aPart[];
  const message = result.message;
  if (isRecord(message) && Array.isArray(message.parts)) return message.parts as A2aPart[];
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

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`请求超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });
  try {
    return (await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout,
    ])) as Response;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A2aAgent：通过 A2A 协议（Agent Card + JSON-RPC `message/send`）与被测 agent 对话。
 *
 * 前置条件（用户自己保证）：`{base}/.well-known/agent-card.json` 可访问，
 * 且 card.url 指向一个接受 `message/send` 的 A2A 服务端。
 *
 * 流程（首次 reply 拉卡并缓存）：
 *  1. GET {base}/.well-known/agent-card.json（RFC 8615）
 *  2. POST card.url，`Content-Type: application/a2a+json`，JSON-RPC 2.0 `message/send`
 *  3. 从响应 parts 提取文本（三层兜底），多个 text part 以换行拼接
 */
export class A2aAgent implements A2tAgent {
  private readonly cardUrl: string;
  private card: A2aCard | null = null;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.cardUrl = `${baseUrl.replace(/\/+$/, '')}/.well-known/agent-card.json`;
  }

  private async loadCard(): Promise<A2aCard> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.fetchImpl,
        this.cardUrl,
        { method: 'GET' },
        CARD_TIMEOUT_MS,
      );
    } catch (err) {
      throw new Error(
        `连不上 A2A agent 的 Agent Card ${this.cardUrl}（${(err as Error).message}）。` +
          `前置条件：你自己起一个 A2A agent，并让它暴露 /.well-known/agent-card.json（本命令不代做这一步）`,
      );
    }
    if (res.status === 404) {
      throw new Error(
        `A2A agent 没有暴露 Agent Card（${this.cardUrl} 返回 404）。` +
          `请先在你的 agent 里实现 GET /.well-known/agent-card.json`,
      );
    }
    if (!res.ok) {
      throw new Error(`拉取 Agent Card 失败：${this.cardUrl} 返回 HTTP ${res.status}`);
    }
    let card: unknown;
    try {
      card = await res.json();
    } catch {
      throw new Error(`Agent Card 不是合法 JSON：${this.cardUrl}`);
    }
    if (!isRecord(card)) {
      throw new Error(`Agent Card 结构不对（期望 JSON 对象）：${this.cardUrl}`);
    }
    this.card = card as A2aCard;
    return this.card;
  }

  async reply(prompt: string): Promise<string> {
    const card = this.card ?? (await this.loadCard());
    if (typeof card.url !== 'string' || card.url.length === 0) {
      throw new Error(
        `Agent Card 缺少 url 字段（message/send 的目标地址），请检查你的 agent card 定义`,
      );
    }
    const endpoint = card.url;

    const body: A2aSendBody = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: prompt }],
          metadata: { a2t: { transport: 'cli-test' } },
        },
      },
    };

    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.fetchImpl,
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/a2a+json' },
          body: JSON.stringify(body),
        },
        SEND_TIMEOUT_MS,
      );
    } catch (err) {
      throw new Error(
        `连不上 A2A agent 的 message/send 端点 ${endpoint}（${(err as Error).message}）`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const digest = text.replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(`message/send 返回 HTTP ${res.status}${digest ? `：${digest}` : ''}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new Error(`message/send 响应不是合法 JSON（期望 JSON-RPC 2.0 + application/a2a+json）`);
    }
    if (!isRecord(json)) {
      throw new Error(`message/send 响应结构不对（期望 JSON-RPC 2.0 对象）`);
    }
    if (isRecord(json.error)) {
      const msg = typeof json.error.message === 'string' ? json.error.message : JSON.stringify(json.error);
      throw new Error(`A2A agent 返回 JSON-RPC error：${msg}`);
    }
    const parts = extractParts(json);
    if (parts === null) {
      throw new Error(
        `message/send 响应里找不到 parts（期望 result.parts / result.message.parts / result.artifacts[*].parts 之一）`,
      );
    }
    const text = parts
      .filter((p) => typeof p?.text === 'string' && (p.text as string).length > 0)
      .map((p) => p.text as string)
      .join('\n')
      .trim();
    if (!text) {
      throw new Error(`A2A agent 的回复里没有文本内容（parts 里没有 text part）`);
    }
    return text;
  }
}
