/**
 * API client — 与 @acl/api 通信。
 * API_BASE 通过 NEXT_PUBLIC_API_URL 配置：
 *  - dev：http://localhost:8000（Fastify 需开 CORS）
 *  - prod：/credit/api（走 nginx 同域代理，无跨域）
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/** GitHub 仓库地址（开源后接上；接上后 Star 按钮一键生效） */
export const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/ziqi-jin/open-agent-credit-lab';

// ── 类型（对应 API 序列化结果）─────────────────────────────

export interface Agent {
  id: string;
  name: string;
  owner: string | null;
  status: string;
  verificationLevel: string;
  capabilities: string[] | null;
  createdAt: string;
}

export interface Evidence {
  id: string;
  agentId: string;
  dimension: string;
  source: string;
  sourceType: string;
  issuer: string | null;
  result: 'success' | 'failure' | 'partial';
  value: number | null;
  severity: number | null;
  evidenceUri: string | null;
  payloadHash: string | null;
  createdAt: string;
}

export interface DimensionResult {
  dimension: string;
  score: number | null;
  weight: number;
  evidenceCount: number;
}

export interface ScoreResponse {
  agentId: string;
  score: number | null;
  adjustedScore: number | null;
  confidence: number;
  coverage: number;
  freshnessDays: number | null;
  modelVersion: string;
  dimensions: DimensionResult[];
  evidenceCount: number;
  evidenceRefs: string[];
  computedAt: string;
}

export interface LeaderboardEntry {
  agentId: string;
  name: string;
  status: string;
  verificationLevel: string;
  capabilities: string[];
  source: 'simulation' | 'benchmark' | 'manual' | 'real-benchmark';
  score: number | null;
  adjustedScore: number | null;
  confidence: number;
  coverage: number;
  evidenceCount: number;
  isSimulated: boolean;
  /** 行为分（非能力维度加权和，1000 制）。 */
  behaviorScore: number | null;
  /** 是否已进入 Arena（有行为证据）。 */
  inArena: boolean;
  /** 被测 agent 用的模型名（未上报为 null，前端显示 —）。 */
  model: string | null;
  /** 被测 agent 软件版本（未上报为 null）。 */
  agentVersion: string | null;
  rank: number;
}

export interface SimulationStats {
  agentCount: number;
  rounds: number;
  tasksCreated: number;
  contractsCreated: number;
  transactions: number;
  settled: number;
  failed: number;
  partial: number;
  totalValue: number;
  totalFees: number;
}

export interface StatsResponse {
  agentCount: number;
  evidenceCount: number;
  scoreCount: number;
  simulation: SimulationStats | null;
}

// ── 展示映射 ─────────────────────────────────────────────

export const DIMENSION_LABELS: Record<string, string> = {
  capability: '能力',
  reliability: '可靠性',
  delivery: '交付',
  economic: '经济',
  collaboration: '协作',
  security: '安全',
  negotiation: '谈判',
  integrity: '诚信',
};

export const SOURCE_LABELS: Record<string, string> = {
  simulation: '仿真',
  synthetic: '合成',
  'self-reported': '自报',
  benchmark: '基准测试',
  real: '真实',
  verified: '已验证',
};

export const RESULT_LABELS: Record<string, string> = {
  success: '成功',
  failure: '失败',
  partial: '部分',
};

/** 信用评级（FICO 式分档）。 */
export function gradeFor(score: number | null): { label: string; tone: 'gold' | 'accent' | 'info' | 'amber' | 'danger' | 'dim' } {
  if (score === null) return { label: '—', tone: 'dim' };
  if (score >= 800) return { label: 'AAA', tone: 'gold' };
  if (score >= 700) return { label: 'AA', tone: 'accent' };
  if (score >= 600) return { label: 'A', tone: 'accent' };
  if (score >= 500) return { label: 'BBB', tone: 'info' };
  if (score >= 400) return { label: 'BB', tone: 'info' };
  if (score >= 300) return { label: 'B', tone: 'amber' };
  if (score >= 200) return { label: 'CCC', tone: 'amber' };
  return { label: 'C', tone: 'danger' };
}

export function scoreTone(score: number | null): string {
  if (score === null) return 'text-dim';
  if (score >= 700) return 'text-accent';
  if (score >= 400) return 'text-amber';
  return 'text-danger';
}

export interface StatsSummary {
  /** 榜单1（考场榜）：持考场分的去重 agent 数 */
  leaderboard1Participants: number;
  /** 榜单2（行为榜）：参与过 Arena 会话的去重 agent 数（剔除平台对家） */
  leaderboard2Participants: number;
  /** 当前排队等待数（全部 lane） */
  queueWaiting: number;
}

// ── Playground 自测场（契约：docs/plans/2026-09-02-playground-p1.md Task 2/4/5）──

export type PgActor = 'system' | 'agent' | 'counterpart';
export type PgEventType =
  | 'scenario'
  | 'offer'
  | 'accept'
  | 'concede'
  | 'deal'
  | 'breakdown'
  | 'timeout';
