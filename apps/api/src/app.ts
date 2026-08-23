import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db/client';
import { agentsRoutes } from './routes/agents';
import { evidenceRoutes } from './routes/evidence';
import { scoresRoutes } from './routes/scores';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export function buildApp(db: Database): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.register(agentsRoutes);
  app.register(evidenceRoutes);
  app.register(scoresRoutes);
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
