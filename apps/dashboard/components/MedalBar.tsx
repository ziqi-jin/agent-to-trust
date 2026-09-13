'use client';

import { useId } from 'react';
import {
  Brain,
  RefreshCw,
  Package,
  Coins,
  Handshake,
  ShieldCheck,
  Scale,
  Fingerprint,
} from 'lucide-react';
import { DIMENSIONS, type Dimension } from '@acl/core';
import { useT } from '@/lib/i18n';
import type { DimensionBadge } from '@/lib/api';

/**
 * MedalBar — 维度勋章条（0912 老大拍板：套 B 六角封蜡章）。
 *
 * 母版：**平顶六边形**（封蜡/钢印语义，圆形头像堆里一眼跳出）。
 * 档位编码 = **填充度**（小尺寸下唯一可靠的形状信号，灰度/色盲均可辨）：
 *   入门 = 描边（空心）· 进阶 = 上半填充 · 专家 = 实心（字形反白）
 * 颜色只用设计 token：入门 amber / 进阶 dim / 专家 brass（顶档与 AAA·前三同色）。
 * 未解锁 = 灰档虚线描边（可见、不抢戏）。
 * 每维最多一枚（后端取最高档）。
 */

const ICONS: Record<Dimension, typeof Brain> = {
  capability: Brain,
  reliability: RefreshCw,
  delivery: Package,
  economic: Coins,
  collaboration: Handshake,
  security: ShieldCheck,
  negotiation: Scale,
  integrity: Fingerprint,
};

type Tier = 'bronze' | 'silver' | 'gold';

/** 档位 → 颜色 token + 填充模式。
 * 色阶单调递增：dim（棕灰）→ amber（燃橙）→ brass（黄铜）；配合填充度形成双通道。 */
const TIER_META: Record<Tier, { tone: string; fill: 'none' | 'half' | 'full' }> = {
  bronze: { tone: 'text-dim', fill: 'none' },
  silver: { tone: 'text-amber', fill: 'half' },
  gold: { tone: 'text-brass', fill: 'full' },
};

/** 平顶六边形（viewBox 0 0 24 24）：上下为平边，留出底部放字形。 */
const HEX = '7,3 17,3 22,12 17,21 7,21 2,12';

/** 单枚勋章。badge 缺省 = 未解锁灰档。 */
export function Medal({
  dimension,
  badge,
  size = 19,
}: {
  dimension: Dimension;
  badge?: DimensionBadge;
  size?: number;
}) {
  const t = useT();
  const uid = useId().replace(/:/g, '');
  const Icon = ICONS[dimension];
  const meta = badge ? TIER_META[badge.tier] : null;
  const dimName = t.dimensions[dimension] ?? dimension;
  const title = badge
    ? `${dimName} · ${t.medal.tiers[badge.tier]} · ${badge.score}`
    : `${dimName} · ${t.medal.locked}`;

  // 字形反白只发生在实心（专家）档；未解锁降透明度（但提到可辨的对比，非幽灵）。
  const iconTone = meta?.fill === 'full' ? 'text-paper' : badge ? 'text-ink' : 'text-dim/45';

  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center ${
        meta ? meta.tone : 'text-dim/60'
      }`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
      role="img"
    >
      <svg viewBox="0 0 24 24" width={size} height={size} className="absolute inset-0" aria-hidden>
        {meta?.fill === 'half' && (
          <defs>
            {/* 上半填充：硬切 50%，灰度下与描边/实心区分。 */}
            <linearGradient id={`mf-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.5" stopColor="currentColor" />
              <stop offset="0.5" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        <polygon
          points={HEX}
          className={
            !badge
              ? 'fill-panel'
              : meta?.fill === 'full'
                ? 'fill-current'
                : meta?.fill === 'half'
                  ? ''
                  : 'fill-transparent'
          }
          {...(badge && meta?.fill === 'half' ? { fill: `url(#mf-${uid})` } : {})}
          stroke="currentColor"
          strokeWidth={badge ? 1.7 : 1.35}
          strokeLinejoin="round"
          {...(!badge ? { strokeDasharray: '2.6 2.1' } : {})}
        />
      </svg>
      <Icon
        size={Math.round(size * 0.52)}
        strokeWidth={2}
        className={`relative ${iconTone}`}
        aria-hidden
      />
    </span>
  );
}

/**
 * 勋章条：按 DIMENSIONS 固定顺序展示。
 * showLocked=true 时补灰档（默认，老大 0912 拍板「显示灰档」）。
 */
export function MedalBar({
  badges,
  size = 19,
  showLocked = true,
  className = '',
}: {
  badges: DimensionBadge[];
  size?: number;
  showLocked?: boolean;
  className?: string;
}) {
  const map = new Map((badges ?? []).map((b) => [b.dimension, b]));
  const dims = showLocked ? DIMENSIONS : DIMENSIONS.filter((d) => map.has(d));
  if (dims.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {dims.map((d) => (
        <Medal key={d} dimension={d} badge={map.get(d)} size={size} />
      ))}
    </span>
  );
}
