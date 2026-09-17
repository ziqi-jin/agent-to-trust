'use client';

/**
 * /terms — 服务条款。开源实验场的服务边界：按现状提供，密钥即责任。
 */
import { useT } from '@/lib/i18n';
import { LegalPage } from '@/components/LegalPage';

export default function TermsPage() {
  const t = useT();
  return <LegalPage legal={t.terms} doc="TERMS" />;
}
