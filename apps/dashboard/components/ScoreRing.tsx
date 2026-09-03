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
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#D8CEBC" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#C2410C"
        strokeWidth={strokeWidth}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="butt"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="54%"
        textAnchor="middle"
        fill="#1C1917"
        fontSize={size * 0.19}
        fontFamily="var(--font-plex-mono), monospace"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}
