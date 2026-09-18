export function ScoreRing({
  confidence,
  size = 78,
  strokeWidth = 6,
}: {
  confidence: number;
  size?: number;
  strokeWidth?: number;
  track?: string;
  color?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, confidence));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2A2A30" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#FF6A1F"
        strokeWidth={strokeWidth}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="54%"
        textAnchor="middle"
        fill="#F2F2F3"
        fontSize={size * 0.19}
        fontFamily="var(--font-plex-mono), monospace"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}
