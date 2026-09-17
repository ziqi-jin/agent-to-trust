import type { A2tAgent } from './types.js';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * EndpointAgent：对用户已有的 HTTP endpoint 跑评测（agent 零改动）。
 *
 * 请求：OpenAI chat-completions 格式（行业最通用）。
 * 响应：兼容标准结构（choices[0].message.content）与裸文本。
 */
export class EndpointAgent implements A2tAgent {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async reply(prompt: string): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      });
    } catch (err) {
      // 人话报错：网络层失败最常见的原因是 agent 没在跑 / URL 打错 / 端口不对。
      throw new Error(
        `连不上 endpoint ${this.url}（${(err as Error).message}）。` +
          `请检查：① agent 是否正在运行 ② URL 与端口是否正确`, 
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const digest = body.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(
        `endpoint ${this.url} 返回 HTTP ${res.status}${digest ? `：${digest}` : ''}` +
          `（agent 收到了请求但报错了，请查看它的日志）`,
      );
    }
    const body = await res.text();
    try {
      const json = JSON.parse(body) as ChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content === 'string') return content;
      // 是 JSON 但没有 choices[0].message.content → 格式不符
      throw new Error(
        `endpoint ${this.url} 的响应格式不对：期望 OpenAI chat 格式 ` +
          `{"choices":[{"message":{"content":"..."}}]}，或直接返回纯文本。` +
          `实际收到：${body.trim().slice(0, 120)}`,
      );
    } catch (e) {
      // 已经是我们抛出的格式错误，原样上抛；否则说明 body 不是 JSON → 按裸文本处理。
      if (e instanceof Error && e.message.startsWith('endpoint ')) throw e;
    }
    return body;
  }
}
