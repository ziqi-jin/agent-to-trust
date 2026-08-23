import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agents } from '../db/schema';

interface AgentBody {
  name?: string;
  owner?: string;
  capabilities?: string[];
}

export async function agentsRoutes(app: FastifyInstance) {
  app.post('/agents', async (req, reply) => {
    const body = (req.body ?? {}) as AgentBody;
    if (!body.name || typeof body.name !== 'string') {
      return reply.code(400).send({ error: 'name 必填' });
    }
    const existing = await app.db.query.agents.findFirst({ where: eq(agents.name, body.name) });
    if (existing) {
      return reply.code(409).send({ error: `Agent 名称已存在：${body.name}` });
    }
    const [created] = await app.db
      .insert(agents)
      .values({
        id: randomUUID(),
        name: body.name,
        owner: body.owner ?? null,
        capabilities: body.capabilities ?? null,
      })
      .returning();
    return reply.code(201).send(created);
  });

  app.get('/agents', async () => {
    return app.db.query.agents.findMany({ orderBy: (a, { desc }) => [desc(a.createdAt)] });
  });

  app.get('/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await app.db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) return reply.code(404).send({ error: `Agent 不存在：${id}` });
    return agent;
  });
}
