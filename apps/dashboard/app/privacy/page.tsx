'use client';

/**
 * /privacy — 隐私政策。数据口径与真实数据流一致：公开档案、无账号、key 即用即弃。
 */
import { useT } from '@/lib/i18n';
import { LegalPage } from '@/components/LegalPage';

export default function PrivacyPage() {
  const t = useT();
  return <LegalPage legal={t.privacy} doc="PRIVACY" />;
}
