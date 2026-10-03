# Phase three: searchKnowledge retrieval

Spec: [0012 child, searchPortfolio retrieval](../../specs/_root/0012-grounded-portfolio-agent/0012-search-portfolio-retrieval.md) · Baselined 2026-09-03 · Dataset hash `89a66a21185c…` (**changed**, so nothing here is a delta)

**First person text quoted from any results file was written by a language model under test, not by Tony Chou.** See [README.md](README.md).

## What changed

1. **The persona can search its own documents.** A `searchKnowledge` tool over every committed spec and eval writeup — 616 chunks across 40 documents, embedded in an Upstash vector index. It is offered only when the index credentials are present; without them the generation is byte for byte the one that ran before this phase.
2. **The answer must name its source.** Each result carries the document path, and the prompt requires the persona to name it. A grounding judge scores whether it did.
3. **The corpus is a committed manifest, not an implicit set.** `corpus.json` records every document with its hash, and `check:corpus` fails CI when the repo and the manifest disagree.
4. **Caps and a degrade path in code, not in prompt.** Two searches per turn, three results per search, four model turns per generation. A retrieval failure degrades silently in production, because a visitor never loses a turn to a search; the eval sets `RETRIEVAL_STRICT` and fails loudly instead, because a run that quietly becomes a non retrieval run still costs money.

## No delta is reportable, and that is the honest headline

The golden dataset went from 22 cases to 27 — the five `retrieval-attribution` cases this phase exists to measure. **The dataset hash changed, so no number here is comparable to any run before it.** Phase one's numbers were superseded the same way and for the same reason.

| Dimension | New baseline | Noise band | Previous baseline (22 cases, **not comparable**) |
|---|---|---|---|
| honesty | 0.93 | ±0.07 | 1.000 |
| grounding | 0.98 | ±0.06 | 0.977 |
| persona | 0.96 | ±0.04 | 0.955 |

Two full runs at the same commit, 27 of 27 scored, matching dataset and corpus hashes, no generation errors. The second run is what produces the band rather than a formality: honesty read **1.00 and 0.93 across two identical runs**, and the ±0.07 band is exactly that spread. Anyone reading 0.93 as a fall from 1.00 is reading noise.

**The noise band got worse, from ±0.00 on honesty to ±0.07, and that is a real cost of this phase.** The band is measured in whole case scores: ±0.074 is two of 27 cases disagreeing between identical runs. Retrieval is why. The model now chooses whether to search and what to ask, so two runs of the same case can retrieve different sections and answer from different material. That is the feature working, and it makes the instrument blunter. A future phase claiming a two point honesty gain has not measured anything.

## Three defects this phase surfaced

**The token budget could not fit the model's thinking.** `max_tokens` was 600, set before extended thinking, and thinking tokens are billed against it. Reproduced five times against the live path: twice the model returned `stop_reason: max_tokens` with content blocks `[thinking]` — 600 thinking tokens and zero text — and once it thought for 338 and then had its answer cut off mid sentence. The empty ones refused three eval runs outright, and in production handed the visitor the ownership guard's deflection in place of an answer the corpus held. One cause, two symptoms: the truncated ones are persona scores the suite had been losing for longer.

**The honesty judge was scoring correct answers as lies.** The retrieval cases pair a question about how Tony works with whatever story the case carries, and the answer is supposed to come from the documents. Shown only the story, the judge returned 0 with reasons like "describes a completely different project instead of the Topstep onboarding rebuild" — marking the persona down for doing exactly what this phase built it to do. It now sees the retrieved sections, and its contract says subject is not a dimension of honesty. It did not go blind: the baseline run's single honesty 0 is a genuine overclaim the deterministic guard missed, an answer claiming "I built the guard" for work [spec 0013](../../specs/_root/0013-credential-check-second-layer.md) records as proposed rather than built.

**Chunking changes repartition the corpus.** Tried, measured, reverted, and recorded in its own [finding](../../specs/_root/0012-grounded-portfolio-agent/findings/2026-09-01-heading-prefix-per-chunk.md). The short version: which paragraphs land together is an accident of their lengths and the packer's arithmetic, so any change to chunking re rolls it for every long section, and a query tuned to reach one document can silently stop reaching it.

## What this phase does not fix

**Retrieval cannot ground the employment stories.** The corpus is documents Tony wrote about how he works — specs, findings, eval writeups. It holds nothing about the Mailchimp, Product Forge or Topstep work, because that material does not exist in a repository he owns. The umbrella spec's original phase three line claimed otherwise and is corrected there. The embellishment the phase was scoped against still needs its own remedy.

**The index is checked by count, not by content.** Two integrity checks exist and only one is strong: repo against manifest compares document hashes, but manifest against index compares `chunkCount` to `vectorCount` and nothing else. An index rebuilt from a *different* corpus with the same number of chunks passes. That is not hypothetical — two sessions rebuilt the shared index on the same day, a golden case silently stopped reaching its target document, and every integrity check passed. The fix is a `corpusHash` sentinel record written into the index and read in the preflight; it is a follow up on the child spec, not built.

**A threshold that keeps every positive also lets junk through.** `MINIMUM_SIMILARITY` is 0.68, calibrated against twenty labelled queries: ten the corpus answers, ten it does not. It keeps 10/10 positives and rejects 7/10 negatives. Three unrelated questions still return chunks, which is why the persona is told not to cite material that does not answer the question, and why a golden case tests exactly that. `npm run sweep:threshold` re measures this, because the calibration was done against a 607 chunk index and the index has since been rebuilt.
