import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db/client';
import { agentsRoutes } from './routes/agents';
import { arenaQueueRoutes } from './routes/arenaQueue';
import { arenaRoutes } from './routes/arena';
import { badgeRoutes } from './routes/badge';
import { benchmarkRoutes } from './routes/benchmark';
import { evidenceRoutes } from './routes/evidence';
import { feedbackRoutes } from './routes/feedback';
import { ingestRoutes } from './routes/ingest';
import { playgroundRoutes } from './routes/playground';
import { scoresRoutes } from './routes/scores';
import { simulationRoutes } from './routes/simulation';
import { statsRoutes } from './routes/stats';
import { tradeEvidenceRoutes } from './routes/tradeEvidence';
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
  // dev 跨域（dashboard 本地 localhost:3001 → API localhost:8000）
  app.register(cors, { origin: true });
  app.register(agentsRoutes);
  app.register(arenaQueueRoutes);
  app.register(arenaRoutes);
  app.register(badgeRoutes);
  app.register(benchmarkRoutes);
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
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
