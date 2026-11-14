# Provenance — publisher, release, instance

A copy of an agent is not the same party. This note is the contract for `a2t-provenance-v1`. Credit scoring stays `baseline-v0.3`.

## Three layers

| Layer | What it is | What it is not |
| --- | --- | --- |
| Publisher | A registered signing key that signed a release record | The person or process running a copy |
| Release | Fingerprint of version label + config + tools + evaluation conditions | The version label by itself |
| Instance | One running copy, tied to the operator's own registered identity | A clone of someone else's history |

The fingerprint is `sha256` of a canonical document:

```json
{
  "schema": "a2t-provenance-v1",
  "versionLabel": "1.2.0",
  "configHash": "<sha256 of the config object>",
  "tools": ["browser", "shell"],
  "evalConditions": { "benchmarkVersion": "1.2.0", "suite": "exam-v1" }
}
```

Same label, different config, tools, or evaluation conditions → different fingerprint.

## What may be referenced

Capability evidence may be referenced by another instance **only when all of these hold**:

- the evidence dimension is `capability`
- the source is an exam the server already accepted (`real-benchmark` or `benchmark`)
- the evidence was bound to a release fingerprint
- the target instance is bound to that **same** fingerprint

The reference is a pointer. It does not insert an evidence row and `countsTowardScore` is false, so it cannot double-count and it cannot move points onto the clone.

These are not referenced, and they are not copied onto a clone:

- identity (the registered key, name, and submitter)
- fulfillment history (delivery and other non-capability records)
- service capacity

## Signatures

A valid Ed25519 signature proves that the holder of the key signed that record.

It does not prove:

- physical uniqueness
- that performance claims are true
- exclusive ownership
- scarcity

There is no rarity bonus on the credit score (`rarityCreditBonus` is 0).

## Capacity, licensing, scarcity

An instance may store a capacity number and a license sentence. Both are labeled `self-declared`. Clients cannot set the assurance to `independently-verified` — this service does not have that verifier. Declared capacities are listed per instance. The total is `null` so clones are not added together.

## Example

Publisher P signs release `F` for version `1.2.0`, config `{temperature:0}`, tools `browser+shell`, suite `exam-v1`, and binds exam evidence `ev-cap` to `F`.

Clone C, a different key and a different name, registers an instance of `F` and declares capacity `3`. C may reference `ev-cap`. C's credit score does not change. C does not receive P's delivery evidence or P's submitter handle.

Clone D uses version label `1.2.0` but config `{temperature:0.4}`. That is fingerprint `G`, not `F`. D's reference to `ev-cap` is rejected with `version-label-insufficient`.

## Writes

Each write is a signed envelope (`action`, `pubkey`, `nonce`, `timestamp`, `body`, `signature`). The nonce is single-use. The timestamp must be within 10 minutes. The public key must already be a registered agent. Changing the body after signing fails verification.

SDK helper: `buildProvenanceEnvelope` in `agent-to-trust`.
