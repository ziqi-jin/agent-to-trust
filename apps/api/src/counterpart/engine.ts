/**
 * LLM 对家决策引擎：调 DeepSeek → 解析 → 引擎侧硬约束（clamp / 泄露标记）。
 * 模型锁死（不开放用户指定）；env 仅供运维调价，不进 API 契约。
 */
import type { DeepSeekClient } from '@acl/adapters';
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
    maxTokens: 160,
  });
  const parsed = parseCounterpartReply(res.content, {
    floor: input.params.floor,
    opening: input.params.opening,
    currentValue,
  });
  return { ...parsed, text: res.content.trim(), tokens: res.usage.totalTokens };
}
