/**
 * Provenance for copies of an agent (a2t-provenance-v1).
 *
 * Three different things:
 * - Publisher: the key that signed a release record. A signature proves that key
 *   controlled this record. It does not prove a physical object is unique, that
 *   performance claims are true, exclusive ownership, or scarcity.
 * - Release: an immutable fingerprint of version label + config + tools +
 *   evaluation conditions. The version label alone is not the fingerprint.
 * - Instance: one running copy, operated by one registered identity. Clones are
 *   new instances. They do not inherit identity, fulfillment history, or capacity.
 *
 * Capability evidence may be *referenced* when the server-checked fingerprints
 * match (config, tools, and evaluation conditions included). A reference is a
 * pointer with provenance. It is not a copied evidence row and it is not an
 * input to baseline-v0.3. This module does not change scoring.
 *
 * Capacity, licensing, and scarcity stay self-declared. Nothing here is an
 * independent auditor of those claims.
 */

export const PROVENANCE_SCHEMA = 'a2t-provenance-v1' as const;

export const SIGNATURE_MEANS =
  'A valid signature shows that the holder of this key signed this record. It does not prove physical uniqueness, that performance claims are true, exclusive ownership, or scarcity.';

export const SIGNATURE_DOES_NOT_PROVE = [
  'physical-uniqueness',
  'performance-truth',
  'exclusive-ownership',
  'scarcity',
] as const;

export const NOT_INHERITED_BY_CLONES = ['identity', 'fulfillment', 'capacity'] as const;

export const SCORING_NOTE =
  'baseline-v0.3 counts only evidence rows stored for this identity. A capability reference is a pointer with provenance. It does not add points, and it does not copy fulfillment history, identity, or service capacity.';

/** No rarity term is added to credit. Kept as a named constant so callers cannot invent one. */
export const RARITY_CREDIT_BONUS = 0;

export const ASSURANCE = {
  signedRecord: 'signed-record',
  serverCheckedFingerprint: 'server-checked-fingerprint',
  selfDeclared: 'self-declared',
} as const;

export type Assurance = (typeof ASSURANCE)[keyof typeof ASSURANCE];

export const EVIDENCE_SCOPES = ['capability', 'fulfillment', 'identity', 'capacity', 'other'] as const;
export type EvidenceScope = (typeof EVIDENCE_SCOPES)[number];

/** Exam sources the server already accepted. Self-reported rows are not referable. */
export const REFERENCABLE_EXAM_SOURCES = ['real-benchmark', 'benchmark'] as const;

const MAX_DEPTH = 6;
const MAX_NODES = 200;
const MAX_STRING = 2000;
const MAX_CANONICAL = 16_000;

export interface ReleaseMaterial {
  schema: typeof PROVENANCE_SCHEMA;
  versionLabel: string;
  config: Record<string, unknown>;
  tools: string[];
  evalConditions: Record<string, string>;
}

export type ParseFailure = { ok: false; code: string };
export type ParseSuccess<T> = { ok: true; value: T };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortKeysDeep(child)]),
    );
  }
  return value;
}

/** SHA-256 hex. Pure so the dashboard bundle does not import node:crypto. */
export function sha256Hex(text: string): string {
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const pad = withOne % 64 <= 56 ? 56 - (withOne % 64) : 120 - (withOne % 64);
  const data = new Uint8Array(withOne + pad + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(data.length - 4, bitLen >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < data.length; i += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[t]! + w[t]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, '0')).join('');
}

function sha256(text: string): string {
  return sha256Hex(text);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function valueOk(value: unknown, depth: number, counter: { n: number }): boolean {
  counter.n += 1;
  if (counter.n > MAX_NODES) return false;
  if (value === null) return true;
  if (typeof value === 'string') return value.length <= MAX_STRING;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return false;
    return value.every((item) => valueOk(item, depth + 1, counter));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH || !isPlainObject(value)) return false;
    return Object.entries(value).every(([key, child]) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
      if (key.length === 0 || key.length > 128) return false;
      return valueOk(child, depth + 1, counter);
    });
  }
  return false;
}

