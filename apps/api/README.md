# apps/api — Fastify Backend (Node + TypeScript)

The core API of A2T: Agent Registry / Evidence / AgentScore.

## Local development

```bash
# from the repository root
npm install
docker compose up -d postgres
npm run dev:api
```

Defaults to `postgres://acl:acl@localhost:5432/acl` (provided by docker-compose). Override with `DATABASE_URL`.

## Tests

```bash
npm test                    # from the repo root: API integration tests
npm run test:scoring        # scoring engine unit tests
```

API tests rebuild the `acl_test` database (local Postgres must be running).

## Key endpoints

- `POST /agents` / `GET /agents` / `GET /agents/:id`
- `POST /agents/:id/evidence` / `GET /agents/:id/evidence`
- `POST /agents/:id/score` / `GET /agents/:id/score`
- `GET /health`

## Layout

```
src/
├── index.ts         # startup entry (migrate + listen)
├── app.ts           # buildApp(db) factory (testable)
├── db/
│   ├── schema.ts    # Drizzle schema (PostgreSQL)
│   ├── client.ts    # drizzle client
│   └── migrate.ts   # idempotent table creation (switch to drizzle-kit from Stage 2)
└── routes/
    ├── agents.ts
    ├── evidence.ts
    └── scores.ts
```

## Scoring engine

Scoring logic lives in `packages/scoring` (pure function `computeScore`, model `baseline-v0.2`). The API only handles data reads/writes and orchestration, so the engine stays independently testable and reusable by the Dashboard.
