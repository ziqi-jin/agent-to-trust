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

### 待办
- P0-5 Agent Profile 前端页面（Next.js Dashboard）
- CI（GitHub Actions）
- demo seed 数据（`source=simulation`）
- 迁移切 drizzle-kit
