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

CREATE TABLE IF NOT EXISTS simulation_runs (
  id text PRIMARY KEY,
  seed integer NOT NULL,
  config jsonb,
  stats jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_scores ADD COLUMN IF NOT EXISTS coverage real NOT NULL DEFAULT 0;

-- 真实数据接入（Phase 1 /ingest）
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pubkey text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS endpoint text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_version text;

-- T6 榜单上报开关（老大 2026-09-08 17:00 拍板）：默认上榜、可关；带默认值，无需数据回填
ALTER TABLE agents ADD COLUMN IF NOT EXISTS leaderboard_visible boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS ingest_nonces (
  nonce text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Arena（Phase 2 /arena：会话 + 事件流）
CREATE TABLE IF NOT EXISTS arena_sessions (
  id text PRIMARY KEY,
  scenario text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  buyer_agent_id text,
  seller_agent_id text,
  task_spec jsonb,
  budget real,
  deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 对家引擎模式落库（Task 7）：scripted（脚本买家，默认）| live（LLM 人格买家）
ALTER TABLE arena_sessions ADD COLUMN IF NOT EXISTS counterpart_mode text DEFAULT 'scripted';
ALTER TABLE arena_sessions ADD COLUMN IF NOT EXISTS counterpart_persona text;
ALTER TABLE arena_sessions ADD COLUMN IF NOT EXISTS counterpart_seed text;
ALTER TABLE arena_sessions ADD COLUMN IF NOT EXISTS counterpart_tokens integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS arena_events (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES arena_sessions(id),
  seq integer NOT NULL,
  type text NOT NULL,
  from_agent text NOT NULL,
  payload jsonb,
  sig text NOT NULL,
  nonce text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_events_session_seq ON arena_events(session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_events_nonce ON arena_events(nonce);

-- 测试准入队列（持久化）+ 用户反馈（2026-08-31）
CREATE TABLE IF NOT EXISTS test_queue (
  ticket text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id),
  lane text NOT NULL DEFAULT 'arena',
  status text NOT NULL DEFAULT 'waiting',
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  admitted_at timestamptz,
  done_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_test_queue_lane_status ON test_queue(lane, status);

-- 放行时要知道期望对家模式（Task 7）：持久排队路径曾丢 mode → 放行只能默认脚本。
ALTER TABLE test_queue ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'scripted';

CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  message text NOT NULL,
  contact text,
  page text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function migrate(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  await pool.query(MIGRATION_SQL);
  await pool.end();
}
