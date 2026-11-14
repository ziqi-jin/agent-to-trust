/**
 * Drizzle ORM schema（PostgreSQL）。
 *
 * 数据不可变原则：evidence / credit_scores / score_snapshots 为 append-only，
 * 修正用新事件，不覆盖历史。
 */

import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { DimensionResult } from '@a2t/scoring';

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
  /** 展示用：被测 agent 用的模型名（显式上报，未提供为空）。 */
  model: text('model'),
  /** 展示用：被测 agent 软件版本（如 claude-code 2.1.258）。 */
  agentVersion: text('agent_version'),
  /**
   * T6 榜单上报开关（老大 2026-09-08 17:00 拍板，设计冻结）：默认上榜、可关。
   * 一个开关管两榜（capability/behavior）；opt-out 后详情页直链保留（unlisted 先例）。
   * 信用数据采集不受影响——只控公开榜单展示。
   */
  leaderboardVisible: boolean('leaderboard_visible').notNull().default(true),
  /**
   * 归一化名字（唯一性判定层；展示名保留原样）。2026-09-26 防抢名（Task 2）。
   * 可空（R2 裁决）：全仓另有 4 处 agents 插入路径与约 15 个测试文件直插库不带归一化名，
   * NOT NULL 会全部炸掉；T3 起在 ingest 路径写值。唯一性靠部分唯一索引（仅约束非空值）。
   */
  nameNormalized: text('name_normalized'),
}, (t) => [
  // 索引真源在 migrate.ts（同款 SQL）；此处声明与 uq_arena_events_* 同惯例，防 drizzle-kit 阶段漂移
  uniqueIndex('uq_agents_name_normalized')
    .on(t.nameNormalized)
    .where(sql`name_normalized IS NOT NULL`),
]);

