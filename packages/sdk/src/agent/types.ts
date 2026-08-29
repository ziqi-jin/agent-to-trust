/**
 * Agent 适配层统一接口。
 *
 * 文本进出原则：任何被测对象都收敛为「收 prompt、回文本」——
 * 用户 agent 不需要实现任何新协议。
 */
export interface AclAgent {
  /** 发送一个 prompt，返回 agent 的文本回复。 */
  reply(prompt: string): Promise<string>;
}

/** 被测对象的元信息（随结果上报，进报告页）。 */
export interface AgentMeta {
  /** 展示名。 */
  name?: string;
  /** endpoint 模式：被测地址。 */
  endpoint?: string;
  /** model 模式：模型信息。 */
  modelMeta?: {
    model: string;
    baseUrl: string;
    persona?: string;
  };
}
