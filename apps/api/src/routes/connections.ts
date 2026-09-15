/**
 * /arena/connections — A2A 免 SDK 接入的登记面（Task 7）。
 *
 * 语义：用户登记自己的 A2A Agent Card URL，换取一枚 Bearer token（明文仅此一次返回），
 * 后续平台凭 token hash 校验直连调用。生命周期：
 * - POST   /arena/connections      body {agentId?|name?, cardUrl} → 201 {connectionId, token}
 * - GET    /arena/connections?agentId=...                        → 列表（绝不回 token/hash）
 * - DELETE /arena/connections/:id                                → 置 revokedAt（软删，幂等）
 *
 * 安全：
 * - SSRF 防护：cardUrl 必须可解析、http(s)、且 host 非环回/私网/链路本地（复用 playground 的
 *   isPublicEndpoint，与 ingest/playground 同一卡口，堵 ::ffff:127.0.0.1 之类的绕过）。
 * - token：32 字节 CSPRNG → base64url 明文仅返回一次；库内只存 sha256 hex（校验方同款）。
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentConnections, agents } from '../db/schema';
import { isPublicEndpoint } from '../playground/scenario';

/** 生成连接 token：32 字节随机 → base64url（≥32 bytes，满足红线）。 */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 存库 / 校验共用的 token 哈希：sha256 hex（明文永不落库）。 */
export function hashConnectionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 登记 body：cardUrl 必填；身份给出 agentId 或 name 二者其一。 */
const RegisterBody = z.object({
  cardUrl: z.string().min(1, 'cardUrl 必填'),
  agentId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

export async function connectionsRoutes(app: FastifyInstance): Promise<void> {
  /** 登记：解析身份 → SSRF 卡口 → 落库（只存 hash）→ 一次性回发明文 token。 */
  app.post('/arena/connections', async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'body 不合法：' + (parsed.error.issues[0]?.message ?? '') });
    }
    const { cardUrl, agentId: rawAgentId, name } = parsed.data;

    if (!rawAgentId && !name) {
      return reply.code(400).send({ error: 'agentId 或 name 至少提供一个' });
    }

    // SSRF 卡口：拒内网/保留地址与非 http(s) 协议——违反则绝不入库。
    if (!isPublicEndpoint(cardUrl)) {
      return reply.code(400).send({ error: 'cardUrl 必须是可解析的公网 http(s) URL' });
    }

    // 身份解析：给了 agentId 就用（须存在，找不到 404 不变）；否则按 name 找——
    // 找不到即**铸造**平台托管身份（Ruling 16：免 SDK 用户首登即建 agent，pubkey 暂空，
    // 开局时由 arenaQueue 绑平台公钥）。同名复用既有 agent（幂等）。
    let agentId = rawAgentId;
    if (!agentId) {
      const [found] = await app.db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.name, name as string));
      if (found) {
        agentId = found.id;
      } else {
        agentId = `ag-${randomUUID()}`;
        try {
          await app.db.insert(agents).values({
            id: agentId,
            name: name as string,
            pubkey: null,
            status: 'active',
          });
        } catch (e) {
          // 并发同名登记 TOCTOU：两个请求都 SELECT 未命中 → 输家 INSERT 撞 UNIQUE(name) 23505。
          // 收敛（不冒泡 500）：回头按 name 重选胜者行，复用其 id（幂等）。
          const code = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
          if (code !== '23505') throw e;
          const [winner] = await app.db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.name, name as string));
          if (!winner) throw e;
          agentId = winner.id;
        }
      }
    } else {
      const [found] = await app.db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, agentId));
      if (!found) return reply.code(404).send({ error: `agent「${agentId}」不存在` });
    }

    const token = generateToken();
    const id = `ac-${randomUUID()}`;
    await app.db.insert(agentConnections).values({
      id,
      agentId,
      cardUrl,
      tokenHash: hashConnectionToken(token),
    });

    return reply.code(201).send({ connectionId: id, token, agentId });
  });

  /** 列表：按 agentId 过滤（缺省列全部）；fields 白名单，绝不回 token/token_hash。 */
  app.get('/arena/connections', async (req) => {
    const { agentId } = req.query as { agentId?: string };
    const rows = await app.db
      .select({
        id: agentConnections.id,
        agentId: agentConnections.agentId,
        cardUrl: agentConnections.cardUrl,
        arenaReady: agentConnections.arenaReady,
        lastCheckedAt: agentConnections.lastCheckedAt,
        createdAt: agentConnections.createdAt,
        revokedAt: agentConnections.revokedAt,
      })
      .from(agentConnections)
      .where(agentId ? eq(agentConnections.agentId, agentId) : undefined)
      .orderBy(desc(agentConnections.createdAt), asc(agentConnections.id));
    return { connections: rows };
  });

  /** 撤销：置 revokedAt（软删）；重复调用幂等（仍 200）；不存在 → 404。 */
  app.delete('/arena/connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [conn] = await app.db
      .select({ id: agentConnections.id, revokedAt: agentConnections.revokedAt })
      .from(agentConnections)
      .where(eq(agentConnections.id, id));
    if (!conn) return reply.code(404).send({ error: '连接不存在' });

    if (!conn.revokedAt) {
      const revokedAt = new Date();
      await app.db
        .update(agentConnections)
        .set({ revokedAt })
        .where(eq(agentConnections.id, id));
      return { ok: true, id, revokedAt };
    }
    return { ok: true, id, revokedAt: conn.revokedAt };
  });
}