/** 认领挑战（一次性，5 分钟有效）：challenge 即凭证号，后续 /verify 一次性校验用。 */
export const verifyChallenges = pgTable('verify_challenges', {
  challenge: text('challenge').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    /** 重考收口（2026-09-27）：被新卷取代/作废的证据打退役时间戳。append-only：只标记不删除。 */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
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
    /** 一期加列（不回填）：快照时点的 8 维明细。历史行为 NULL，读侧必须容忍。 */
    dimensionsSnapshot: jsonb('dimensions_snapshot').$type<DimensionResult[]>(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_score_snapshots_agent_id').on(t.agentId)],
);

/** 测试准入队列（持久化）：服务重启不丢，排队可见。 */
export const testQueue = pgTable(
  'test_queue',
  {
    ticket: text('ticket').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    /** 准入通道：arena（行为榜虚拟环境）| exam（考场资格，预留口子）。 */
    lane: text('lane').notNull().default('arena'),
    /** waiting → admitted → active → done / cancelled。 */
    status: text('status').notNull().default('waiting'),
    /** 期望对家模式：'scripted'|'live'（arena lane 放行时据此建会话；非平台对家场次不用）。 */
    mode: text('mode').notNull().default('scripted'),
    /** 撮合成功后关联的 Arena 会话。 */
    sessionId: text('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    admittedAt: timestamp('admitted_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => [index('idx_test_queue_lane_status').on(t.lane, t.status)],
);

/** 用户反馈（隐蔽入口收集）：append-only；handledAt 非空 = 摘要已读走，腾出箱容量。 */
export const feedback = pgTable('feedback', {
  id: text('id').primaryKey(),
  message: text('message').notNull(),
  contact: text('contact'),
  page: text('page'),
  userAgent: text('user_agent'),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  /** 对家引擎模式：'scripted'（脚本买家，默认）| 'live'（LLM 人格买家）。 */
  counterpartMode: text('counterpart_mode').default('scripted'),
  /** 本局抽中的人格 id（scripted 恒 'scripted'；live 为 llm-* 之一）。 */
  counterpartPersona: text('counterpart_persona'),
  /** 抽签/参数抖动 seed（可复现）。 */
  counterpartSeed: text('counterpart_seed'),
  /** live 引擎本局消耗 token 数（计费/审计用）。 */
  counterpartTokens: integer('counterpart_tokens').default(0),
  /** 接入适配器：'polling'（默认，轮询托管对家）| 'a2a'（Agent2Agent 直连）。 */
  adapter: text('adapter').notNull().default('polling'),
  /** A2A 对家的 agent card URL（adapter='a2a' 时有值）。 */
  a2aCardUrl: text('a2a_card_url'),
  /** A2A 会话总轮数（adapter='a2a' 时统计）。 */
  a2aRounds: integer('a2a_rounds'),
  /** A2A 会话中无效轮数（adapter='a2a' 时统计）。 */
  a2aInvalidRounds: integer('a2a_invalid_rounds'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A2T 协议事件：append-only，验签后入库，seq 会话内单调、nonce 全局一次性。 */
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

/** A2A 接入连接：agent ↔ 其 agent card 的登记与健康状态（免 SDK 直连入口）。 */
export const agentConnections = pgTable(
  'agent_connections',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    cardUrl: text('card_url').notNull(),
    tokenHash: text('token_hash').notNull(),
    arenaReady: boolean('arena_ready').notNull().default(false),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('idx_agent_connections_agent_id').on(t.agentId)],
);

/**
 * Content-addressed release. The fingerprint commits to version label, config,
 * tools, and evaluation conditions. The version label is not the identity.
 */
export const provenanceReleases = pgTable('provenance_releases', {
  fingerprint: text('fingerprint').primaryKey(),
  schemaVersion: text('schema_version').notNull(),
  versionLabel: text('version_label').notNull(),
  configHash: text('config_hash').notNull(),
  tools: jsonb('tools').$type<string[]>().notNull(),
  evalConditions: jsonb('eval_conditions').$type<Record<string, string>>().notNull(),
  material: jsonb('material').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A signature proves this key signed the release record. It does not prove exclusivity. */
export const provenanceReleaseSignatures = pgTable(
  'provenance_release_signatures',
  {
    id: text('id').primaryKey(),
    fingerprint: text('fingerprint')
      .notNull()
      .references(() => provenanceReleases.fingerprint),
    publisherPubkey: text('publisher_pubkey').notNull(),
    publisherAgentId: text('publisher_agent_id')
      .notNull()
      .references(() => agents.id),
    nonce: text('nonce').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_provenance_release_signer').on(t.fingerprint, t.publisherPubkey),
    index('idx_provenance_signatures_agent').on(t.publisherAgentId),
  ],
);

/** One running copy. Capacity here is self-declared and is not a credit input. */
export const provenanceInstances = pgTable(
  'provenance_instances',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    releaseFingerprint: text('release_fingerprint')
      .notNull()
      .references(() => provenanceReleases.fingerprint),
    operatorDeclaration: text('operator_declaration'),
    declaredCapacity: integer('declared_capacity'),
    capacityAssurance: text('capacity_assurance').notNull().default('self-declared'),
    licenseAssertion: text('license_assertion'),
    licenseAssurance: text('license_assurance').notNull().default('self-declared'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_provenance_instances_agent').on(t.agentId)],
);

/** Scope binding. Capability may later be referenced; the other scopes may not. */
export const provenanceEvidenceBindings = pgTable('provenance_evidence_bindings', {
  evidenceId: text('evidence_id')
    .primaryKey()
    .references(() => evidence.id),
  scope: text('scope').notNull(),
  releaseFingerprint: text('release_fingerprint').references(() => provenanceReleases.fingerprint),
  instanceId: text('instance_id').references(() => provenanceInstances.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Pointer from an instance to capability evidence recorded for the same release. */
export const provenanceReferences = pgTable(
  'provenance_references',
  {
    id: text('id').primaryKey(),
    targetInstanceId: text('target_instance_id')
      .notNull()
      .references(() => provenanceInstances.id),
    targetAgentId: text('target_agent_id')
      .notNull()
      .references(() => agents.id),
    sourceEvidenceId: text('source_evidence_id')
      .notNull()
      .references(() => evidence.id),
    sourceAgentId: text('source_agent_id')
      .notNull()
      .references(() => agents.id),
    releaseFingerprint: text('release_fingerprint').notNull(),
    assurance: text('assurance').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_provenance_reference_once').on(t.targetInstanceId, t.sourceEvidenceId),
    index('idx_provenance_references_agent').on(t.targetAgentId),
  ],
);

/**
 * Self-reported task claim. It is not exam evidence and it is not a scored row.
 * assurance and counts_toward_score are constrained so a client cannot store
 * an "independently verified" outcome.
 */
export const fulfillmentRecords = pgTable(
  'fulfillment_records',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    instanceId: text('instance_id').references(() => provenanceInstances.id),
    taskId: text('task_id').notNull(),
    outcome: text('outcome').notNull(),
    summary: text('summary').notNull(),
    payloadHash: text('payload_hash').notNull(),
    assurance: text('assurance').notNull().default('self-reported'),
    countsTowardScore: boolean('counts_toward_score').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_fulfillment_agent_task').on(t.agentId, t.taskId),
    index('idx_fulfillment_agent').on(t.agentId),
  ],
);
