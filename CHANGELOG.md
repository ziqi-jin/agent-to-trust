# CHANGELOG — Agent to Trust (A2T)

本项目遵循 [Keep a Changelog](https://keepachangelog.com/) 约定，版本遵循语义化版本。

## [Unreleased]

### Added — Jev judge cross-check（蹭 Jev 热度实验）
- 新包 `@a2t/jev`（独立、可摘除）：`JevClient`（TypeSafe System One）+ 三方统一 `Judge` 接口（deterministic / llm / jev）+ R3 构造样本 + 跑批与报告生成。
- 反向依赖锁：`core`/`scoring`/`sdk`/`adapters`/`apps` 永不 import `@a2t/jev`（架构测试守护）。
- 主页嵌入 `<JevCrosscheck />` 区块（自包含，读静态 JSON），现有榜单/评分零改动。
- `docs/jev.md`（对外公开页）、`README` 中英各加一节、`packages/sdk` keywords 加 `jev`/`typesafe`、repo topics 加 `jev`/`typesafe`/`llm-evaluation`/`llm`。
- `scripts/remove-jev.sh`：幂等摘除脚本（支持 `--dry-run`）。

### Stage 2 — 决策策略扩展 + 真实 Agent 适配层
- `@a2t/simulator` 决策 mock 策略扩展：
  - 报价策略 `OfferStrategy`：`market`（85%–115%）/ `undercut`（恶意压价 55%–85%）/ `premium`（高溢价 115%–145%）
  - 接单策略 `AcceptanceStrategy` 扩展：`lowest-price` / `lowest-latency` / `random`
  - 每个仿真 Agent 随机分配报价/接单策略（模拟不同个体决策风格）
  - 买方预算约束：只考虑不超过任务预算的报价（高溢价/超预算被拒）
- `@a2t/adapters`（新包）真实 Agent 适配层：
  - `DeepSeekClient`：Node 原生 fetch 调 DeepSeek，零第三方依赖
  - `ModelAgent`：模型 + persona 包装成市场个体（模型 ≠ Agent 分层）
  - `benchmark`：coding / reasoning / honesty 3 类基准，确定性 grader，产出 `source=benchmark` 证据
  - 真实 smoke 验证：DeepSeek 跑通 6 case，capability 95 / integrity 100
- 测试：simulator 63→73（+10 策略）+ adapters 18 例，全 workspace 全绿

### Stage 0 — Foundation
- 建立 monorepo 骨架（apps / packages / simulator / benchmark / reputation / attacks / experiments）
- 建立核心文档：README / ROADMAP / ARCHITECTURE / DATA_MODEL / EXPERIMENT_LOG / CHANGELOG
- 建立工程治理规范与 Issue Backlog（P0/P1/P2）
- 本地 git 初始化
- Docker Compose：postgres + redis + api

### 技术栈决策
- 采用 TypeScript 全栈（ADR-0001）：Node + Fastify + Drizzle + PostgreSQL，前端 Next.js/TS
- 弃用最初的原型 Python/FastAPI 后端

### Stage 1 — AgentScore Vertical Slice（后端）
- `@a2t/core`：共享类型与常量（维度权重、来源权重、Agent/Evidence 类型）
- `@a2t/scoring`：baseline-v0.1 评分引擎（纯函数，确定性、可解释）
- `apps/api`：Fastify + Drizzle + PostgreSQL
  - Agent Registry（CRUD）
  - Evidence 提交/查询（维度校验、source_type provenance）
  - AgentScore 计算/持久化/查询（evidence_refs 可追溯、score_snapshots 快照）
- 测试：评分引擎 8 例 + API 集成 6 例，全绿

### Stage 1 — Simulation Market（P0-6 / P0-7 / P0-8）
- `simulator/`（`@a2t/simulator`）：确定性仿真（seed 可复现）
  - P0-6 Simulation Engine：Agent 池 / 任务生成器 / 虚拟钱包 / 调度器
  - P0-7 Market Engine：discovery / offer / accept / contract
  - P0-8 Execution Engine：execute / deliver / verify / settle（状态机，作弊有概率被 verify 识破）
  - 完整事件链：DISCOVER → OFFER → ACCEPT → EXECUTE → DELIVER → VERIFY → SETTLE → REVIEW
- `apps/api`：仿真落库（`/simulation/run`）+ `/leaderboard` + `/stats` + `/events`
- `apps/dashboard`：传播级首页（Hero / HowItWorks / Leaderboard / 证据流 ticker / AgentDetail）
- 测试：simulator 61 例（market / simulation / execution）全绿

### Stage 1 — Reputation Engine v0.1（P0-9）
- 事件驱动分数：evidence 提交 → 自动重算（`computeAndPersist`），无需手动 compute
- 评分标定：capability 维度改用连续 value（measuredQuality 实测质量），分数反映「质量梯度」而非「是否及格」，消除「多个 agent 打满 1000 分」
- 测试：simulator 63 例 + api 11 例全绿

### Stage 1 — Vertical Slice 全链路测试（P0-10）
- 新建 `apps/api/test/e2e.test.ts`（4 例）：仿真 → 落库 → 榜单 → 详情 → 统计 → 事件流端到端跑通，分数可解释 + 可稳定复算 + 幂等 seed + source 红线
- CI：新增 `.github/workflows/ci.yml`（typecheck / test 带 postgres / dashboard build）+ root `typecheck` script
- 重新 seed 部署：清旧数据 + rebuild api 镜像 + 重新灌 100 Agent × 200 轮，标定生效（满分 1000 个数 0，分布 105~982）

### 待办
（Stage 1 闭环完成，进 Stage 2 Simulation Market）
- CI（GitHub Actions）
- 迁移切 drizzle-kit
