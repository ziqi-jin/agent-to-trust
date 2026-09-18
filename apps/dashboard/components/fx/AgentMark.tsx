/**
 * AgentMark — A2T 的 Agent 角色（原创）。
 *
 * 一颗带面罩的小机器人头：外形 / 眼睛 / 天线 / 强调色由 seed（通常是 agent 注册名）确定性派生，
 * 同一个 agent 在全站永远是同一张「脸」——榜单、证据流、档案页、自测场一眼认出。
 * 动效：眼睛不定时眨眼、横条眼来回扫描、天线尖端呼吸；悬停（父级 .group）时脸微微前倾。
 * 纯 SVG + CSS，无外部资源。
 */

export type AgentVariant = {
  shape: 0 | 1; // 0 圆角方头 · 1 六角头
  eyes: 0 | 1 | 2 | 3; // 双点 · 扫描条 · 独眼镜头 · 箭形
  antenna: 0 | 1 | 2 | 3; // 单天线 · 双天线 · 顶鳍 · 光环
  accent: string;
};

const ACCENTS = ['#FF6A1F', '#3DD68C', '#F5A524', '#E8B84A'];

/** FNV-1a：稳定的字符串哈希。 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function variantFor(seed: string): AgentVariant {
  const h = hash(seed || 'agent');
  return {
    shape: (h & 1) as 0 | 1,
    eyes: ((h >>> 1) % 4) as AgentVariant['eyes'],
    antenna: ((h >>> 3) % 4) as AgentVariant['antenna'],
    accent: ACCENTS[(h >>> 5) % ACCENTS.length],
  };
}

export function AgentMark({
  seed = 'agent',
  size = 32,
  variant,
  verified = false,
  className = '',
  title,
}: {
  seed?: string;
  size?: number;
  /** 显式外观（对手人格等固定角色用）；缺省按 seed 派生。 */
  variant?: Partial<AgentVariant>;
  verified?: boolean;
  className?: string;
  title?: string;
}) {
  const v = { ...variantFor(seed), ...variant };
  const a = v.accent;
  const top = v.shape === 1 ? 9 : 12; // 头顶 y
  const delay = `${-(hash(seed) % 5000)}ms`; // 每个 agent 眨眼节奏不同

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`shrink-0 overflow-visible ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g className="agent-face">
        {/* 天线 */}
        {v.antenna === 0 && (
          <>
            <line x1="24" y1={top} x2="24" y2={top - 6} stroke="#3A3A42" strokeWidth="2" strokeLinecap="round" />
            <circle className="agent-tip" cx="24" cy={top - 7.5} r="2.4" fill={a} style={{ animationDelay: delay }} />
          </>
        )}
        {v.antenna === 1 && (
          <>
            <line x1="18" y1={top + 1} x2="14.5" y2={top - 5} stroke="#3A3A42" strokeWidth="2" strokeLinecap="round" />
            <line x1="30" y1={top + 1} x2="33.5" y2={top - 5} stroke="#3A3A42" strokeWidth="2" strokeLinecap="round" />
            <circle className="agent-tip" cx="14" cy={top - 6} r="2" fill={a} style={{ animationDelay: delay }} />
            <circle className="agent-tip" cx="34" cy={top - 6} r="2" fill={a} />
          </>
        )}
        {v.antenna === 2 && <rect x="19" y={top - 5} width="10" height="6" rx="2.5" fill="#3A3A42" />}
        {v.antenna === 3 && (
          <ellipse className="agent-tip" cx="24" cy={top - 5} rx="9" ry="2.4" fill="none" stroke={a} strokeWidth="1.6" />
        )}

        {/* 耳 */}
        <rect x="4.5" y="22" width="4" height="9" rx="2" fill="#3A3A42" />
        <rect x="39.5" y="22" width="4" height="9" rx="2" fill="#3A3A42" />

        {/* 头 */}
        {v.shape === 0 ? (
          <rect x="8" y={top} width="32" height="29" rx="10" fill="#17171B" stroke="#44444D" strokeWidth="1.5" />
        ) : (
          <path
            d="M24 9 L39.5 17.5 V32.5 L24 41 L8.5 32.5 V17.5 Z"
            fill="#17171B"
            stroke="#44444D"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        )}

        {/* 面罩 */}
        <rect x="12.5" y="19.5" width="23" height="12" rx="6" fill="#050506" stroke={a} strokeOpacity="0.45" />

        {/* 眼 */}
        <g className="agent-eyes" style={{ animationDelay: delay }}>
          {v.eyes === 0 && (
            <>
              <circle cx="19.5" cy="25.5" r="2.5" fill={a} />
              <circle cx="28.5" cy="25.5" r="2.5" fill={a} />
            </>
          )}
          {v.eyes === 1 && (
            <>
              <rect x="16" y="24.3" width="16" height="2.6" rx="1.3" fill={a} opacity="0.35" />
              <rect className="agent-scan" x="21" y="24" width="6" height="3.2" rx="1.6" fill={a} />
            </>
          )}
          {v.eyes === 2 && (
            <>
              <circle cx="24" cy="25.5" r="4" fill={a} />
              <circle cx="24" cy="25.5" r="1.6" fill="#050506" />
            </>
          )}
          {v.eyes === 3 && (
            <path
              d="M16.5 27.2 l3 -3 3 3 M25.5 27.2 l3 -3 3 3"
              fill="none"
              stroke={a}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>

        {/* 状态灯 */}
        <rect x="20.5" y="34.5" width="7" height="1.8" rx="0.9" fill={verified ? '#3DD68C' : '#3A3A42'} />
      </g>

      {/* verified：右下角一枚小印章 */}
      {verified && (
        <g>
          <circle cx="39" cy="39" r="7" fill="#FF6A1F" stroke="#09090B" strokeWidth="2" />
          <path d="M35.8 39.2 l2.2 2.2 4.2 -4.4" fill="none" stroke="#09090B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