export type PgStatus = 'running' | 'done' | 'failed';
export type PgResult = 'success' | 'partial' | 'failure';

/** 事件流单条（按 seq 升序）。 */
export interface PgEvent {
  seq: number;
  round: number;
  actor: PgActor;
  type: PgEventType;
  text: string;
  value?: number;
}

/** 终局评分卡。 */
export interface PgScorecard {
  result: PgResult;
  dealValue: number | null;
  /** 0..1，前端渲染为百分比。 */
  dealQuality: number;
  /** 0..1，前端渲染为百分比。 */
  protocolCompliance: number;
  roundsUsed: number;
}

/** 轮询返回的会话对象（apiKey 绝不出现）。 */
export interface PgSession {
  id: string;
  name: string;
  endpoint: string;
  status: PgStatus;
  events: PgEvent[];
  scorecard?: PgScorecard;
  error?: string;
  createdAt: string;
}

/** 官方场景模板（GET /playground/templates）。 */
export interface PlaygroundTemplate {
  id: string;
  name: string;
  desc: string;
  scenario: {
    brief: string;
    agentRole: string;
    counterpartRole: string;
    metricLabel: string;
    maxRounds: number;
    strategy: { opening: number; floor: number; step: number; target: number };
  };
}

export interface PlaygroundSessionBody {
  name?: string;
  endpoint: string;
  apiKey?: string;
  /** 可选：chat-completions 的 model 字段（DeepSeek/智谱等厂商直连必填）。 */
  model?: string;
  scenario: {
    templateId?: string;
    custom?: {
      brief: string;
      agentRole: string;
      counterpartRole: string;
      metricLabel: string;
      opening: number;
      floor: number;
      target: number;
      maxRounds?: number;
      style: 'tough' | 'balanced' | 'gentle';
    };
  };
}

/** 429 限流：带 Retry-After 秒数，UI 显示「太频繁，请 X 秒后再试」。 */
export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(seconds: number) {
    super(`太频繁，请 ${seconds} 秒后再试`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = seconds;
  }
}

// ── HTTP ─────────────────────────────────────────────────

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Playground 专用：与 http() 同款，但 429 读 Retry-After 折算成秒。 */
async function playgroundHttp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 429) {
    const raw = Number(res.headers.get('retry-after') ?? '60');
    throw new RateLimitError(Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 60);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listAgents: () => http<Agent[]>('/agents'),
  createAgent: (name: string, capabilities?: string[]) =>
    http<Agent>('/agents', { method: 'POST', body: JSON.stringify({ name, capabilities }) }),
  getAgent: (id: string) => http<Agent>(`/agents/${id}`),
  listEvidence: (id: string) => http<Evidence[]>(`/agents/${id}/evidence`),
  addEvidence: (id: string, payload: Record<string, unknown>) =>
    http<Evidence>(`/agents/${id}/evidence`, { method: 'POST', body: JSON.stringify(payload) }),
  computeScore: (id: string) => http<ScoreResponse>(`/agents/${id}/score`, { method: 'POST' }),
  getScore: (id: string) => http<ScoreResponse>(`/agents/${id}/score`),

  // 榜单 / 统计 / 证据流
  leaderboard: (board: 'capability' | 'behavior' = 'capability') =>
    http<LeaderboardEntry[]>(`/leaderboard?board=${board}`),
  stats: () => http<StatsResponse>('/stats'),
  statsSummary: () => http<StatsSummary>('/stats/summary'),
  submitFeedback: (message: string, contact?: string, page?: string) =>
    http<{ ok: boolean }>('/feedback', {
      method: 'POST',
      body: JSON.stringify({
        message,
        ...(contact ? { contact } : {}),
        ...(page ? { page } : {}),
      }),
    }),
  events: () => http<Evidence[]>('/events'),
  runSimulation: (cfg?: Record<string, unknown>) =>
    http<{ seeded: boolean; config: Record<string, unknown>; stats: SimulationStats }>(
      '/simulation/run',
      { method: 'POST', body: JSON.stringify(cfg ?? {}) },
    ),
  runBenchmark: () =>
    http<{ seeded: boolean; results?: Array<{ id: string; name: string; model: string; score: number | null }> }>(
      '/benchmark/run',
      { method: 'POST', body: '{}' },
    ),

  // Playground 自测场
  playgroundTemplates: () =>
    playgroundHttp<{ templates: PlaygroundTemplate[] }>('/playground/templates'),
  createPlaygroundSession: (body: PlaygroundSessionBody) =>
    playgroundHttp<{ id: string }>('/playground/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** 轮询用：会话不存在/已过期（TTL 1h）返回 null 而非抛错，便于停止轮询。 */
  getPlaygroundSession: async (id: string): Promise<PgSession | null> => {
    const res = await fetch(`${API_BASE}/playground/sessions/${encodeURIComponent(id)}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status === 404) return null;
    if (res.status === 429) {
      const raw = Number(res.headers.get('retry-after') ?? '60');
      throw new RateLimitError(Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 60);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as PgSession;
  },
};
