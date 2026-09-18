import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db/client';
import { agentsRoutes } from './routes/agents';
import { agentVisibilityRoutes } from './routes/agentVisibility';
import { arenaQueueRoutes } from './routes/arenaQueue';
import { arenaRoutes } from './routes/arena';
import { badgeRoutes } from './routes/badge';
import { benchmarkRoutes } from './routes/benchmark';
import { connectionsRoutes } from './routes/connections';
import { evidenceRoutes } from './routes/evidence';
import { feedbackRoutes } from './routes/feedback';
import { ingestRoutes } from './routes/ingest';
import { playgroundRoutes } from './routes/playground';
import { scoresRoutes } from './routes/scores';
import { simulationRoutes } from './routes/simulation';
import { statsRoutes } from './routes/stats';
import { tradeEvidenceRoutes } from './routes/tradeEvidence';
import { visitsRoutes } from './routes/visits';
import type { PlaygroundQueueOpts } from './playground/queue';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export function buildApp(
  db: Database,
  opts: { playgroundFetchImpl?: typeof fetch; playgroundQueueOpts?: PlaygroundQueueOpts } = {},
): FastifyInstance {
  // trustProxy：线上 API 藏在 nginx 反代后面，X-Forwarded-For 由 nginx 注入。
  // 不设的话所有用户 req.ip 都是网关 IP，per-IP 限流退化成全站共一个桶（0903 实锤）。
  // 只信任私网段对端（docker/nginx），公网直连伪造 XFF 无效。
  const app = Fastify({ logger: false, trustProxy: 'uniquelocal' });
  app.decorate('db', db);
  // CORS 白名单：默认放行两个生产域名 + 本地 dev（dashboard:3001 / 8000）。
  // 生产可用 CORS_ORIGINS 覆盖（逗号分隔）。不再对任意 origin 反射（开源后收紧）。
  const corsOrigins = (process.env.CORS_ORIGINS ??
    'https://sealit.cc,https://www.sealit.cc,https://reeftavern.cc,https://www.reeftavern.cc,http://localhost:3001,http://localhost:8000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.register(cors, {
    origin: (origin, cb) => {
      // 无 Origin（curl / 服务端调用 / 同源）放行。
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  });
  app.register(agentsRoutes);
  app.register(agentVisibilityRoutes);
  app.register(arenaQueueRoutes);
  app.register(arenaRoutes);
  app.register(badgeRoutes);
  app.register(benchmarkRoutes);
  app.register(connectionsRoutes);
  app.register(evidenceRoutes);
  app.register(feedbackRoutes);
  app.register(ingestRoutes);
  app.register(playgroundRoutes, {
    fetchImpl: opts.playgroundFetchImpl,
    queueOpts: opts.playgroundQueueOpts,
  });
  app.register(scoresRoutes);
  app.register(simulationRoutes);
  app.register(statsRoutes);
  app.register(tradeEvidenceRoutes);
  app.register(visitsRoutes);
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
