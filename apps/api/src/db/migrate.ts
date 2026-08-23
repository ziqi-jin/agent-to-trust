/**
 * 建表迁移（幂等）。Stage 0/1 用手写 SQL；Stage 2 起改用 drizzle-kit 生成迁移。
 */

import { Pool } from 'pg';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner text,
  status text NOT NULL DEFAULT 'active',
  verification_level text NOT NULL DEFAULT 'unverified',
  capabilities jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id),
  dimension text NOT NULL,
  source text NOT NULL DEFAULT 'simulation',
  source_type text NOT NULL DEFAULT 'simulation',
  issuer text,
  result text NOT NULL DEFAULT 'success',
  value real,
  severity integer,
  evidence_uri text,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_agent_id ON evidence(agent_id);

CREATE TABLE IF NOT EXISTS credit_scores (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id),
  score integer,
  adjusted_score integer,
  confidence real NOT NULL DEFAULT 0,
  coverage real NOT NULL DEFAULT 0,
  freshness_days real,
  model_version text NOT NULL,
  dimensions jsonb,
  evidence_refs jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_scores_agent_id ON credit_scores(agent_id);

CREATE TABLE IF NOT EXISTS score_snapshots (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id),
  score integer,
  model_version text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_score_snapshots_agent_id ON score_snapshots(agent_id);

ALTER TABLE credit_scores ADD COLUMN IF NOT EXISTS coverage real NOT NULL DEFAULT 0;
`;

export async function migrate(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  await pool.query(MIGRATION_SQL);
  await pool.end();
}
