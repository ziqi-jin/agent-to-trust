'use client';

import { gradeFor } from '@/lib/api';

/**
 * ScoreSeal — 签名元素：圆形信用印章。
 * 环形字 "AGENT CREDIT LAB · EVIDENCE REGISTER"，中心 = 分数 + 等级字母。
 * 印泥红 = 已经过真实评测（benchmark 来源）；灰墨 = 未测。
 * 旋转由 rank 确定性推导（-7°~+7°），stamp-in 动画按 rank 错落。
 */
export function ScoreSeal({
  score,
  tested,
  rank = 1,
  size = 76,
  delayMs,
}: {
  score: number | null;
  tested: boolean;
  rank?: number;
  size?: number;
  delayMs?: number;
}) {
  const rot = ((rank * 37) % 15) - 7;
  const ink = tested ? '#BF3B2B' : '#98A093';
  const grade = tested && score !== null ? gradeFor(score).label : '';
  const pathId = `seal-ring-${rank}-${score ?? 'na'}-${tested ? 't' : 'u'}`;

  return (
    <div
      className={`stamp-in shrink-0 ${tested ? 'opacity-90' : 'opacity-70'}`}
      style={
        {
          '--rot': `${rot}deg`,
          transform: `rotate(${rot}deg)`,
          animationDelay: delayMs != null ? `${delayMs}ms` : undefined,
          mixBlendMode: 'multiply',
        } as React.CSSProperties
      }
      title={
        score === null
          ? '未测：尚无证据，无评级'
          : tested
            ? `信用分 ${score}/1000 · 等级 ${grade || '—'}`
            : `分数 ${score}/1000（待验证）`
      }
    >
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
        <defs>
          <path id={pathId} d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" fill="none" />
        </defs>
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="none"
          stroke={ink}
          strokeWidth="2"
          strokeDasharray={tested ? undefined : '3 3'}
        />
        <circle cx="50" cy="50" r="29.5" fill="none" stroke={ink} strokeWidth="1" />
        <text fontSize="7" fill={ink} fontFamily="var(--font-plex-mono), monospace" letterSpacing="1.4">
          <textPath href={`#${pathId}`}>AGENT CREDIT LAB · EVIDENCE REGISTER ·</textPath>
        </text>
        {score !== null ? (
          <>
            <text
              x="50"
              y="54"
              textAnchor="middle"
              fill={ink}
              fontSize="21"
              fontWeight="800"
              fontFamily="var(--font-archivo), sans-serif"
            >
              {score}
            </text>
            {grade && (
              <text
                x="50"
                y="66"
                textAnchor="middle"
                fill={ink}
                fontSize="8"
                letterSpacing="2.5"
                fontFamily="var(--font-plex-mono), monospace"
              >
                {grade}
              </text>
            )}
          </>
        ) : (
          <text
            x="50"
            y="54"
            textAnchor="middle"
            fill={ink}
            fontSize="8.5"
            letterSpacing="1.5"
            fontFamily="var(--font-plex-mono), monospace"
          >
            UNTESTED
          </text>
        )}
      </svg>
    </div>
  );
}
