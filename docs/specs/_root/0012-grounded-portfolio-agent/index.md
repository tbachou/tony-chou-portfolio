# 0012. Grounded portfolio agent

**Date**: 2026-08-29
**Status**: In Progress

## Summary

This turns the interview simulator into the vehicle for a phased, measured build of a grounded portfolio agent (an AI conversation that answers from Tony's real work, never from guesses). Each phase applies one discipline from the AI engineering course material and must move, or deliberately hold, the committed eval scoreboard from spec 0011. The audience facing product is the measured improvement story (the scoreboard history plus a short writeup per phase, later shown on a public evals page), not raw visitor traffic. Phase one is a context engineering pass on the existing prompts; retrieval, guided steering, and free text visitor questions follow as their own child specs.

## Structure

Child specs, one per phase, written when that phase is decided:

- [0012-context-engineering-pass.md](0012-context-engineering-pass.md): phase one, decided and specced now. Restructures the interviewer and Tony prompts, puts a story catalog in the interviewer context, and rebuilds history server side, measured against the 0011 baseline.
- [0012-public-evals-page.md](0012-public-evals-page.md): phase two, decided and specced. A public page at `/projects/interview-simulator/evals` rendering the published run history, the baseline history, and the per phase writeups from `docs/evals/interview/`, read at build time over a committed `published.json` manifest. **Repo visibility, resolved**: this page's value depends on a reader being able to follow a claim from the page back into the committed record, which needs a readable repo. The repo went public on 2026-08-29, so that dependency is met. It stays worth naming because it is load bearing: if the repo ever returns to private, this page degrades to an unverifiable claim.
- Phase three, `searchPortfolio` retrieval: the corpus pipeline (curated documents from the portfolio repo, Panel, Carryover, and Streamflow) plus a retrieval tool the interviewer and Tony generation can draw on. Own `/architect` run; the vector store choice is that run's stack walk. **It now has a measured problem to aim at**: [2026-08-31, the model invents technical rationale it was never given](findings/2026-08-31-grounding-embellishment.md), seen twice on the thinnest story in the corpus. Retrieval is one of the three candidate remedies that finding names, and the only one this phase was already going to build, so phase three should measure against those two cases rather than against a general hope that more context helps.
- Phase four, guided steering: suggested next questions the visitor clicks. Its design interview is already complete and recorded in [rationale.md](rationale.md) under "Settled steering decisions"; the child spec is written when the phase starts, after a re check against the retrieval design.
- Phase five, free text visitor questions plus screening: separately decided, only if Tony chooses to build and showcase the screening machinery. Until that child spec exists, no free text visitor input ships.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As Tony, I want each improvement to the conversation surface built as a measured phase so that the scoreboard history tells a verifiable engineering story I can show and talk through in interviews.
- As an engineer evaluating Tony, I want to read a committed record of baselines, changes, and deltas so that the claimed discipline is checkable in the repo, not asserted.
- As a visitor, I want the conversation to stay honest and grounded while it gains capabilities, so that nothing generated ever claims more than the verified record supports.

**Acceptance criteria** (umbrella level; each phase's child carries its own build criteria):
- **AC-1**: Every phase that changes model facing code lands with a full eval run before and after its change, compared against the committed baseline per spec 0011's rules; a dataset change re baselines per 0011 AC-9. A phase that changes no model facing code takes no run, and its child spec must say so explicitly and set `measured: false` in the publish manifest, so the absence is recorded rather than silent. Phase two is the first such phase.
- **AC-2**: Every phase's child spec names which course principles (from `~/source/ai-engineering-fundamentals` and `~/source/agents-v2`) it applied and which it deliberately skipped, with one line why per skip.
- **AC-3**: The grounding corpus only ever contains content Tony authored or owns (his repos, specs, stories, writeups). No third party licensed material enters it (the spec 0008 licence lesson).
- **AC-4**: No visitor typed content is persisted or logged in any phase before the phase five child spec deliberately decides its screening machinery. Guided phases accept clicks on server known option ids only.
- **AC-5**: The surface evolves in place: the existing interviewer and Tony conversation at `/conversation/turn` remains the single conversation engine; no parallel engine is built.

## Decision

**Chosen option**: Option 1: One surface, improved up the course ladder with measured deltas

The existing interview simulator becomes the subject of a phased build following the course order: context engineering, then a public measurement page, then retrieval over a corpus spanning the whole ecosystem, then guided steering, then (only if separately decided) free text with screening. Each phase is a child spec; each must run the 0011 eval suite before and after.

**Implementation skills**: `writing-for-agents` (`mattpocock/skills`, `.claude/skills/writing-for-agents/`) · `nestjs-best-practices` (`.claude/skills/nestjs-best-practices/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Consequences

**Positive**:
- The eval suite from spec 0011 stops being a one shot artifact and becomes the through line of a multi phase story, which is the artifact people actually read.
- Every settled design from the steering interview is preserved and lands at its natural point in the ladder instead of being discarded.
- The corpus is fully owned, so retrieval work never hits the licence wall that killed spec 0008, and it adds knowledge the model genuinely does not have.

**Negative / tradeoffs**:
- The measured protocol taxes every phase: two full eval runs (real model cost, bounded by the suite's `--max-cost`) plus a writeup, even for small changes.
- Judge scored deltas carry noise; some honest improvements will land inside the noise band and read as flat. The writeups must say so rather than overclaim.
- Free text, the most demonstrative capability, is deliberately last and may never ship; the roadmap accepts that.

**Neutral**:
- Spec 0002 remains the record of the engine's original contract; this umbrella governs its evolution. Phase children update contracts in `packages/shared` as they land.
- The steering interview's decisions are recorded here but not yet binding; the phase four child may revise details against the retrieval design.

## Follow-up

- [x] Phase two child: the public evals page, [0012-public-evals-page.md](0012-public-evals-page.md).
- [ ] Phase three child (`/architect` run): `searchPortfolio` retrieval and the corpus pipeline; its stack walk picks the vector store.
- [ ] Phase four child (`/architect` run): guided steering, seeded from the settled decisions in rationale.md.
- [ ] Phase five decision (`/architect` run, optional): free text visitor questions and the screening machinery.
- [ ] When phases land, extend the 0011 golden dataset with cases for them, re baselining per 0011 AC-9.
