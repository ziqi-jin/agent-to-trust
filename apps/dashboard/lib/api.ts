/**
 * API client — 与 @acl/api 通信。
 * API_BASE 通过 NEXT_PUBLIC_API_URL 配置：
 *  - dev：http://localhost:8000（Fastify 需开 CORS）
 *  - prod：/credit/api（走 nginx 同域代理，无跨域）
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

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
};
