# ROADMAP — Agent Credit Lab

> 版本：v0.1（计划）
> 更新：2026-08-23
> 治理依据：`docs/PROJECT_PLAN.md`、`docs/ENGINEERING_GOVERNANCE.md`

## 执行原则

- 每个 Stage 必须有：Objective / Hypothesis / Scope / Milestones / Tasks / Experiments / Artifacts / Metrics / Acceptance / Failure / Exit Gate。
- 不满足 Exit Gate，原则上不进入下一阶段；越级必须写 ADR。
- 所有 simulation 数据必须 `source=simulation`；所有 score 必须可解释；所有实验必须可复现。

## 阶段总表

| Stage | 名称 | 硬条件（Exit Gate） |
|-------|------|---------------------|
| 0 | Foundation / 工程基座 | `docker compose up` 成功，干净环境 ≤15 分钟跑通，CI 全绿，seed 明确 simulation |
| 1 | AgentScore Vertical Slice | Evidence→Score 闭环，分数可解释 + 可稳定复算 |
| 2 | Agent Simulation Market | 完整交易事件链可回溯 |
| 3 | Reputation Engine | 行为可解释地改变 Score |
| 4 | Benchmark Lab | Benchmark 可复现 |
| 5 | Attack Lab | 有公开可复现的攻击对比案例 |
| 6 | Agent Credit Arena | 10 分钟成功体验达标 |
| 7 | Open Source Launch | README/Docs/Demo/CI 完整 |

## Stage 0 — Foundation（当前）

**目标**：统一仓库、运行环境、CI、文档、实验与数据规范，让陌生开发者能稳定运行。

**路标**
- [x] M0.1 Repository / monorepo
- [ ] M0.2 Docker Compose（postgres + redis + api + dashboard）
- [ ] M0.3 CI
- [ ] M0.4 工程规则（`docs/rules/`，含 cursor 规则等价物）
- [ ] M0.5 docs / ADR / changelog
- [ ] M0.6 demo seed（`source=simulation`）

**验收**：`docker compose up` 成功；干净环境 ≤15 分钟首次运行；CI 全绿；关键模块有基础测试；README Quick Start 可独立执行；seed 明确 simulation。

---

## Issue Backlog（P0 / P1 / P2）

> 详细 Issue 清单见 [`docs/ISSUES.md`](docs/ISSUES.md)。此处只列优先级主线。

### P0 — 核心闭环

- [ ] P0-1 Agent Registry（CRUD + identity + capabilities + versions）
- [ ] P0-2 Evidence Schema（type / source / issuer / hash / timestamp / severity）
- [ ] P0-3 Baseline Credit Engine（维度 + 权重 + evidence confidence + freshness decay）
- [ ] P0-4 Score Explain（可展开到 evidence）
- [ ] P0-5 Agent Profile 页面
- [ ] P0-6 Simulation Engine（agents / task generator / virtual wallet / scheduler）
- [ ] P0-7 Market Engine（discovery / offer / accept / contract）
- [ ] P0-8 Execution Engine（execute / deliver / verify / settle）
- [ ] P0-9 Reputation Engine v0.1（行为 → 分数自动更新）
- [ ] P0-10 最小 vertical slice 全链路测试

### P1 — 可传播 Demo

- [ ] P1-1 Leaderboard
- [ ] P1-2 Live Economy 面板
- [ ] P1-3 Reputation Graph
- [ ] P1-4 AgentScore Badge / Share Card
- [ ] P1-5 100-agent economy simulation（1000+ transactions, 10000+ events）

### P2 — 研究能力

- [ ] P2-1 Benchmark Lab（≥5 类 benchmark，可复现，CLI）
- [ ] P2-2 Attack Lab（Sybil / Collusion / Reputation Farming）
- [ ] P2-3 Graph reputation / 抗刷模型对比
- [ ] P2-4 SDK / CLI（`acl` / `agent-credit` 命令族）

### P3 — 商业能力（第一阶段不做）

- [ ] P3-1 Verification API
- [ ] P3-2 Enterprise Risk
- [ ] P3-3 Marketplace / Real Payment（明确延后）
