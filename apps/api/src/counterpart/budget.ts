/**
 * 成本护栏：单局 token 上限 + 全局日预算。
 * 单实例内存计数（与 arenaQueue 的内存队列同部署假设）；超限由调用方降级 scripted。
 */
export const LIVE_MAX_TOKENS_PER_SESSION = Number(process.env.ARENA_LIVE_MAX_TOKENS ?? 8000);
export const LIVE_DAILY_TOKEN_CAP = Number(process.env.ARENA_LIVE_DAILY_TOKEN_CAP ?? 200_000);

export interface SessionBudget {
  add(n: number): void;
  used(): number;
  over(): boolean;
}

export function newSessionBudget(): SessionBudget {
  let used = 0;
  return {
    add: (n) => { if (n > 0) used += n; },
    used: () => used,
    over: () => used >= LIVE_MAX_TOKENS_PER_SESSION,
  };
}

let daily = 0;

export function chargeDaily(n: number): void { if (n > 0) daily += n; }
export function dailyUsed(): number { return daily; }
export function dailyExceeded(): boolean { return daily >= LIVE_DAILY_TOKEN_CAP; }
export function resetBudgetForTests(): void { daily = 0; }
