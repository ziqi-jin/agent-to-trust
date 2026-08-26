/**
 * @acl/adapters — ModelAgent。
 *
 * 一个「模型 + persona」包装成的市场个体。
 * 同一个模型（如 deepseek-v4-flash）配不同 persona，就是不同 Agent 个体：
 * 不同的身份、行为倾向、系统提示。这实现了「模型 ≠ Agent」的分层。
 */
import type { Agent } from '@acl/core';
import type { ChatMessage } from './deepseek';
import type { DeepSeekClient } from './deepseek';

export interface ModelAgentConfig {
  /** Agent 唯一 id（进入 @acl/core 的 Agent Registry）。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 背后模型 id。 */
  model: string;
  /** persona 系统提示（决定这个个体的行为/语气/专长）。 */
  systemPrompt: string;
  /** 可选：声明的能力域（进入 Agent Profile）。 */
  capabilities?: string[];
  /** 可选：owner。 */
  owner?: string;
}

export class ModelAgent {
  readonly config: ModelAgentConfig;
  private client: DeepSeekClient;

  constructor(config: ModelAgentConfig, client: DeepSeekClient) {
    this.config = config;
    this.client = client;
  }

  /** 生成进入 Agent Registry 的 Profile（对应 @acl/core.Agent）。 */
  profile(): Agent {
    return {
      id: this.config.id,
      name: this.config.name,
      owner: this.config.owner,
      status: 'active',
      verificationLevel: 'unverified',
      capabilities: this.config.capabilities ?? [],
      createdAt: new Date().toISOString(),
    };
  }

  /** 以该 persona 回答一个用户 prompt。 */
  async reply(userPrompt: string): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const res = await this.client.chat(messages, { model: this.config.model });
    return res.content;
  }
}
