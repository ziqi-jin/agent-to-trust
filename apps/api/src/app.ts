import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db/client';
import { agentsRoutes } from './routes/agents';
import { benchmarkRoutes } from './routes/benchmark';
import { evidenceRoutes } from './routes/evidence';
import { ingestRoutes } from './routes/ingest';
import { scoresRoutes } from './routes/scores';
import { simulationRoutes } from './routes/simulation';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export function buildApp(db: Database): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  // dev 跨域（dashboard 本地 localhost:3001 → API localhost:8000）
  app.register(cors, { origin: true });
  app.register(agentsRoutes);
  app.register(benchmarkRoutes);
  app.register(evidenceRoutes);
  app.register(ingestRoutes);
  app.register(scoresRoutes);
  app.register(simulationRoutes);
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
