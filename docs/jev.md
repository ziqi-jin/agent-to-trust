# Judge cross-check — powered by Jev (TypeSafe)

A2T's exam grading is deterministic and explainable. To sanity-check how that compares to a modern *decision model*, we cross-check a set of constructed samples with three independent judges and publish the numbers.

## What Jev is

[Jev](https://typesafe.ai) is TypeSafe AI's first **System One** model (`jev-latest`). It does not generate text. You send it a `state` plus a set of typed questions, and it returns **typed answers with calibrated probabilities**:

- **`choice`** — pick one of a set of options (returns the choice + per-option probabilities + confidence)
- **`score`** — rate against ordered levels
- **`noul`** — a yes/no probability

All questions in a request are answered in parallel in a single call (70–500 ms end-to-end). This makes it a natural fit for the *judgement* half of an evaluation pipeline: not "write an answer", but "judge this answer".

## How A2T uses it

Three judges grade the **same** samples independently:

| Judge | What it is |
|-------|-----------|
| `deterministic` | A2T's existing heuristic grader (keyword / regex / exact-match checks) |
| `llm` | A DeepSeek chat model prompted as a strict grader (one word: success / partial / failure) |
| `jev` | Jev as a decision model, asked one `choice` question with criteria `success` / `partial` / `failure` |

The samples are **constructed with known gold labels** (R3 construction method): for each objectively-verifiable case (numbers, strings, yes/no), we author outputs that are deliberately fully-correct, partly-correct, wrong, or *tricky* (plausible-looking but wrong). The label is decided by construction, so the ground truth is free and reproducible — no human labelling.

## Results

See [`experiments/jev-judge-crosscheck/report.md`](../experiments/jev-judge-crosscheck/report.md) for the full table and confusion matrices. Headline (34 samples): Jev reaches the highest accuracy and is the only judge that meaningfully uses the `partial` category; the deterministic grader is free and instant but cannot express partial credit.

> This is a **reproducible calibration experiment, not a scientific benchmark**. Sample construction does not reflect real-world output distributions, and the judge task is reduced to a three-way classification.

## Reproduce

```bash
TYPESAFE_API_KEY=... DEEPSEEK_API_KEY=... \
  npm run jev:crosscheck --workspace @a2t/jev -- --live
```

Without `--live` it runs the deterministic judge only (no network).

Artifacts written:

- `experiments/jev-judge-crosscheck/report.md` — human-readable report
- `experiments/jev-judge-crosscheck/results.json` — raw per-sample results
- `apps/dashboard/public/labs/jev-crosscheck.json` — data behind the home-page section

## Coupling & removal

`@a2t/jev` is an isolated workspace package. It depends on `agent-to-trust` and `@a2t/adapters`; **nothing in `core` / `scoring` / `sdk` / `adapters` / `apps` imports it** (enforced by a reverse-dependency lock test). It is removable:

```bash
bash scripts/remove-jev.sh --dry-run   # preview
bash scripts/remove-jev.sh             # remove package + assets
```

After removal, the repo returns to its prior state and the existing boards/scores are untouched.

## Credits

Jev is built by [TypeSafe AI](https://typesafe.ai). A2T is an independent project; this experiment does not imply endorsement by TypeSafe.
