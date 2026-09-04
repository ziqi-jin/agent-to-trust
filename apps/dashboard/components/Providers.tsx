'use client';

/**
 * 客户端 Provider 包装（app/layout.tsx 是 server component，无法直接用 LocaleProvider）。
 * 同时把当前语言同步到 <html lang>（en → 'en'，zh → 'zh-CN'），利于 SEO / 无障碍。
 */
import { useEffect } from 'react';
import { LocaleProvider, useLocale } from '@/lib/i18n';

function LangSync() {
  const { locale } = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <LangSync />
      {children}
    </LocaleProvider>
  );
}
