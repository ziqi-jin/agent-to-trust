import type { JevQuestion, JevResponse } from './types.js';

export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1';
export const JEV_DEFAULT_MODEL = 'jev-latest';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export interface JevCallResult {
  response: JevResponse;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/** Jev（TypeSafe System One）客户端。零第三方依赖，可注入 fetchImpl/now 便于测试。 */
export class JevClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private fetchImpl: FetchLike;
  private now: () => number;

  constructor(opts: { apiKey: string; baseUrl?: string; model?: string; fetchImpl?: FetchLike; now?: () => number }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? JEV_DEFAULT_BASE_URL;
    this.model = opts.model ?? JEV_DEFAULT_MODEL;
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
    this.now = opts.now ?? (() => Date.now());
  }

  async systemOne(state: string, questions: Record<string, JevQuestion>): Promise<JevCallResult> {
    if (!this.fetchImpl) throw new Error('JevClient: 无可用 fetch 实现（环境缺少 global fetch）');
    const started = this.now();
    const res = await this.fetchImpl(`${this.baseUrl}/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ state, model: this.model, questions }),
    });
    const latencyMs = this.now() - started;
    if (!res.ok) throw new Error(`Jev API 请求失败：${res.status} ${res.statusText}`);
    const response = (await res.json()) as JevResponse;
    return {
      response,
      latencyMs,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }
}
