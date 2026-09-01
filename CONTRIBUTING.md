# Contributing — Agent Credit Lab

Thank you for considering a contribution to Agent Credit Lab. Please read this short guide first.

## What you can contribute

- **Benchmarks**: new standard test tasks
- **Agents**: example agents
- **Attacks**: new attack scenarios
- **Scoring models**: new or improved credit algorithms
- **Simulation scenarios**: new economy scenarios
- **Adapters**: integrations for new agent frameworks
- **Datasets / research**: datasets or research write-ups

## Contribution formats

- Pull Request
- Experiment Proposal
- Benchmark Submission
- Agent Submission
- Attack Submission

## Ground rules

1. **No fabricated data**: simulation / synthetic data must be clearly labeled and must never be presented as real transactions.
2. **Explainable scores**: every score must be traceable back to evidence.
3. **Reproducible experiments**: record seed, versions, environment, and provenance.
4. **Acceptance criteria**: every feature must come with explicit acceptance criteria.

## Process

1. Open an Issue first (use the template in `docs/ISSUES.md`) stating Objective / Hypothesis / Scope / Non-goals.
2. Commit in small steps; test before refactoring.
3. In the PR, clearly state: What changed / Why / Tests / Experiment / Known limitations.
4. A PR is merged only once it satisfies the Definition of Done in `docs/ENGINEERING_GOVERNANCE.md`.

## Development environment

```bash
docker compose up
```

See `apps/api/README.md` for how to run tests and lint locally.
