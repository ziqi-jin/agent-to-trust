import type { SealitAgent } from './types.js';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * EndpointAgent：对用户已有的 HTTP endpoint 跑评测（agent 零改动）。
 *
 * 请求：OpenAI chat-completions 格式（行业最通用）。
 * 响应：兼容标准结构（choices[0].message.content）与裸文本。
 */
export class EndpointAgent implements SealitAgent {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async reply(prompt: string): Promise<string> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) {
      throw new Error(`endpoint ${this.url} 返回 ${res.status}`);
    }
    const body = await res.text();
    try {
      const json = JSON.parse(body) as ChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content === 'string') return content;
    } catch {
      // 非 JSON → 按裸文本处理
    }
    return body;
  }
}
