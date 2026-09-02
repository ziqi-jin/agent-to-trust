import type { AclAgent } from './types.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * ModelAgent：对「模型 + persona」跑评测（OpenAI 兼容协议）。
 *
 * 任意 base_url + api_key —— DeepSeek / 智谱 / Kimi / OpenAI 通吃。
 */
export class ModelAgent implements AclAgent {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: {
      model: string;
      baseUrl: string;
      apiKey: string;
      persona?: string;
      /** 单次请求超时（毫秒），默认 120s；推理模型思考较慢，勿设太小。 */
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  async reply(prompt: string): Promise<string> {
    const messages: ChatMessage[] = [];
    if (this.opts.persona) {
      messages.push({ role: 'system', content: this.opts.persona });
    }
    messages.push({ role: 'user', content: prompt });

    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ model: this.opts.model, messages }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error(`模型请求超时（${Math.round(this.timeoutMs / 1000)}s 无响应）`);
      }
      throw err;
    }
    if (!res.ok) {
      // 带上响应体摘要：厂商 5xx/4xx 的真实原因（限流/审核/参数）全在 body 里，不能只报状态码
      const errBody = await res.text().catch(() => '');
      const digest = errBody.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`模型 API 返回 ${res.status}${digest ? `：${digest}` : ''}`);
    }
    const json = (await res.json()) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('模型响应缺少 choices[0].message.content');
    }
    return content;
  }
}
