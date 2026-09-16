# Architecture — Agent Credit Lab

> Updated: 2026-09-17
> Stack: TypeScript end-to-end — Node + Fastify + Drizzle + PostgreSQL (API), Next.js + TypeScript (dashboard).

## Overview

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

## Technology choices

| Layer | Technology |
|-------|------------|
| Language | **TypeScript** (unified full-stack; frontend and backend share types) |
| Backend | Node.js + Fastify + Drizzle ORM |
| Database | PostgreSQL (primary) |
| Queue / cache | Redis |
| Frontend | Next.js + React + TypeScript |
| Simulation | TypeScript (in-process; extensible to workers later) |
| Testing | Vitest |
| Monorepo | npm workspaces |
| Deployment | Docker Compose |

The first version deliberately avoids: Kubernetes, microservice decomposition, blockchain, multi-chain, and complex message middleware.

## Monorepo boundaries

```
apps/api         # Fastify (Node + TS)
apps/dashboard   # Next.js
packages/core    # shared types & constants (Agent / Evidence / Score / dimension weights) ★ same source for frontend and backend
packages/scoring # credit engine (pure functions, pluggable score models)
packages/sdk     # SDK for external agent integration
packages/adapters# agent adapters (OpenClaw / OpenAI-compatible / HTTP)
simulator/       # simulation engine + market + economy
benchmark/       # benchmark lab
reputation/      # evidence / peer / graph / decay
attacks/         # attack lab
experiments/     # experiment definitions & results
```

Each module has its own README, tests, and dependency boundaries.

**Type sharing is a key architectural benefit**: `@acl/core` defines types such as `Dimension`, `Source`, `Agent`, and `Evidence`. `apps/api` and `apps/dashboard` both import the same definitions, preventing frontend/backend type drift.

## Core design decisions

1. **Append-only behavior data**: `evidence` / `credit_scores` / `score_snapshots` are append-only; corrections are made with new events, never by overwriting history.
2. **Modular scoring**: score models are pluggable and versioned, so different algorithms can coexist and be compared (baseline vs weighted vs graph vs evidence-aware).
3. **Evidence binding**: every score update must reference evidence (`evidence_refs`).
4. **Complete provenance**: experiments / benchmarks / scores record code_version, model_version, prompt_version, seed, environment, source_type.
5. **Data credibility labels**: `simulation | benchmark | real | verified | self-reported | synthetic`.

## API conventions

- REST first; internal events may use an event bus.
- All inputs are constrained by TypeScript types (`@acl/core`).
- Every mutation supports an idempotency key (enforced from Stage 2 onward).
- OpenAPI docs: via `@fastify/swagger` (planned for the end of Stage 1).

## Security baseline

- Executable agents: timeout, CPU/memory limits, tool allowlist, secret isolation, audit log.
- No arbitrary agent may directly control the host machine.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution and review process.
