import { gradeFor } from '@/lib/api';

const TONE: Record<string, string> = {
  gold: 'text-[#F4C95D] border-[#F4C95D]/40 bg-[#F4C95D]/10',
  accent: 'text-accent border-accent/40 bg-accent/10',
  info: 'text-info border-info/40 bg-info/10',
  amber: 'text-amber border-amber/40 bg-amber/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
  dim: 'text-dim border-edge bg-surface',
};

export function GradeBadge({ score, size = 'md' }: { score: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const { label, tone } = gradeFor(score);
  const cls =
    size === 'lg'
      ? 'text-lg px-3 py-1'
      : size === 'sm'
        ? 'text-[10px] px-1.5 py-0.5'
        : 'text-xs px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center justify-center rounded border font-mono font-700 tracking-widest ${cls} ${TONE[tone]}`}
      title={score === null ? '无证据，未评级' : `信用分 ${score}/1000`}
    >
      {label}
    </span>
  );
}
