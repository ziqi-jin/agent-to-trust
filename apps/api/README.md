# apps/api — Fastify 后端（Node + TypeScript）

Agent Credit Lab 的核心 API：Agent Registry / Evidence / AgentScore。

## 本地开发

```bash
# 在仓库根目录
npm install
docker compose up -d postgres
npm run dev:api
```

默认连 `postgres://acl:acl@localhost:5432/acl`（由 docker-compose 提供）。覆盖用 `DATABASE_URL`。

## 测试

```bash
npm test                    # 仓库根，跑 API 集成测试
npm run test:scoring        # 跑评分引擎单测
```

API 测试会重建 `acl_test` 数据库（需要本地 Postgres 已启动）。

## 关键接口

- `POST /agents` / `GET /agents` / `GET /agents/:id`
- `POST /agents/:id/evidence` / `GET /agents/:id/evidence`
- `POST /agents/:id/score` / `GET /agents/:id/score`
- `GET /health`

## 结构

```
src/
├── index.ts         # 启动入口（migrate + listen）
├── app.ts           # buildApp(db) 工厂（可测试）
├── db/
│   ├── schema.ts    # Drizzle schema（PostgreSQL）
│   ├── client.ts    # drizzle client
│   └── migrate.ts   # 幂等建表（Stage 2 起换 drizzle-kit）
└── routes/
    ├── agents.ts
    ├── evidence.ts
    └── scores.ts
```

## 打分引擎

评分逻辑在 `packages/scoring`（纯函数 `computeScore`，`baseline-v0.1`），API 只做数据读写与编排，保证引擎可独立测试、可被 Dashboard 复用。
