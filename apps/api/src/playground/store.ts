/**
 * Playground 内存会话存储（单进程内存态，重启即清——自测场不需要持久化）。
 *
 * 红线：apiKey 绝不入 StoredSession——调用方把 key 从 ValidatedSessionInput 里
 * 拿走传给 runner 闭包，store 只存可公开序列化的会话状态。
 * TTL 1h：sweep(now) 就地清除过期会话，由路由层周期调用（unref 不阻塞退出）。
 */
import { randomUUID } from 'node:crypto';
import type { ValidatedSessionInput } from './scenario';

export type PgActor = 'system' | 'agent' | 'counterpart';

export type PgEventType =
  | 'scenario'
  | 'offer'
  | 'accept'
  | 'concede'
  | 'deal'
  | 'breakdown'
  | 'timeout'
  | 'error';

export interface PgEvent {
  seq: number;
  round: number;
  actor: PgActor;
  type: PgEventType;
  text: string;
  value?: number;
}

export interface Scorecard {
  result: 'success' | 'partial' | 'failure';
  dealValue: number | null;
  /** 0..1：线性 opening→0 / target→1（clamp）；未成交为 0。 */
  dealQuality: number;
  /** 0..1：有效报价轮数 / 实际轮数。 */
  protocolCompliance: number;
  roundsUsed: number;
}

export interface StoredSession {
  id: string;
  name: string;
  endpoint: string;
  status: 'running' | 'done' | 'failed';
  events: PgEvent[];
  scorecard?: Scorecard;
  error?: string;
  createdAt: number;
}

const TTL_MS = 3600_000;

export class PlaygroundStore {
  private readonly sessions = new Map<string, StoredSession>();

  create(input: ValidatedSessionInput): StoredSession {
    const session: StoredSession = {
      id: `pg-${randomUUID()}`,
      name: input.name,
      endpoint: input.endpoint,
      status: 'running',
      events: [],
      createdAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): StoredSession | undefined {
    return this.sessions.get(id);
  }

  sweep(now: number): void {
    for (const [id, s] of this.sessions) {
      if (now - s.createdAt > TTL_MS) this.sessions.delete(id);
    }
  }
}
