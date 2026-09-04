/**
 * Playground 全局队列（0903 老大指令：playground 要有队列，否则网站扛不住）。
 *
 * 语义（单进程内存态，Node 单线程，enqueue/dispatch 同步段完成，无竞态）：
 * - 全局并发上限 maxActive（env PG_MAX_ACTIVE，默认 6）：在跑会话达到上限即排队
 * - FIFO 等待队列 maxWaiting（env PG_QUEUE_MAX_WAITING，默认 60）：满则由路由层 503 快速拒绝
 * - 等待超时 waitTimeoutMs（env PG_QUEUE_WAIT_TIMEOUT_MS，默认 3min）：超时判 failed「排队超时」，
 *   onAbandon 归还 per-IP 限流额度——排队不该白烧用户的小时配额
 * - 会话状态机：queued →（有空位 dispatch）running →（runner 定终局）done/failed；超时 queued → failed
 *
 * 与 Arena 准入队列（routes/arenaQueue.ts）的差异：playground 是匿名自测场，无身份无落库，
 * 重启即清空——纯内存队列够用，不需要 testQueue 持久化。
 */
import type { StoredSession } from './store';

export interface PlaygroundQueueOpts {
  maxActive?: number;
  maxWaiting?: number;
  waitTimeoutMs?: number;
}

const DEFAULT_MAX_ACTIVE = 6;
const DEFAULT_MAX_WAITING = 60;
const DEFAULT_WAIT_TIMEOUT_MS = 180_000;

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface WaitingEntry {
  sessionId: string;
  start: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PlaygroundQueue {
  private active = 0;
  private readonly waiting: WaitingEntry[] = [];
  private readonly maxActive: number;
  private readonly maxWaiting: number;
  private readonly waitTimeoutMs: number;

  constructor(opts: PlaygroundQueueOpts = {}) {
    this.maxActive = Math.max(1, opts.maxActive ?? envNum('PG_MAX_ACTIVE', DEFAULT_MAX_ACTIVE));
    this.maxWaiting = Math.max(0, opts.maxWaiting ?? envNum('PG_QUEUE_MAX_WAITING', DEFAULT_MAX_WAITING));
    this.waitTimeoutMs = opts.waitTimeoutMs ?? envNum('PG_QUEUE_WAIT_TIMEOUT_MS', DEFAULT_WAIT_TIMEOUT_MS);
  }

  /** 等待队列是否已满（路由层须在消耗限流配额之前调用，满则 503 快速失败）。 */
  isFull(): boolean {
    return this.waiting.length >= this.maxWaiting;
  }

  /** 排队位置（1 起）；不在队列返回 null。 */
  positionOf(sessionId: string): number | null {
    const idx = this.waiting.findIndex((e) => e.sessionId === sessionId);
    return idx >= 0 ? idx + 1 : null;
  }

  /**
   * 提交一局：有空位立即开跑（session.status → running），否则排队（保持 queued）。
   * task = 本局执行体（内部自行处理异常与终局状态）；
   * onAbandon = 排队超时未开跑时的善后（归还 per-IP 限流额度）。
   */
  run(session: StoredSession, task: () => Promise<void>, onAbandon?: () => void): void {
    if (this.active < this.maxActive) {
      this.start(session, task);
      return;
    }
    const entry: WaitingEntry = {
      sessionId: session.id,
      start: () => this.start(session, task),
      timer: setTimeout(() => {
        const idx = this.waiting.indexOf(entry);
        if (idx >= 0) this.waiting.splice(idx, 1);
        session.status = 'failed';
        session.error =
          session.locale === 'en'
            ? 'Queue timed out (heavy load right now) — please try again later.'
            : '排队超时（当前开局较多），请稍后再试';
        onAbandon?.();
      }, this.waitTimeoutMs),
    };
    entry.timer.unref?.(); // 不阻止进程退出
    this.waiting.push(entry);
  }

  private start(session: StoredSession, task: () => Promise<void>): void {
    session.status = 'running';
    this.active += 1;
    void task().finally(() => {
      this.active -= 1;
      this.dispatchNext();
    });
  }

  private dispatchNext(): void {
    const next = this.waiting.shift();
    if (!next) return;
    clearTimeout(next.timer);
    next.start();
  }
}
