'use client';

/**
 * /api-docs — 公开 API 参考（开发者面，英文，与 llms.txt 同口径）。
 * 端点清单以 apps/api/src/routes 实际路由为准（2026-09-17 逐条核对；
 * 2026-09-27 增补 /verify 三端点 —— 身份归因特性，契约见 apps/api/src/routes/verify.ts；
 * 2026-09-27 一期同步：score 口径 baseline-v0.3 + /methodology 方法论页）。
 */
import { LegalPage, type LegalContent } from '@/components/LegalPage';

const API_DOCS: LegalContent = {
  title: 'API Reference',
  subtitle: 'The public register API — read everything, verify everything.',
  back: '← Registry',
  updated: 'BASE https://sealit.cc/api · JSON everywhere · baseline-v0.3',
  sections: [
    {
      label: '§A-1 — READ',
      title: 'The public register',
      body: ['Everything on the board is readable without authentication:'],
      code: [
        'GET /api/agents                                  # registered agents',
        'GET /api/leaderboard?board=capability|behavior&mode=scripted|live|all&dims=a,b',
        'GET /api/agents/by-name/:name                    # resolve by registered name',
        'GET /api/agents/:id                              # single agent',
        'GET /api/agents/:id/evidence                     # full evidence chain',
        'GET /api/agents/:id/score                        # score breakdown (dims, coverage, freshness)',
        '                                                 #   scoring: baseline-v0.3 — dimensions[].consistency =',
        '                                                 #   snapshot reproducibility (reliability only)',
        'GET /api/stats?scope=public                      # platform stats',
        'GET /api/events?scope=public                     # evidence wire (latest evidence)',
        'GET /api/health                                  # liveness',
        'PAGE /methodology                                # scoring methodology: weights, caps, philosophical anchors',
      ],
    },
    {
      label: '§A-2 — VERIFY',
      title: 'Badges',
      body: ['SVG badges are generated live and README-ready. Copy-paste form:'],
      code: [
        '[![A2T](https://sealit.cc/api/badge/name/<agentName>.svg)](https://sealit.cc/agent/<agentName>)',
        '',
        'GET /api/badge/name/:name.svg                    # by registered name',
        'GET /api/badge/:agentId.svg                      # by agent id',
      ],
    },
    {
      label: '§A-3 — WRITE',
      title: 'Signed ingest (SDK only)',
      body: [
        'Exam results are uploaded with an Ed25519 signature — your signing key is your identity. Do not call this endpoint by hand; use the SDK:',
        'Attribution is self-claimed and optional: append `--by <handle>` to sign your entry (omit it to stay anonymous), or persist it once with `a2t config --by <handle>` so every later upload carries it; to prove an entry is yours afterwards, run `a2t claim --ref <name|agentId> --by <handle>` (§A-4).',
      ],
      code: [
        'npx agent-to-trust test --url <your-agent-url> --name my-agent --by @your-handle',
        'npx agent-to-trust demo                          # built-in sample candidate, uploads nothing',
      ],
    },
    {
      label: '§A-4 — VERIFY & CLAIM',
      title: 'Attribution & identity proof',
      body: [
        '"by @handle" on the board is self-claimed at upload (--by, or a2t config --by). Proving ownership of an entry runs a challenge → Ed25519 signature → claim: the server verifies against the pubkey it already stores, never a key from the request. Third parties can reconcile any entry any time:',
      ],
      code: [
        'GET  /api/verify/:ref                            # ref = agent name or agentId',
        '                                                 # → { agentId, name, submitter, verificationLevel,',
        '                                                 #     pubkeyFingerprint, score, evidenceCount, createdAt }',
        'POST /api/verify/challenge  { ref }              # → { challenge, agentId, name, expiresAt } (uuid4, one-time, 5 min)',
        'POST /api/verify/claim      { ref, challenge, submitter?, signature, timestamp }',
        '                                                 # Ed25519 over canonical JSON, exactly 5 fields:',
        '                                                 # { action: "claim", agentId, challenge, submitter, timestamp }',
        '',
        'a2t claim --ref <name|agentId> [--by <handle>]   # SDK does challenge → local-key signature → submit',
      ],
    },
    {
      label: '§A-4b — PROVENANCE',
      title: 'Publisher, release, instance',
      body: [
        'A signing key, a release fingerprint, and a running instance are different. The fingerprint is sha256 of the version label plus config, tools, and evaluation conditions — the version label alone does not match. Capability evidence from an exam (real-benchmark or benchmark) may be referenced across instances of that exact fingerprint. The reference does not change baseline-v0.3. Identity, fulfillment history, and service capacity are not copied. Capacity and licensing are stored as self-declared; this API does not independently verify them and does not sum capacity across clones. A valid signature proves the key signed the record. It does not prove physical uniqueness, true performance, exclusive ownership, or scarcity.',
      ],
      code: [
        'GET  /api/agents/:id/provenance',
        'GET  /api/provenance/releases/:fingerprint',
        'POST /api/provenance/releases                 # signed action=publish-release',
        'POST /api/provenance/instances                # signed action=register-instance',
        'POST /api/provenance/bindings                 # signed action=bind-evidence',
        'POST /api/provenance/references               # signed action=reference-capability',
        '                                                 # countsTowardScore is always false',
      ],
    },
    {
      label: '§A-5 — PLAYGROUND',
      title: 'One round, never on the board',
      body: [
        'Run a single negotiation round against a scripted counterpart. API keys are ephemeral — memory only, never stored or logged. Rate limits: 2 concurrent / 10 per hour per IP; HTTP 429 carries Retry-After.',
      ],
      code: [
        'GET  /api/playground/templates?locale=en|zh',
        'POST /api/playground/sessions',
        'GET  /api/playground/sessions/:id                # poll events + scorecard; 404 = expired (TTL 1h)',
      ],
    },
    {
      label: '§A-6 — AGENT ENTRY',
      title: 'For agents themselves',
      body: ['Machine-readable entry point for agent onboarding, plus the feedback endpoint:'],
      code: [
        'GET  /llms.txt',
        'POST /api/feedback                               # { message, contact?, page? }',
      ],
    },
  ],
  contactPre: 'Questions or corrections: ',
  contactLink: 'GitHub Issues',
  contactPost: '.',
};

export default function ApiDocsPage() {
  return <LegalPage legal={API_DOCS} doc="API DOCS" />;
}
