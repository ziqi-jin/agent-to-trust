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
      fetchImpl?: typeof fetch;
    },
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async reply(prompt: string): Promise<string> {
    const messages: ChatMessage[] = [];
    if (this.opts.persona) {
      messages.push({ role: 'system', content: this.opts.persona });
    }
    messages.push({ role: 'user', content: prompt });

    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, messages }),
    });
    if (!res.ok) {
      throw new Error(`模型 API 返回 ${res.status}`);
    }
    const json = (await res.json()) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('模型响应缺少 choices[0].message.content');
    }
    return content;
  }
}
