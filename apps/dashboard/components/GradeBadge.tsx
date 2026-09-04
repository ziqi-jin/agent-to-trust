'use client';

import { gradeFor } from '@/lib/api';
import { useT, fill } from '@/lib/i18n';

const TONE: Record<string, string> = {
  gold: 'text-brass border-brass',
  accent: 'text-ledger border-ledger',
  info: 'text-info border-info',
  amber: 'text-amber border-amber',
  danger: 'text-seal border-seal',
  dim: 'text-dim border-hairline',
};

export function GradeBadge({ score, size = 'md' }: { score: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const t = useT();
  const { label, tone } = gradeFor(score);
  const cls =
    size === 'lg'
      ? 'text-base px-3 py-1'
      : size === 'sm'
        ? 'text-[10px] px-1.5 py-0.5'
        : 'text-xs px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center justify-center border bg-paper font-mono font-bold tracking-widest ${cls} ${TONE[tone]}`}
      title={score === null ? t.grade.none : fill(t.grade.credit, { n: score })}
    >
      {label}
    </span>
  );
}
