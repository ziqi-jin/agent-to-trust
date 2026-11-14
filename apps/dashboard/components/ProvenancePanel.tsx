'use client';

import type { AgentProvenance, FulfillmentReport } from '@/lib/api';
import { useT } from '@/lib/i18n';

function short(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

/**
 * Copy rules on an agent file. Shown even when this identity has not published
 * a release, so a signature is not read as uniqueness or a rarity bonus.
 */
export function ProvenancePanel({
  provenance,
  fulfillment,
}: {
  provenance: AgentProvenance | null;
  fulfillment: FulfillmentReport | null;
}) {
  const t = useT().detail;
  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">{t.provenanceTitle}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink">{t.provenanceLead}</p>
      <ul className="mt-3 space-y-1 text-sm text-dim">
        <li>{t.provenancePublisher}</li>
        <li>{t.provenanceInstance}</li>
        <li>{t.provenanceReference}</li>
        <li>{t.provenanceSignature}</li>
        <li>{t.provenanceCapacity}</li>
      </ul>
      {!provenance || (provenance.releases.length === 0 && provenance.instances.length === 0) ? (
        <p className="mt-3 text-sm text-dim">{t.provenanceEmpty}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {provenance.releases.map((release) => (
            <div key={release.fingerprint} className="rounded-md border border-line bg-night px-3 py-2">
              <div className="text-sm text-ink">
                {t.provenanceVersion} {release.versionLabel}
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-dim" title={release.fingerprint}>
                {t.provenanceFingerprint} {release.fingerprint}
              </div>
              <div className="mt-1 font-mono text-[11px] text-dim">
                {t.provenanceTools} {release.tools.join(', ') || '—'} · {release.assurance}
              </div>
            </div>
          ))}
          {provenance.instances.map((instance) => (
            <div key={instance.instanceId} className="rounded-md border border-line px-3 py-2 text-sm">
              <div className="font-mono text-[11px] text-dim">{short(instance.instanceId)}</div>
              <div className="mt-1 text-ink">
                {t.provenanceOperator} {instance.operatorDeclaration ?? t.anonymous}{' '}
                <span className="font-mono text-[11px] text-dim">({instance.operatorAssurance})</span>
              </div>
              <div className="text-dim">
                {t.provenanceDeclaredCapacity}{' '}
                {instance.declaredCapacity === null ? '—' : instance.declaredCapacity}{' '}
                <span className="font-mono text-[11px]">({instance.capacityAssurance})</span>
              </div>
              {instance.licenseAssertion && (
                <div className="text-dim">
                  {t.provenanceLicense} {instance.licenseAssertion}{' '}
                  <span className="font-mono text-[11px]">({instance.licenseAssurance})</span>
                </div>
              )}
            </div>
          ))}
          {provenance.capabilityReferences.length > 0 && (
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{t.provenanceRefs}</div>
              <ul className="mt-1 space-y-1">
                {provenance.capabilityReferences.map((ref) => (
                  <li key={ref.id} className="font-mono text-[11px] text-dim">
                    {ref.sourceEvidenceId} · {ref.assurance}
                    {ref.countsTowardScore ? '' : ` · ${t.provenanceNotScored}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-dim">{t.provenanceCapacityTotal}</p>
        </div>
      )}
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{t.fulfillmentTitle}</h3>
        <p className="mt-2 text-sm text-dim">{t.fulfillmentNote}</p>
        {fulfillment && fulfillment.records.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {fulfillment.records.map((row) => (
              <li key={row.id} className="rounded-md border border-line px-3 py-2 text-sm">
                <div className="text-ink">
                  {row.taskId} · {row.outcome}
                </div>
                <div className="text-dim">{row.summary}</div>
                <div className="font-mono text-[11px] text-dim">
                  {row.assurance} · {t.fulfillmentNotVerified} · {t.provenanceNotScored}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-dim">{t.fulfillmentEmpty}</p>
        )}
      </div>
    </section>
  );
}
