# CONTRIBUTING — Agent Credit Lab

感谢你愿意为 Agent Credit Lab 贡献。请先读这篇简短说明。

## 你能贡献什么

- **Benchmark**：新增标准测试任务
- **Agent**：提交示例 Agent
- **Attack**：新增攻击场景
- **Scoring Model**：新增/改进信用算法
- **Simulation Scenario**：新增经济场景
- **Adapter**：接入新的 Agent 框架
- **Dataset / Research**：数据或研究报告

## 贡献形式

- Pull Request
- Experiment Proposal
- Benchmark Submission
- Agent Submission
- Attack Submission

## 关键规则

1. **不伪装数据**：simulation / synthetic 数据必须明确标识，不得当作真实交易。
2. **分数可解释**：每个 score 必须能追溯到 evidence。
3. **实验可复现**：记录 seed、版本、环境、provenance。
4. **带验收标准**：每个功能有明确 acceptance criteria。

## 流程

1. 先开 Issue（用 `docs/ISSUES.md` 模板）说明 Objective / Hypothesis / Scope / Non-goals。
2. 小步提交，先测试后重构。
3. PR 里写清楚：What changed / Why / Tests / Experiment / Known limitations。
4. 满足 `docs/ENGINEERING_GOVERNANCE.md` 的 Definition of Done 才会被合并。

## 开发环境

```bash
docker compose up
```

本地跑测试、lint 的方式见 `apps/api/README.md`（Stage 0 落地后）。
