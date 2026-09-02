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

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export function buildApp(
  db: Database,
  opts: { playgroundFetchImpl?: typeof fetch } = {},
): FastifyInstance {
  const app = Fastify({ logger: false });
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
  app.register(playgroundRoutes, { fetchImpl: opts.playgroundFetchImpl });
  app.register(scoresRoutes);
  app.register(simulationRoutes);
  app.register(statsRoutes);
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
