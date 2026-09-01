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

No measured benefit, and one positive dropped hard: "how does the retrieval corpus get embedded and kept in sync" went from 0.788 to 0.693.

**Read the aggregate carefully.** An earlier version of this finding said separation "got worse". That overstates what twenty queries can show, and the diagnosis below is why: about a third of the corpus was repartitioned, so some queries win and some lose. A mean moving by 0.01 does not establish a direction. What the measurement supports is the absence of a benefit, not the presence of harm.

## Why it moved, diagnosed rather than guessed

The first explanation written here was that an identical prefix on every piece dilutes each vector. Two measurements contradict it. 65.7% of chunks are byte identical between the two chunkings, so the effect is not corpus wide. And the prefix's mean share of chunk text FELL, 13.3% to 10.6%, where dilution requires it to rise.

The actual mechanism is **boundary shift**. Shrinking the body budget by the prefix length repacks the paragraphs. Traced on the query that dropped hardest, whose top hit was a 1826 character chunk from `> Feature design`:

```
that section, OLD: 7 chunks of 1757, 1574, 1487, 1826, 1620, 1600, 1652
that section, NEW: 7 pieces of 1757, 1644, 1557, 1896, 1690, 1670, 1722
winning chunk survives byte-identical under the new rule? false
```

Same section, same number of pieces, different groupings. The chunk that had been a tight match no longer exists; its distinctive sentences are spread across neighbours, so nothing scores as high.

**This generalises past this change.** Which paragraphs land together is an accident of their lengths and the packer's arithmetic, with nothing semantic about it, and a query's best match depends on that accident. Any change to chunking, including moving the cap by a few characters, re rolls that for every long section.

## The experiment was confounded

Two things changed at once: continuations gained a prefix, AND the body budget shrank from 2000 to about 1920. The second caused the movement, so the measurement says nothing about the first, which was the thing under test.

Raising the cap does not fix it on its own. The original packs one stream, `[prefix, p1, p2, ...]`, so the FIRST piece pays for the prefix and pieces 2..n get a full 2000 of body. Packing the body at a full 2000 and prefixing every piece lets piece one swallow more paragraphs, which pushes piece two's start and cascades.

The design that isolates the variable is asymmetric, mirroring what the current code already does:

- pack the body with the first piece budgeted at `cap - prefix` and every later piece at the full `cap`
- prepend the prefix to pieces 2..n only

That reproduces the current partition exactly, so the only difference in the corpus is that continuation chunks gain a heading line, and any score movement is attributable. Chunks run 40 to 90 characters over the nominal cap, which is harmless: the cap is a design choice and the embedding model takes 8191 tokens.

## Why the premise was wrong anyway

The motivation was that a continuation chunk reaches the model without context. It does not. `renderResults` builds the tool result from `chunk.heading` and `chunk.sourcePath` in the **metadata**, not from the embedded text, so the model has always seen the heading and the source path for every chunk it is handed.

The heading in the embedded text only ever affected MATCHING, never what the model could read or attribute. That should have been checked before the change rather than after.

## What this does not rule out

The twenty query set measures top-1 score per query, and none of those queries was written to target content that lives specifically in a continuation chunk. A set built for that could show a different result. That would be a new measurement with a labelled set of its own, not a re run of this one, and it should be built before the idea is revisited rather than after.

Even then the expected effect is small, because the model already receives the heading and the source path through chunk METADATA. Only matching is at stake, never what the model can read or attribute.

## If this is revisited

1. Build a labelled set whose answers live in continuation chunks. Without it there is nothing to detect.
2. Use the asymmetric packing above, so boundaries are held constant and the prefix is the only variable.
3. Re embed and re run the twenty query set as a control, to confirm the unrelated queries did not move.

Steps 2 and 3 both require a full re embed, so schedule this with other index work rather than on its own.

## References

- `apps/api/src/modules/conversation/retrieval/chunk.ts`, the chunker and its cap
- `apps/api/src/modules/conversation/retrieval/vector-store.ts`, where `MINIMUM_SIMILARITY` records the calibration this reuses
- The index is shared and `embed:corpus` rewrites it wholesale, so any re measurement must re embed first and confirm the vector count
