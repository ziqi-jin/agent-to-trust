# @acl/adapters — 真实 Agent 适配层

把「模型」（LLM）包装成我们系统里的「Agent」个体。**模型 ≠ Agent**：模型是大脑，Agent 是市场里的个体（identity / 行为 / 历史）。

## 组件

- `DeepSeekClient`：Node 原生 fetch 调 DeepSeek（OpenAI 兼容 chat/completions），零第三方依赖。
- `ModelAgent`：一个「模型 + persona」包装成的市场个体。同一模型配不同 persona = 不同 Agent。
- `benchmark`：3 类基准（coding / reasoning / honesty），确定性 grader，产出 `source=benchmark` 证据喂进 `@acl/scoring`。

## 用法

```ts
import { DeepSeekClient, ModelAgent, runBenchmark, benchmarkToEvidence } from '@acl/adapters';

const client = new DeepSeekClient({ apiKey: process.env.DEEPSEEK_API_KEY });
const agent = new ModelAgent({
  id: 'real-agent-01',
  name: 'coder-pro',
  model: 'deepseek-v4-flash',
  systemPrompt: 'You are an honest coder.',
}, client);

const results = await runBenchmark((p) => agent.reply(p));
const evidence = benchmarkToEvidence(agent.config.id, results); // source=benchmark
```

## 红线

- 证据显式 `source=benchmark`，绝不伪装成 real/verified。
- grader 是启发式，非科学验证的基准，对外标注局限性。
- 跑真实评测需要 `DEEPSEEK_API_KEY`（本地 `.env`，已 gitignore）。

## 冒烟验证

```bash
npx tsx packages/adapters/scripts/smoke.ts
```
