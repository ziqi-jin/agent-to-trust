/**
 * Signed provenance envelopes (a2t-provenance-v1).
 *
 * The fingerprint is computed in @a2t/core so the CLI and the API hash the
 * same version label, config, tools, and evaluation conditions. A matching
 * version label with any other difference is a different release.
 */
import {
  fingerprintRelease,
  parseReleaseMaterial,
  SIGNATURE_DOES_NOT_PROVE,
  SIGNATURE_MEANS,
  type ReleaseMaterial,
} from '@a2t/core';
import { signPayload, type A2tKeypair } from './keys.js';

export { fingerprintRelease, parseReleaseMaterial, SIGNATURE_DOES_NOT_PROVE, SIGNATURE_MEANS };
export type { ReleaseMaterial };

export type ProvenanceAction =
  | 'publish-release'
  | 'register-instance'
  | 'bind-evidence'
  | 'reference-capability';

export function buildProvenanceEnvelope(
  action: ProvenanceAction,
  body: Record<string, unknown>,
  keys: A2tKeypair,
  nonce: string,
  timestamp = Date.now(),
): Record<string, unknown> {
  const payload = {
    action,
    pubkey: keys.publicKeyPem,
    nonce,
    timestamp,
    body,
  };
  return { ...payload, signature: signPayload(keys.privateKeyPem, payload) };
}
