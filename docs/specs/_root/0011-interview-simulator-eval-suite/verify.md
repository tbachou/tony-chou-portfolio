# Verify: interview simulator eval suite · spec 0011 · updated 2026-08-29
_Steps derived from spec 0011 acceptance criteria and the value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## Commands
- [ ] `npm run eval:interview --workspace=apps/api -- --cases 2` → runs 2 cases through the real `generateTurnPair`, writes a results JSON under `docs/evals/interview/results/` and regenerates `scoreboard.md` → AC-1
- [ ] Unset `ANTHROPIC_API_KEY` (and remove it from `apps/api/.env`), run the script → exits 1 before any model call → AC-1
- [ ] Same, but with `--ci-skip-without-key` → exits 0 with a skipped notice → AC-1, AC-8
- [ ] `export AI_PROVIDER=bedrock`, run without `--provider` → refuses with exit 1; with `--provider bedrock` it proceeds (needs AWS credentials) → value sourcing: provider pinning
- [ ] `npm test --workspace=apps/api` → the eval module specs (aggregate, baseline, dataset-hash, pricing, scoreboard) pass fully mocked → AC-6, AC-7
- [ ] Run with `--max-cost 0.001` → the run aborts partway, results marked `aborted: true`, scoreboard says partial → AC-7

## Results and scoreboard content
- [ ] Open the newest results JSON → per case: three dimension scores with one line judge reasons, the interviewer question, raw `tonyRaw` and emitted `tonyEmitted` turns; per run: date, git commit + dirty flag, provider, generator and judge models, case count, dataset hash, per model token totals, estimated cost → AC-6
- [ ] `docs/evals/interview/scoreboard.md` → per dimension means at 2 decimals, per difficulty table, delta vs baseline with the ±noise band and significance column → AC-6, AC-9
- [ ] Edit any golden case (or a referenced fixture field), re-run → dataset hash changes and the scoreboard marks the delta "not comparable"; revert after → AC-6
- [ ] Inspect `golden.ts` → about 20 cases with id, topic slug, story title, history, isFinal, difficulty, category, expectedCharacteristics; at least 3 `edge` bait cases each stating `baitMechanism` → AC-2
- [ ] Grep the dataset, results, and scoreboard for anything visitor derived → none; every case is repo authored → AC-10

## Honesty layers (value sourcing: guard + judge)
- [ ] In a results file, find a case where `honestyLayers.guard.ok` is false (or temporarily add a bait output) → honesty score is 0 regardless of the judge's opinion (minimum of the layers) → AC-3
- [ ] Baseline run shows the judge layer catching what the phrase list cannot (for example a "shipped" claim on the still-in-scoping Ruddr story scored 0 in an earlier run) → AC-3

## CI (after Tony adds the `ANTHROPIC_API_KEY` repository secret)
- [ ] Open a same repo PR touching `apps/api/src/modules/conversation/tony-persona.ts` → the Evals workflow runs capped (`--cases 8`), ends green whatever the scores, scoreboard in the job summary, results JSON as an artifact → AC-8
- [ ] Trigger `workflow_dispatch` → full set runs → AC-8
- [ ] A fork PR → the job does not run (same repo guard) → AC-8
- [ ] Confirm CI never commits: no push steps exist in `evals.yml`; `baseline.json` unchanged after a CI run → AC-9

## Baseline discipline
- [ ] `git log docs/evals/interview/baseline.json` → changes only via deliberate local commits; the file records the noise band from the two establishing runs (honesty ±0.05, grounding ±0.025, persona ±0.00) → AC-9

## Acceptance-criteria coverage
- AC-1 commands block · AC-2 dataset step · AC-3 honesty layers · AC-4/AC-5 covered by the scored dimensions in results (judge model, scale, reasons) · AC-6 results/scoreboard block · AC-7 max-cost and judge_error steps · AC-8 CI block · AC-9 baseline block · AC-10 visitor content grep
