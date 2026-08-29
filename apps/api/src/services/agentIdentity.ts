/**
 * Agent 身份注册（考场 ingest 与 Arena register 共用）。
 *
 * 密钥即身份：agentId = ext-<slug>-<hash8(pubkey)>；同名不同钥 → name-taken (403)。
 * 保证同一实体在考场 / Arena / 榜单是唯一身份。
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { agents } from '../db/schema';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'agent'
  );
}

export interface IdentityInput {
  name: string;
  pubkey: string;
  /** 考场 ingest 携带被测 endpoint；Arena 注册不传则保留原值。 */
  endpoint?: string;
}

export interface IdentityResult {
  agentId: string;
  reused: boolean;
  error?: 'name-taken';
}

export async function upsertAgentIdentity(
  db: Database,
  input: IdentityInput,
): Promise<IdentityResult> {
  const existing = await db.query.agents.findFirst({ where: eq(agents.name, input.name) });
  if (existing) {
    if (existing.pubkey && existing.pubkey !== input.pubkey) {
      return { agentId: existing.id, reused: false, error: 'name-taken' };
    }
    await db
      .update(agents)
      .set({
        endpoint: input.endpoint !== undefined ? input.endpoint : existing.endpoint,
        lastSeenAt: new Date(),
      })
      .where(eq(agents.id, existing.id));
    return { agentId: existing.id, reused: true };
  }

  const agentId = `ext-${slugify(input.name)}-${createHash('sha256').update(input.pubkey).digest('hex').slice(0, 8)}`;
  await db
    .insert(agents)
    .values({
      id: agentId,
      name: input.name,
      owner: null,
      status: 'active',
      verificationLevel: 'basic',
      pubkey: input.pubkey,
      endpoint: input.endpoint ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoNothing();
  return { agentId, reused: false };
}
