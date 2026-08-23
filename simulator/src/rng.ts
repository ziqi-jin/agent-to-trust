/**
 * @acl/simulator — 确定性 PRNG 工具。
 *
 * 仿真必须可复现：同 seed 同序列。mulberry32 是轻量、确定性的伪随机数生成器。
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 字符串哈希，用于把可读 seed 转成数值 seed。 */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 从底层 rng 派生的便捷随机工具。 */
export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** [0, 1) */
  float(): number {
    return this.next();
  }

  /** 整数 [min, max]（含边界） */
  int(min: number, max: number): number {
    return Math.floor(this.float() * (max - min + 1)) + min;
  }

  /** 均匀随机取一个元素。 */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** 以概率 p 返回 true。 */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** 浮点 [min, max) */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }
}
