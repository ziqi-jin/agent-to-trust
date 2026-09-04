'use client';

/**
 * 语言切换器：EN | 中文 两段按钮（放在刊头按钮区）。
 * 风格与刊头按钮一致：border border-paper/40 / hover:bg-paper/10；
 * 当前语言高亮用 bg-paper text-ledger。语言名本身不翻译。
 */
import { useLocale } from '@/lib/i18n';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  const base =
    'px-2.5 py-1.5 transition';
  const active = 'bg-paper text-ledger';
  const idle = 'text-paper hover:bg-paper/10';

  return (
    <div className="inline-flex items-center overflow-hidden border border-paper/40 font-mono text-[11px] uppercase tracking-widest text-paper">
      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        className={`${base} ${locale === 'en' ? active : idle}`}
      >
        EN
      </button>
      <span aria-hidden className="select-none text-paper/40">
        |
      </span>
      <button
        type="button"
        onClick={() => setLocale('zh')}
        aria-pressed={locale === 'zh'}
        className={`${base} ${locale === 'zh' ? active : idle}`}
      >
        中文
      </button>
    </div>
  );
}
