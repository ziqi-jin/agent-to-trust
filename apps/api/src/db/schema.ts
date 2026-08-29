/**
 * Drizzle ORM schema（PostgreSQL）。
 *
 * 数据不可变原则：evidence / credit_scores / score_snapshots 为 append-only，
 * 修正用新事件，不覆盖历史。
 */

import { index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  owner: text('owner'),
  status: text('status').notNull().default('active'),
  verificationLevel: text('verification_level').notNull().default('unverified'),
  capabilities: jsonb('capabilities').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** SDK 上报绑定：密钥即身份，同一 agent 只有同一把钥能更新。 */
  pubkey: text('pubkey'),
  /** 被测 endpoint（endpoint 模式记录，供抽样复算）。 */
  endpoint: text('endpoint'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

/** 上报 nonce（防重放）：一次性，插入冲突即重放。 */
export const ingestNonces = pgTable('ingest_nonces', {
  nonce: text('nonce').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidence = pgTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    dimension: text('dimension').notNull(),
    source: text('source').notNull().default('simulation'),
    sourceType: text('source_type').notNull().default('simulation'),
    issuer: text('issuer'),
    result: text('result').notNull().default('success'),
    value: real('value'),
    severity: integer('severity'),
    evidenceUri: text('evidence_uri'),
    payloadHash: text('payload_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_evidence_agent_id').on(t.agentId)],
);

export const creditScores = pgTable(
  'credit_scores',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    score: integer('score'),
    adjustedScore: integer('adjusted_score'),
    confidence: real('confidence').notNull().default(0),
    coverage: real('coverage').notNull().default(0),
    freshnessDays: real('freshness_days'),
    modelVersion: text('model_version').notNull(),
    dimensions: jsonb('dimensions'),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_credit_scores_agent_id').on(t.agentId)],
);

export const scoreSnapshots = pgTable(
  'score_snapshots',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    score: integer('score'),
    modelVersion: text('model_version').notNull(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_score_snapshots_agent_id').on(t.agentId)],
);

export const simulationRuns = pgTable('simulation_runs', {
  id: text('id').primaryKey(),
  seed: integer('seed').notNull(),
  config: jsonb('config'),
  stats: jsonb('stats'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Arena 市场会话：两个 agent 的回合制交易场景（Phase 2）。 */
export const arenaSessions = pgTable('arena_sessions', {
  id: text('id').primaryKey(),
  scenario: text('scenario').notNull(),
  status: text('status').notNull().default('open'), // open | negotiating | settled | failed
  buyerAgentId: text('buyer_agent_id'),
  sellerAgentId: text('seller_agent_id'),
  taskSpec: jsonb('task_spec'),
  budget: real('budget'),
  deadline: timestamp('deadline', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** ACL 协议事件：append-only，验签后入库，seq 会话内单调、nonce 全局一次性。 */
export const arenaEvents = pgTable(
  'arena_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => arenaSessions.id),
    seq: integer('seq').notNull(),
    type: text('type').notNull(), // OFFER|NEGOTIATE|ACCEPT|REJECT|DELIVER|VERIFY_RESULT|SETTLE
    fromAgent: text('from_agent').notNull(),
    payload: jsonb('payload'),
    sig: text('sig').notNull(),
    nonce: text('nonce').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_arena_events_session_seq').on(t.sessionId, t.seq),
    uniqueIndex('uq_arena_events_nonce').on(t.nonce),
  ],
);
