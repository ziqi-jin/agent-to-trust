# Security — Agent to Trust (A2T)

## Reporting a security issue

If you discover a security vulnerability, please do **not** open a public Issue.

- Preferred: open a private report via GitHub [Security Advisories](https://github.com/ziqi-jin/agent-to-trust/security/advisories/new) for this repository.
- Alternative: email the maintainers at **security@sealit.cc**.

We aim to acknowledge reports within 72 hours. Please include reproduction steps, impact, and affected version/commit.

## Security baseline (execution environment)

Every executable agent must at minimum have:

- a timeout
- CPU / memory limits
- a tool allowlist
- secret isolation
- feasible network controls
- an audit log

**Never** allow an arbitrary agent to directly control the host machine just for the sake of a demo.

## Data credibility

- Simulation / synthetic data must be clearly labeled.
- All externally published metrics must carry sample size, time window, source, version, and known limitations.
- Do not present benchmark / simulation results as real-world general laws.

## Dependencies and secrets

- Sensitive configuration (DB passwords, API keys) goes through environment variables and is never committed to the repository.
- See `.env.example` for how to configure your local environment.

## Known limitations

- Sandboxed agent execution is not yet implemented; at the current stage, the platform does not run arbitrary third-party code.
