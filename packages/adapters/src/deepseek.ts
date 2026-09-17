/**
 * @a2t/adapters — DeepSeek 客户端。
 *
 * 用 Node 原生 fetch 调 DeepSeek OpenAI 兼容接口（chat/completions）。
 * 零第三方依赖，便于测试（可注入自定义 fetch 实现）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  finishReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

interface RawChunk {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string | null;
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export class DeepSeekClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: FetchLike;

  constructor(opts: { apiKey: string; baseUrl?: string; fetchImpl?: FetchLike }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    // 浏览器/Node 全局 fetch；测试可注入 mock
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
  }

  async chat(messages: ChatMessage[], opts: ChatCompletionOptions): Promise<ChatResponse> {
    if (!this.fetchImpl) {
      throw new Error('DeepSeekClient: 无可用 fetch 实现（环境缺少 global fetch）');
    }
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 256,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`DeepSeek API 请求失败：${res.status} ${res.statusText}`);
    }

    const raw = (await res.json()) as RawChunk;
    const content = raw.choices?.[0]?.message?.content ?? '';
    const usage = raw.usage ?? {};
    return {
      content,
      model: raw.model ?? opts.model,
      finishReason: raw.choices?.[0]?.finish_reason ?? null,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      },
    };
  }
}
