# Finding: repeating the heading on every chunk does not improve retrieval

**Observed**: 2026-09-01, measured before and after against the live 607 chunk index.
**Status**: tried, measured, reverted. Written down so it is not tried again on the same reasoning.

## The change that was tried

`chunkMarkdown` prepends a section's `headingPath` to the section body and then splits the result at the 2000 character cap. Because the prefix is simply the first paragraph of that stream, the greedy packer puts it in the first piece and nowhere else. Measured on this corpus: **203 of 607 chunks (33%) carried no heading text at all**, and they are the continuations of the LONG sections, which are the substantive ones.

The change moved the prefix inside the loop, so every piece carries it, with the body budget shrunk by the prefix length so pieces still fit the cap. It worked as intended: chunks without heading text went from 203 to 0.

## What it did to retrieval

Twenty labelled queries, the same set used to calibrate `MINIMUM_SIMILARITY`, run against the index before and after a full re embed.

| | before | after |
|---|---|---|
| positives, mean top-1 | **0.7690** | 0.7575 |
| negatives, mean top-1 | 0.6543 | 0.6538 |
| weakest positive | 0.698 | 0.693 |
| strongest negative | 0.712 | 0.712 |
| at 0.68: positives kept / negatives rejected | 10/10 · 7/10 | 10/10 · 7/10 |
| at 0.70: positives kept | 9/10 | **8/10** |

Separation got slightly worse. Positive scores fell while negative scores did not, which is the wrong direction on both counts. One positive dropped hard: "how does the retrieval corpus get embedded and kept in sync" went from 0.788 to 0.693.

The likely mechanism is that the prefix is identical across every piece of a section, so it adds the same boilerplate to each vector and pulls continuation chunks toward the heading and away from the distinctive content a specific query matches on. Chunk count also fell from 607 to 597, because the prefix no longer consumes budget inside the packed stream.

## Why the premise was wrong anyway

The motivation was that a continuation chunk reaches the model without context. It does not. `renderResults` builds the tool result from `chunk.heading` and `chunk.sourcePath` in the **metadata**, not from the embedded text, so the model has always seen the heading and the source path for every chunk it is handed.

The heading in the embedded text only ever affected MATCHING, never what the model could read or attribute. That should have been checked before the change rather than after.

## What this does not rule out

The twenty query set measures top-1 score per query, and none of those queries was written to target content that lives specifically in a continuation chunk. A set built for that could show a different result. That would be a new measurement with a labelled set of its own, not a re run of this one, and it should be built before the idea is revisited rather than after.

## References

- `apps/api/src/modules/conversation/retrieval/chunk.ts`, the chunker and its cap
- `apps/api/src/modules/conversation/retrieval/vector-store.ts`, where `MINIMUM_SIMILARITY` records the calibration this reuses
- The index is shared and `embed:corpus` rewrites it wholesale, so any re measurement must re embed first and confirm the vector count
