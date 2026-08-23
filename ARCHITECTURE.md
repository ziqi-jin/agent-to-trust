# ARCHITECTURE — Agent Credit Lab

> 版本：v0.1
> 更新：2026-08-23
> 技术栈决策见 `docs/adr/0001-typescript-stack.md`

## 总览

```
                Web Dashboard (Next.js + TS)
                         │
                    Fastify API (Node + TS)
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
   Agent Registry    Market API      Score API
        │                │                │
        └────────────────┼────────────────┘
                         ↓
                 Event / Job Layer
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
   Simulation Engine  Benchmark      Reputation Engine
        │                │                │
        └────────────────┼────────────────┘
                         ↓
                    PostgreSQL
                         │
                       Redis
```

## 技术选型

| 层 | 技术 |
|----|------|
| 语言 | **TypeScript**（全栈统一，前后端共享类型） |
| 后端 | Node.js + Fastify + Drizzle ORM |
| 数据库 | PostgreSQL（主） |
| 队列/缓存 | Redis |
| 前端 | Next.js + React + TypeScript |
| 仿真 | TypeScript（进程内，后期可扩展 worker） |
| 测试 | Vitest |
| monorepo | npm workspaces |
| 部署 | Docker Compose |

第一版 **不做**：Kubernetes、微服务拆分、区块链、多链、复杂消息中间件。

## Monorepo 边界

```
apps/api         # Fastify (Node + TS)
apps/dashboard   # Next.js
packages/core    # 共享类型与常量（Agent/Evidence/Score/维度权重）★前后端同源
packages/scoring # 信用引擎（纯函数，可插拔 score model）
packages/sdk     # 外部 Agent 接入 SDK
packages/adapters# Agent 适配器（OpenClaw / OpenAI-compatible / HTTP）
simulator/       # 仿真引擎 + 市场 + 经济
benchmark/       # benchmark lab
reputation/      # evidence / peer / graph / decay
attacks/         # attack lab
experiments/     # 实验定义与结果
```

每个模块有自己的 README、测试与依赖边界。

**类型共享是关键架构收益**：`@acl/core` 定义 `Dimension`、`Source`、`Agent`、`Evidence` 等类型，`apps/api` 与 `apps/dashboard` 引用同一份，杜绝前后端类型漂移。

## 核心设计决策

1. **Append-only 行为数据**：`evidence` / `credit_scores` / `score_snapshots` 只追加，修正用新事件，不覆盖历史。
2. **Score 模块化**：score model 可插拔、带版本号，不同算法可并存对比（baseline vs weighted vs graph vs evidence-aware）。
3. **Evidence 绑定**：每个 score 更新必须引用 evidence（`evidence_refs`）。
4. **Provenance 完整**：实验/benchmark/score 都记录 code_version、model_version、prompt_version、seed、environment、source_type。
5. **数据可信度标记**：`simulation | benchmark | real | verified | self-reported | synthetic`。

## API 规范

- REST first，内部事件可用 event bus。
- 输入全部用 TypeScript 类型约束（`@acl/core`）。
- 每个 mutation 支持 idempotency key（Stage 2 起落实）。
- OpenAPI 文档：接入 `@fastify/swagger`（Stage 1 收尾）。

## 安全基线

- 可执行 Agent：timeout、CPU/memory limit、tool allowlist、secret isolation、audit log。
- 不允许任意 Agent 直接控制宿主机。

详见 `docs/PROJECT_PLAN.md` 与 `docs/ENGINEERING_GOVERNANCE.md`。
