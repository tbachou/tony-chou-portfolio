# Interview simulator evals

Read this before quoting anything in this directory.

**First person text in these files was written by a language model under test. It is not a claim by Tony Chou.** These are the outputs of an adversarial test bench: a fixed set of cases is run through the production code path that generates the interview simulator's turns, and the results are committed so that changes can be compared over time. Some cases exist specifically to provoke the model into overclaiming credit. When one succeeds, the false claim it produced is recorded here on purpose, because a scoreboard that reports a failure without showing what was actually said cannot be checked by anyone.

Designed and specced in [spec 0011](../../specs/_root/0011-interview-simulator-eval-suite/index.md); the suite is the measurement instrument for every phase of [spec 0012](../../specs/_root/0012-grounded-portfolio-agent/index.md).

## Why this exists

The simulator has an AI answer questions as Tony. That is a resume that can hallucinate, so honesty is enforced in code by the ownership guard (`apps/api/src/modules/conversation/ownership-guard.ts`) rather than only requested in a prompt. This suite measures whether that enforcement actually holds as prompts and models change, since a guarantee nobody measures is a guarantee nobody has.

## What is in here

| File | What it is |
|---|---|
| `scoreboard.md` | The human read: latest scores per dimension, a per difficulty breakdown, and the delta against the baseline. A projection, regenerated from the files below, never hand edited. |
| `baseline.json` | The accepted reference run plus the noise band. Moves only by a deliberate local run and a commit; CI never writes it. |
| `results/<date>-<sha>.json` | One run: per case scores, judge reasons, the generated turns, and run metadata (models, token counts, cost, dataset hash). |
| `NNNN-<phase>.md` | A per phase writeup for spec 0012: what changed, the delta against the baseline (or its absence), and the course principles applied and skipped. |

Each case is scored on three dimensions. **Honesty** is two layered: the deterministic guard runs first and a failure scores zero regardless of what any judge thinks, then an LLM judge looks for overclaims the phrase list misses. **Grounding** checks the answer invents no facts beyond the case's story. **Persona** checks it reads like a candid interview answer.

## Reading a score honestly

Two scores are not comparable unless their `datasetHash` matches; a changed dataset means a re baseline, and the scoreboard marks it. Judge scores are model opinions and they drift, so the baseline publishes a noise band measured from two identical runs, and a delta inside that band is marked not significant rather than reported as progress. The deterministic guard layer is the only hard signal in the suite.

Scores never fail CI. The workflow reports; it does not gate.

## Running it

```bash
npm run eval:interview --workspace=apps/api              # full set
npm run eval:interview --workspace=apps/api -- --cases 5 # a quick subset
```

Needs `ANTHROPIC_API_KEY`. Runs cost real money and are bounded by `--max-cost`, defaulting to 2 USD; a full 20 case run has been costing about 19 cents.

## Privacy

Every case is authored in this repo. Nothing here is derived from anything a visitor typed, which is a hard rule of the conversation engine, not a property of this directory.
