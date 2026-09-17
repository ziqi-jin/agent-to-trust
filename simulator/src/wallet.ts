/**
 * @a2t/simulator — 虚拟钱包。
 *
 * 纯内存账本，只做 buyer → provider 转账，不创造/销毁资金（守恒）。
 * 这是 MVP 的虚拟经济，非真实资金。
 */
import type { SimAgent } from './types';

export class Wallet {
  private balances: Map<string, number>;

  constructor(agents: SimAgent[]) {
    this.balances = new Map(agents.map((a) => [a.id, a.wallet]));
  }

  get(agentId: string): number {
    return this.balances.get(agentId) ?? 0;
  }

  canPay(agentId: string, amount: number): boolean {
    return this.get(agentId) >= amount;
  }

  transfer(from: string, to: string, amount: number): void {
    if (amount <= 0) return;
    this.balances.set(from, this.get(from) - amount);
    this.balances.set(to, this.get(to) + amount);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.balances);
  }

  /** 总余额（守恒校验用：应为 agentCount × initialWallet）。 */
  total(): number {
    let sum = 0;
    for (const v of this.balances.values()) sum += v;
    return sum;
  }
}
