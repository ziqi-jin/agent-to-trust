# DATA MODEL — Agent to Trust (A2T)

> 版本：v0.2
> 更新：2026-09-17

## 设计原则

- **Append-only**：`behavior_events` / `transactions` / `evidence` / `score_snapshots` 只追加，修正用新事件，不覆盖历史。
- **Provenance**：每个事件/分数带 `source_type`（simulation/benchmark/real/…）、`simulation_or_real`、`schema_version`、`payload_hash`。
- **Evidence 绑定**：score 更新必须引用 evidence。

## 核心表

### 身份与能力
| 表 | 说明 |
|----|------|
| `agents` | id, name, owner, status, verification_level, created_at |
| `agent_versions` | agent_id, version, model_name, prompt_version, tools, environment |
| `agent_capabilities` | agent_id, capability, domain, level |
| `skills` | id, name, description, domain |

### 行为事件（append-only）
| 表 | 说明 |
|----|------|
| `behavior_events` | id, agent_id, event_type, time, source_type, source_id, simulation_or_real, schema_version, payload_hash, payload |
| `tasks` | id, requester_id, provider_id, spec, status, deadline, budget |
| `offers` | id, task_id, agent_id, price, latency_estimate, terms |
| `negotiations` | id, task_id, offer_id, rounds, outcome |
| `contracts` | id, task_id, provider_id, buyer_id, amount, status |
| `transactions` | id, contract_id, from_agent, to_agent, amount, currency(virtual), status, timestamp |
| `reviews` | id, reviewer_id, reviewee_id, contract_id, rating, comment |
| `attestations` | id, issuer_id, subject_id, claim, signature |

### 信用与证据
| 表 | 说明 |
|----|------|
| `evidence` | id, agent_id, type, source, issuer, timestamp, severity, result, evidence_uri, hash |
| `reputation_events` | id, agent_id, event_type, delta, evidence_refs |
| `credit_scores` | id, agent_id, score, dimensions(json), confidence, freshness_days, model_version, evidence_refs |
| `score_snapshots` | id, agent_id, score, model_version, snapshot_at |

### 实验与攻击
| 表 | 说明 |
|----|------|
| `experiments` | id, name, hypothesis, version |
| `experiment_runs` | id, experiment_id, config(seed/env/model), started_at, status, provenance |
| `benchmark_runs` | id, benchmark_id, agent_id, seed, version, result(json) |
| `attack_runs` | id, attack_id, strategy, baseline, before_score, after_score, metrics(json) |
| `relationships` | id, from_agent, to_agent, rel_type(hired/verified/disputed/…), weight |

## 核心关系

```
Agent → Task → Transaction → Evidence → Reputation Event → Score
```

## 事件类型（最小集）

```
DISCOVER → OFFER → NEGOTIATE → ACCEPT → CONTRACT → PAY
→ EXECUTE → DELIVER → VERIFY → REVIEW → SETTLE → DISPUTE
```

## 数据可信度标记

| 标记 | 含义 |
|------|------|
| `simulation` | 模拟环境产生 |
| `benchmark` | 标准化 benchmark 产生 |
| `real` | 真实行为 |
| `verified` | 经可信验证方 |
| `self-reported` | Agent 自报 |

任何对外图表必须带：样本量、时间窗口、来源、版本、局限性。
