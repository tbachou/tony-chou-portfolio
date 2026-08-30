# Interview simulator evals

Read this before quoting anything in this directory.

**First person text in these files was written by a language model under test. It is not a claim by Tony Chou.** These are the outputs of an adversarial test bench: a fixed set of cases is run through the production code path that generates the interview simulator's turns, and the results are committed so that changes can be compared over time. Some cases exist specifically to provoke the model into overclaiming credit. When one succeeds, the false claim it produced is recorded here on purpose, because a scoreboard that reports a failure without showing what was actually said cannot be checked by anyone.

Every results file and the baseline carry this same disclaimer inline, as a `_readMeFirst` field, because a JSON file is reachable on its own and a reader may never open this README.

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

Two scores are not comparable unless their `datasetHash` matches; a changed dataset means a re baseline, and the scoreboard marks it.

**The noise band can read ±0.00, and that does not mean the judge is deterministic.** It means the two runs that produced the baseline happened to agree exactly on that dimension. A band of zero makes any later movement read as significant, which will over claim. Treat a small delta against a zero band as unproven until a second run reproduces it. Judge scores are model opinions and they drift, so the baseline publishes a noise band measured from two identical runs, and a delta inside that band is marked not significant rather than reported as progress. The deterministic guard layer is the only hard signal in the suite.

Scores never fail CI. The workflow reports; it does not gate.

CI runs a capped 8 case subset on a pull request that touches the conversation module, the fixtures, or the suite itself. Runs cost real budget, so a PR that cannot move the scores (a pure refactor, a comment, a test) can carry the `skip-evals` label to opt out. Labels are read when the event fires, so labelling an open PR takes effect from the next push, not retroactively. The full 20 case set is always available on demand from the Actions tab via `workflow_dispatch`.

## Running it

```bash
npm run eval:interview --workspace=apps/api              # full set
npm run eval:interview --workspace=apps/api -- --cases 5 # a quick subset
```

Needs `ANTHROPIC_API_KEY`. Runs cost real money and are bounded by `--max-cost`, defaulting to 2 USD; a full 20 case run has been costing about 19 cents.

## Baseline history

The baseline moves only by a deliberate local run, and each move is recorded here with its reason.

| Date | Cases | Why it moved |
|---|---|---|
| 2026-08-29 | 20 | The original baseline (spec 0011). |
| 2026-08-30 | 22 | Added two `credential-bait` cases and disambiguated one fixture summary; both change the dataset hash. |

The 2026-08-30 move did two things:

**Two credential bait cases were added**, `edge-bait-ot-licence-current` and `edge-bait-ot-could-treat`. The rule forbidding claims of current occupational therapy licensure is the only never claim item that misrepresents a real regulated qualification, and it had no eval coverage at all. They lead the edge tier deliberately: `selectCases` samples round robin from the front of each tier, so a capped CI run exercises them on every prompt change. Their questions bridge back to the topic on purpose, because the persona judge scores coherence against the topic label and a bare off topic question is penalised by construction.

**One fixture summary was disambiguated.** `Three-layer state management architecture` read `10/10 commits Tony; TanStack Query layer: 8/9 commits; reducer pattern: 13/15 commits`. The attribution was stated once and elided twice, and the honesty judge read the elided ones as commits by other people, contradicting the story's SOLO ownership. It swung a case between 1 and 0 across two identical runs and inflated the honesty noise band to 0.07. Adding `Tony` to the two elided clauses changes no claim; it removes an ambiguity. The honesty band went to 0.00.

### The fixtures now differ from what production serves

`prisma/fixtures.ts` is both the eval corpus and the production seed, but **deploys do not seed**: Render's `preDeployCommand` runs `prisma migrate deploy` only. The eval reads the fixtures directly and sees the fix now; the live database still holds the old wording until someone seeds it.

**Do not re seed production to close that gap.** `prisma/seed.ts` begins with `conversationTurn.deleteMany()`, so seeding deletes every persisted conversation turn. Since spec 0012 phase one, the server rebuilds conversation history from exactly those rows, so a re seed silently destroys every live conversation. Closing this gap needs a targeted update of the one `Story.summary`, not a seed.

## Privacy

Every case is authored in this repo. Nothing here is derived from anything a visitor typed, which is a hard rule of the conversation engine, not a property of this directory.
