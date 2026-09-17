import { describe, expect, it } from 'vitest';
import {
  BADGE_THRESHOLDS,
  BADGE_FRESHNESS_MIN,
  MIN_BADGE_EVIDENCE,
  badgesFor,
  type BadgeInput,
} from '../src/index';

// 验收维度映射：docs/TESTING.md（正确性 / 确定性 / 边界 / 红线）
// 设计稿：docs/specs/2026-09-12-badge-system-design.md §3

function input(partial: Partial<BadgeInput> & { dimension: BadgeInput['dimension'] }): BadgeInput {
  return { score: 0, realEvidenceCount: MIN_BADGE_EVIDENCE, ...partial };
}

describe('[正确性] 梯度判定', () => {
  it('低于 bronze → 不发勋章', () => {
    expect(badgesFor([input({ dimension: 'capability', score: 59 })])).toEqual([]);
  });

  it('恰好 bronze 阈值 → bronze', () => {
    expect(badgesFor([input({ dimension: 'capability', score: 60 })])).toEqual([
      { dimension: 'capability', tier: 'bronze', score: 60 },
    ]);
  });

  it('刚好到 silver → silver（不重复发 bronze）', () => {
    expect(badgesFor([input({ dimension: 'capability', score: 75 })])).toEqual([
      { dimension: 'capability', tier: 'silver', score: 75 },
    ]);
  });

  it('刚好到 gold → gold', () => {
    expect(badgesFor([input({ dimension: 'capability', score: 88 })])).toEqual([
      { dimension: 'capability', tier: 'gold', score: 88 },
    ]);
  });

  it('满分 → gold', () => {
    expect(badgesFor([input({ dimension: 'negotiation', score: 100 })])).toEqual([
      { dimension: 'negotiation', tier: 'gold', score: 100 },
    ]);
  });
});

describe('[红线] 只认真实证据 + 证据量下限', () => {
  it('真实证据不足 MIN_BADGE_EVIDENCE → 不发（防单条满分骗专家）', () => {
    expect(badgesFor([input({ dimension: 'capability', score: 100, realEvidenceCount: 2 })])).toEqual([]);
    expect(badgesFor([input({ dimension: 'capability', score: 100, realEvidenceCount: 3 })])).not.toEqual([]);
  });

  it('score 为 null（该维无证据）→ 不发', () => {
    expect(badgesFor([input({ dimension: 'capability', score: null })])).toEqual([]);
  });

  it('证据过期（freshnessFactor 低于下限）→ 不发', () => {
    expect(
      badgesFor([input({ dimension: 'capability', score: 95, freshnessFactor: BADGE_FRESHNESS_MIN - 0.01 })]),
    ).toEqual([]);
  });

  it('freshnessFactor 未提供 → 不因时效拦截（保持向后兼容）', () => {
    expect(badgesFor([input({ dimension: 'capability', score: 95 })])).toHaveLength(1);
  });
});

describe('[可解释性] 多维排序与「每维最高档」', () => {
  it('每维最多一枚，按维度固定顺序输出', () => {
    const out = badgesFor([
      input({ dimension: 'integrity', score: 90 }),
      input({ dimension: 'capability', score: 88 }),
      input({ dimension: 'negotiation', score: 100 }),
    ]);
    // 顺序来自 @a2t/core DIMENSIONS，不是输入顺序
    expect(out.map((b) => b.dimension)).toEqual(['capability', 'negotiation', 'integrity']);
  });

  it('同维输入多条 → 合并为最高档一枚', () => {
    const out = badgesFor([
      input({ dimension: 'capability', score: 60 }),
      input({ dimension: 'capability', score: 88 }),
    ]);
    expect(out).toEqual([{ dimension: 'capability', tier: 'gold', score: 88 }]);
  });
});

describe('[确定性] 同输入同输出', () => {
  it('重复调用一致', () => {
    const inputs = [input({ dimension: 'capability', score: 80 }), input({ dimension: 'security', score: 70 })];
    expect(badgesFor(inputs)).toEqual(badgesFor(inputs));
  });
});

describe('[数据完整性] 阈值表覆盖全部维度', () => {
  it('每个维度都有 bronze/silver/gold 且单调递增', () => {
    for (const [dim, t] of Object.entries(BADGE_THRESHOLDS)) {
      expect(t.bronze, dim).toBeLessThan(t.silver);
      expect(t.silver, dim).toBeLessThan(t.gold);
    }
  });
  it('阈值表含 8 个维度', () => {
    expect(Object.keys(BADGE_THRESHOLDS)).toHaveLength(8);
  });
});
