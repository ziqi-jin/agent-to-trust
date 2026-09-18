'use client';

/**
 * 语言切换器：EN | 中文 分段胶囊，选中态为滑动的白色底块。
 * 语言名本身不翻译。
 */
import { useLocale } from '@/lib/i18n';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      className={`relative inline-grid grid-cols-2 items-center rounded-md border border-line-strong bg-surface p-0.5 font-mono text-[11px] font-medium ${className}`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[3px] bg-ledger transition-transform duration-300 ease-out-expo ${
          locale === 'zh' ? 'translate-x-full' : ''
        }`}
      />
      {(
        [
          ['en', 'EN'],
          ['zh', '中文'],
        ] as const
      ).map(([l, label]) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`relative z-10 whitespace-nowrap px-2.5 py-1 transition-colors ${
            locale === l ? 'font-semibold text-paper' : 'text-dim hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
