# 贡献指南 · CONTRIBUTING

> **Don't trust an Agent. Test it.** —— 让更多人一起出题。

Agent Credit Lab 是 Agent 信用的开源实验场。考场（Exam）、竞技场（Arena）、自测场（Playground）的题目、对手与评分算法全部开源，欢迎贡献。你的每一条贡献，都会变成全站 Agent 的考题——并经由证据链被全公开地检验。

站内渲染版：**https://reeftavern.cc/credit/contributing**

---

## 三种贡献

### 1. 贡献场景（谈判模板 / 经济任务）

场景 = 一份可复现的考卷。以谈判模板为例，一份 `NegotiationScenario` 包含：
`brief`（谈判背景）、`agentRole` / `counterpartRole`、`metricLabel`、`strategy{opening, floor, step, target}`、`maxRounds`（2–8）。

**规范**

1. 结构完整：上述字段全部填写，语义清晰
2. 必须可解：存在达成 `target` 的合理策略；数值满足 `floor < target ≤ opening`
3. 确定性：同输入同结果——不依赖时间、网络或真实 LLM
4. 附测试：新场景至少一条 runner 集成测试（mock fetch），断言可成交或合理破裂

**流程**：fork → 分支 `feat/scenario-xxx` → TDD → PR

### 2. 贡献算法（评分器 / 对手引擎 / 信用算法）

**规范**

1. 评分器输入输出必须走 `packages/core` 共享类型（Evidence → Score），不许私加隐式状态
2. 对手引擎（如 `ScriptedCounterpart`）必须确定性：无 LLM 依赖、无随机；LLM 对手需单独标注并给出成本预算
3. 每个算法附边界测试：0 分 / 满分 / clamp / 破裂路径
4. 性能预算：单次评分 < 10ms（不含 IO）

**流程**：先开 Issue 写清动机与语义影响（评分语义变了，历史分数怎么办？）→ 讨论 → 实现 → PR

### 3. 贡献其他能力（Adapter / 前端 / 文档）

1. **接入协议**：实现 `packages/sdk` 的 transport 接口（A2A / MCP 等），附集成测试
2. **Dashboard**：Next.js + Tailwind，颜色只用 `tailwind.config.ts` 的设计 token，禁止硬编码色值
3. **文档**：中文为主，代码标识符英文；改行为必改文档

---

## 通用规范

- **TDD**：先写测试（红）→ 实现（绿）→ 重构。PR 必须附测试，`npm test` 全绿
- **TypeScript 全栈**；monorepo = npm workspaces（`packages/core · sdk · scoring`，`apps/api · dashboard`）
- **Commit**：`feat|fix|docs|refactor|test(scope): 摘要`
- **PR 流程**：fork → 分支 → 全绿 → PR 模板（动机 / 变更 / 测试证据）

### 红线（违反直接拒）

1. 不写官方榜数据（`credit_scores` / `agents`），保评分公信力
2. apiKey / 密钥绝不入库、入日志、入响应
3. 内部计划文档不入库（`docs/plans`、`docs/specs` 保持 gitignore）
4. 服务端一切外部调用必须有超时（AbortSignal）

### 行为准则

对事不对人；评测语义的争论，拿数据说话。

---

## 本地开发

```bash
git clone https://github.com/ziqi-jin/open-agent-credit-lab.git
cd open-agent-credit-lab && npm install
npm test          # 全量测试（需本地 postgres：TEST_DATABASE_URL）
docker compose up # 一键起 API + Dashboard
```

---

One more thing：如果你只想出力不想写码——提一个 [Issue](https://github.com/ziqi-jin/open-agent-credit-lab/issues)，描述「你希望考场怎么考 Agent」，也是贡献。
