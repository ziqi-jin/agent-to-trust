# Agent Credit Lab

> **Don't trust an Agent. Test it.**

> What if every AI Agent had a credit score?

**An open-source laboratory for benchmarking, simulating, attacking, and measuring the trustworthiness of AI agents.**

Agent Credit Lab lets you:

- **benchmark** your Agent against reproducible capability/reliability/negotiation/economy tests
- **run it in an agent economy** with virtual credits, tasks, offers, negotiations, and transactions
- **simulate** collaborations, hiring, subcontracting, failures, and disputes
- **measure** reliability and economic behavior through evidence
- **attack** reputation systems with Sybil, collusion, and reputation-farming scenarios
- **generate evidence-backed AgentScores** and understand exactly *why* a score is what it is
- **compare** different reputation algorithms side by side

---

## Quick Start

```bash
git clone https://github.com/YOUR_ORG/agent-credit-lab.git
cd agent-credit-lab
docker compose up
```

Then open:

```
http://localhost:8000/health  # API 健康检查
http://localhost:8000         # API 根（接口见 apps/api/README.md）
http://localhost:3000         # Dashboard
```

> Requires Docker + Docker Compose. Nothing else.

---

## Status

> ⚠️ **Early experimental baseline.** AgentScore is a *baseline credit model*, not an industry
> standard. All scores are evidence-backed, and all simulation data is explicitly labelled
> `source=simulation`. Nothing here is presented as real-world transaction data.

Current stage: **Stage 0 — Foundation** (see [`ROADMAP.md`](ROADMAP.md)).

---

## Core loop

```
Agent
  → Benchmark
  → Simulation Market (discover / offer / negotiate / hire / execute / verify / settle)
  → Behavior Events
  → Evidence
  → Reputation
  → AgentScore (explainable)
  → Verification
```

## AgentScore (baseline, v0.1)

A composite 0–1000 score, split into explainable dimensions:

| Dimension      | Weight |
|----------------|--------|
| Capability     | 20%    |
| Reliability    | 20%    |
| Delivery       | 15%    |
| Economic       | 10%    |
| Collaboration  | 10%    |
| Security       | 10%    |
| Negotiation    | 5%     |
| Integrity      | 10%    |

Every score is bound to evidence. **No evidence, low confidence.**

---

## Repository layout

```
agent-credit-lab/
├── apps/
│   ├── api/            # Fastify backend (Node + TypeScript)
│   └── dashboard/      # Next.js + TypeScript frontend
├── packages/
│   ├── core/           # shared domain models
│   ├── scoring/        # credit engine
│   ├── sdk/            # python SDK
│   └── adapters/       # agent adapters (OpenClaw, OpenAI-compatible, HTTP)
├── simulator/          # simulation + market + economy engine
├── benchmark/          # benchmark lab
├── reputation/         # evidence / peer / graph / decay
├── attacks/            # attack lab (Sybil / collusion / farming)
├── experiments/        # experiment definitions + results
├── examples/           # example agents
├── scripts/            # dev / ops scripts
└── docs/               # plan, ADR, reference
```

---

## Principles

1. **Evidence first** — every score is explainable through evidence.
2. **Reproducible experiments** — seed, versions, environment, provenance.
3. **Simulation is labelled** — simulated data is never presented as real.
4. **Open the experiment, own the network** — algorithms open, data network owned.
5. **Simple architecture** — no premature microservices, blockchain, or payment rails.

## License

MIT — see [LICENSE](LICENSE).
