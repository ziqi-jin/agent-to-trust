# CHANGELOG — Agent Credit Lab

本项目遵循 [Keep a Changelog](https://keepachangelog.com/) 约定，版本遵循语义化版本。

## [Unreleased]

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
- `@acl/core`：共享类型与常量（维度权重、来源权重、Agent/Evidence 类型）
- `@acl/scoring`：baseline-v0.1 评分引擎（纯函数，确定性、可解释）
- `apps/api`：Fastify + Drizzle + PostgreSQL
  - Agent Registry（CRUD）
  - Evidence 提交/查询（维度校验、source_type provenance）
  - AgentScore 计算/持久化/查询（evidence_refs 可追溯、score_snapshots 快照）
- 测试：评分引擎 8 例 + API 集成 6 例，全绿

### Stage 1 — Simulation Market（P0-6 / P0-7 / P0-8）
- `simulator/`（`@acl/simulator`）：确定性仿真（seed 可复现）
  - P0-6 Simulation Engine：Agent 池 / 任务生成器 / 虚拟钱包 / 调度器
  - P0-7 Market Engine：discovery / offer / accept / contract
  - P0-8 Execution Engine：execute / deliver / verify / settle（状态机，作弊有概率被 verify 识破）
  - 完整事件链：DISCOVER → OFFER → ACCEPT → EXECUTE → DELIVER → VERIFY → SETTLE → REVIEW
- `apps/api`：仿真落库（`/simulation/run`）+ `/leaderboard` + `/stats` + `/events`
- `apps/dashboard`：传播级首页（Hero / HowItWorks / Leaderboard / 证据流 ticker / AgentDetail）
- 测试：simulator 61 例（market / simulation / execution）全绿

### 待办
- P0-9 Reputation Engine v0.1（行为 → 分数自动更新）
- P0-10 Vertical Slice 全链路测试
- CI（GitHub Actions）
- 迁移切 drizzle-kit