export function parseReleaseMaterial(input: unknown): ParseSuccess<ReleaseMaterial> | ParseFailure {
  if (!isPlainObject(input)) return { ok: false, code: 'material-not-object' };
  const versionLabel = input.versionLabel;
  if (typeof versionLabel !== 'string' || versionLabel.trim().length === 0 || versionLabel.trim().length > 128) {
    return { ok: false, code: 'version-label' };
  }
  if (!isPlainObject(input.config) || !valueOk(input.config, 0, { n: 0 })) {
    return { ok: false, code: 'config' };
  }
  if (!Array.isArray(input.tools) || input.tools.length > 64) return { ok: false, code: 'tools' };
  const tools: string[] = [];
  for (const tool of input.tools) {
    if (typeof tool !== 'string') return { ok: false, code: 'tools' };
    const trimmed = tool.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return { ok: false, code: 'tools' };
    tools.push(trimmed);
  }
  if (!isPlainObject(input.evalConditions)) return { ok: false, code: 'eval-conditions' };
  const entries = Object.entries(input.evalConditions);
  if (entries.length > 32) return { ok: false, code: 'eval-conditions' };
  const evalConditions: Record<string, string> = {};
  for (const [key, value] of entries) {
    const k = key.trim();
    if (k.length === 0 || k.length > 128 || typeof value !== 'string') return { ok: false, code: 'eval-conditions' };
    const v = value.trim();
    if (v.length === 0 || v.length > 128) return { ok: false, code: 'eval-conditions' };
    evalConditions[k] = v;
  }
  const material: ReleaseMaterial = {
    schema: PROVENANCE_SCHEMA,
    versionLabel: versionLabel.trim(),
    config: input.config,
    tools: [...new Set(tools)].sort((a, b) => a.localeCompare(b)),
    evalConditions,
  };
  if (canonicalJson(material).length > MAX_CANONICAL) return { ok: false, code: 'material-too-large' };
  return { ok: true, value: material };
}

/** sha256 of the canonical config object. */
export function configHash(config: Record<string, unknown>): string {
  return sha256(canonicalJson(config));
}

/**
 * Content address of a release. The version label is an input, not the identity:
 * the same label with a different config, tool list, or evaluation condition
 * produces a different fingerprint.
 */
export function fingerprintRelease(material: ReleaseMaterial): string {
  return sha256(
    canonicalJson({
      schema: material.schema,
      versionLabel: material.versionLabel,
      configHash: configHash(material.config),
      tools: material.tools,
      evalConditions: material.evalConditions,
    }),
  );
}

export type ReferenceDecision =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'scope-not-referable'
        | 'dimension-not-capability'
        | 'source-not-exam'
        | 'missing-fingerprint'
        | 'version-label-insufficient'
        | 'fingerprint-mismatch';
    };

export function decideCapabilityReference(input: {
  sourceScope: string;
  sourceDimension: string;
  sourceEvidenceSource: string;
  sourceFingerprint: string | null;
  targetFingerprint: string | null;
  sourceVersionLabel: string | null;
  targetVersionLabel: string | null;
}): ReferenceDecision {
  if (input.sourceScope !== 'capability') return { ok: false, code: 'scope-not-referable' };
  if (input.sourceDimension !== 'capability') return { ok: false, code: 'dimension-not-capability' };
  if (!(REFERENCABLE_EXAM_SOURCES as readonly string[]).includes(input.sourceEvidenceSource)) {
    return { ok: false, code: 'source-not-exam' };
  }
  if (!input.sourceFingerprint || !input.targetFingerprint) {
    return { ok: false, code: 'missing-fingerprint' };
  }
  if (input.sourceFingerprint === input.targetFingerprint) return { ok: true };
  if (
    input.sourceVersionLabel !== null &&
    input.targetVersionLabel !== null &&
    input.sourceVersionLabel === input.targetVersionLabel
  ) {
    return { ok: false, code: 'version-label-insufficient' };
  }
  return { ok: false, code: 'fingerprint-mismatch' };
}

export interface DeclaredCapacity {
  instanceId: string;
  declaredCapacity: number | null;
  assurance: typeof ASSURANCE.selfDeclared;
}

/**
 * Self-declared capacity is listed per instance and never summed.
 * Adding the numbers would double-count clones and would pretend the
 * figures had been independently verified.
 */
export function capacitySummary(instances: Array<{ instanceId: string; declaredCapacity: number | null }>): {
  total: null;
  reason: string;
  perInstance: DeclaredCapacity[];
} {
  return {
    total: null,
    reason:
      'Self-declared capacity is not summed. Clones would double-count, and this service does not independently verify capacity, licensing, or scarcity.',
    perInstance: instances.map((row) => ({
      instanceId: row.instanceId,
      declaredCapacity: row.declaredCapacity,
      assurance: ASSURANCE.selfDeclared,
    })),
  };
}
