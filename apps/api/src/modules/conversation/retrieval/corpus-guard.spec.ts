import * as path from 'node:path';
import { collectCorpus } from './corpus';
import { chunkMarkdown, type Chunk } from './chunk';
import { evaluateTonyResponse } from '../ownership-guard';
import { stories } from '../../../../prisma/fixtures';
import type { StoryModel } from '../../../generated/prisma/models';

/**
 * The corpus must not be able to weaponise the ownership guard (spec 0012
 * phase three, AC-6 and AC-8).
 *
 * Found by the adversarial pass on 2026-09-01, and it is not a hypothetical.
 * The tool description tells the persona to name the document it used, so an
 * honest answer quotes the retrieved section. That answer then goes through
 * `evaluateTonyResponse`. Some committed documents quote guard tripping text
 * as EXAMPLES: the credential check spec quotes a licensure claim in order to
 * discuss it, and eval writeups quote figures a model once fabricated in order
 * to record that it did. Retrieval handed those to the model, the model quoted
 * them as instructed, and the guard replaced the whole answer with scripted
 * framing while logging only "Ownership guard fired". The capability looked
 * broken for a reason nobody would trace back to retrieval.
 *
 * The fix filters retrieved chunks through the same guard before the model
 * sees them, so this file asserts the property that matters: nothing the model
 * is handed can make its own honest answer fail.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');

/** The fixture stories, shaped as the guard consumes them. */
const storyFixtures = stories.map(
  (seed, index) =>
    ({
      id: `fixture-${index}`,
      title: seed.title,
      ownership: seed.ownership,
      engagement: seed.engagement,
      summary: seed.summary,
      requiredFraming: seed.requiredFraming ?? null,
    }) as StoryModel,
);

let corpusChunks: Chunk[];

beforeAll(() => {
  corpusChunks = collectCorpus(REPO_ROOT).flatMap((doc) =>
    chunkMarkdown(doc.text, doc.path),
  );
});

/** Every (chunk, story) pair the guard rejects. */
function trippingPairs(chunks: Chunk[]): {
  sourcePath: string;
  storyTitle: string;
  reason: string;
}[] {
  const out: { sourcePath: string; storyTitle: string; reason: string }[] = [];
  for (const chunk of chunks) {
    for (const story of storyFixtures) {
      const verdict = evaluateTonyResponse(chunk.text, story);
      if (!verdict.ok) {
        out.push({
          sourcePath: chunk.sourcePath,
          storyTitle: story.title,
          reason: verdict.reason,
        });
      }
    }
  }
  return out;
}

describe('the committed corpus against the ownership guard', () => {
  it('has chunks that trip the guard, which is why retrieval must filter', () => {
    // Documented rather than asserted away. This is the hazard the filter
    // exists for, and if it ever reaches zero the filter is still correct,
    // just idle. Failing here would only mean the corpus changed.
    const tripping = trippingPairs(corpusChunks);
    const byReason = new Map<string, number>();
    for (const pair of tripping) {
      byReason.set(pair.reason, (byReason.get(pair.reason) ?? 0) + 1);
    }
    // Visible in the test output so a corpus change shows up as a diff here.
    console.log(
      'corpus chunks tripping the guard, by reason:',
      Object.fromEntries(byReason),
    );
    expect(corpusChunks.length).toBeGreaterThan(0);
  });

  it('never hands the model a chunk that would fail the guard for that story', () => {
    // The property under test. Whatever the corpus contains, what SURVIVES
    // filtering must be safe to quote for the story being discussed.
    const failures: string[] = [];
    for (const story of storyFixtures) {
      const safe = filterChunksForStory(corpusChunks, story);
      for (const chunk of safe) {
        const verdict = evaluateTonyResponse(chunk.text, story);
        if (!verdict.ok) {
          failures.push(
            `${chunk.sourcePath} survived filtering for "${story.title}" but trips: ${verdict.reason}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('drops the credential-claim chunk for every story, not just some', () => {
    // Story independent branch: the credential check fires regardless of which
    // story is being discussed, so it must be dropped universally.
    const offending = corpusChunks.filter(
      (chunk) => !evaluateTonyResponse(chunk.text, storyFixtures[0]).ok,
    );
    for (const story of storyFixtures) {
      const safe = filterChunksForStory(offending, story);
      const stillPresent = safe.filter(
        (chunk) => !evaluateTonyResponse(chunk.text, story).ok,
      );
      expect(stillPresent).toEqual([]);
    }
  });
});

// Imported last so the failing-first version of this file names the missing
// export clearly rather than failing on an unrelated line.
import { filterChunksForStory } from './search-knowledge';
