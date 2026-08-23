/**
 * Drizzle ORM schema（PostgreSQL）。
 *
 * 数据不可变原则：evidence / credit_scores / score_snapshots 为 append-only，
 * 修正用新事件，不覆盖历史。
 */

import { index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  owner: text('owner'),
  status: text('status').notNull().default('active'),
  verificationLevel: text('verification_level').notNull().default('unverified'),
  capabilities: jsonb('capabilities').$type<string[]>(),
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
