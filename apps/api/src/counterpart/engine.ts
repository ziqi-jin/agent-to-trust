/**
 * LLM 对家决策引擎：调 DeepSeek → 把决策转交 parseCounterpartReply 解析
 * （clamp / 泄露标记等硬约束在该解析层实现）→ 组装 LiveDecision。
 * 模型锁死（不开放用户指定）；env 仅供运维调价，不进 API 契约。
 */
import type { DeepSeekClient } from '@a2t/adapters';
import { buildMessages, parseCounterpartReply, type PromptInput } from './prompt';

export const LIVE_COUNTERPART_MODEL = process.env.ARENA_LIVE_MODEL ?? 'deepseek-v4-flash';

export interface LiveDecision {
  value: number;
  accepted: boolean;
  text: string;
  tokens: number;
  leaked: boolean;
}

export async function decideCounterpart(
  client: DeepSeekClient,
  input: PromptInput,
  currentValue = input.params.opening,
): Promise<LiveDecision> {
  const res = await client.chat(buildMessages(input), {
    model: LIVE_COUNTERPART_MODEL,
    temperature: 0.8, // 人格需要变化；复现性靠多次取样，不靠单局
    // 推理模型（deepseek-v4-flash）的思维链吃 max_tokens 配额：160 实测大量 finish=length
    // 且 content 为空（对家「说不出话」）。留足思考 + 正文预算，单局成本由 T5/T7 预算护栏兜。
    maxTokens: 1024,
  });
  const parsed = parseCounterpartReply(res.content, {
    floor: input.params.floor,
    opening: input.params.opening,
    currentValue,
  });
  return { ...parsed, text: res.content.trim(), tokens: res.usage.totalTokens };
}
