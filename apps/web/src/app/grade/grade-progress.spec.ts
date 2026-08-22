import { describe, expect, it } from 'vitest';
import { buildShareText } from './ShareButton';
import {
  EMPTY_PROGRESS,
  PROGRESS_VERSION,
  applyReveal,
  countRead,
  firstUnreadIndex,
  parseProgress
} from './useGradeProgress';
import type { GradeReveal } from '@/lib/grade-api';

/**
 * The pure halves of R7's client state, tested without a browser.
 *
 * Two invariants here fail SILENTLY if broken, which is why they are pinned
 * rather than left to a render test: a share summary that leaks a grade still
 * copies fine, and a progress store that drops its cache still shows a
 * playable page. Both would ship looking correct.
 */

function reveal(overrides: Partial<GradeReveal> = {}): GradeReveal {
  return {
    publicId: 'd90607c121edb1ac',
    trueGrade: 4,
    model: {
      grade: 3,
      confidence: 'low',
      observations: ['Slabby top section.'],
      reasoning: 'Mostly vertical with a slab transition.'
    },
    guessCounts: [0, 0, 0, 1, 1, 1, 0, 0, 0],
    plays: 3,
    yourGuess: 5,
    yourDistance: 1,
    modelDistance: 1,
    ...overrides
  };
}

describe('the share summary (AC-11)', () => {
  it('names no grade of any kind', () => {
    // The whole point of "spoiler safe". A summary carrying V4 hands the
    // answer to whoever reads it, and the game is over for them before they
    // open it. Distances are the interesting part and spoil nothing.
    const text = buildShareText(reveal(), 1, 8, 'https://example.test');

    for (const grade of ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']) {
      expect(text).not.toContain(grade);
    }
  });

  it('links to wherever the site is actually served from, not a hardcoded domain', () => {
    // A literal would have shipped a dead link: tonychou.dev does not resolve.
    expect(buildShareText(reveal(), 1, 8, 'https://example.test')).toContain(
      'https://example.test/grade'
    );
  });

  it('carries the problem position, never a day number', () => {
    const text = buildShareText(reveal(), 3, 8, 'https://example.test');

    expect(text).toContain('problem 3/8');
  });

  it('says who read it better without naming what either said', () => {
    const youWon = buildShareText(reveal({ yourDistance: 0, modelDistance: 2 }), 1, 8, 'https://example.test');
    const claudeWon = buildShareText(reveal({ yourDistance: 2, modelDistance: 0 }), 1, 8, 'https://example.test');
    const tied = buildShareText(reveal({ yourDistance: 1, modelDistance: 1 }), 1, 8, 'https://example.test');

    expect(youWon).toContain('I read it better than Claude.');
    expect(claudeWon).toContain('Claude read it better than I did.');
    expect(tied).toContain('Dead even with Claude.');
  });

  it('handles a problem with no model analysis', () => {
    const text = buildShareText(reveal({ model: null, modelDistance: null }), 1, 8, 'https://example.test');

    expect(text).toContain('claude  (no read)');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });
});

describe('the progress store (AC-24, AC-26)', () => {
  it('round-trips a reveal so a refresh restores it', () => {
    // AC-26's whole reason for existing: without this the only way back to
    // Claude's analysis is to guess again, which counts twice.
    const stored = applyReveal(EMPTY_PROGRESS, reveal());
    const parsed = parseProgress(JSON.stringify(stored));

    expect(parsed.revealed['d90607c121edb1ac']).toEqual(reveal());
  });

  it('discards a stored value from an older version rather than parsing it', () => {
    const old = JSON.stringify({ version: 0, revealed: { abc: reveal() } });

    expect(parseProgress(old)).toEqual(EMPTY_PROGRESS);
  });

  it('drops one corrupt entry without losing the rest', () => {
    // Per entry rather than all or nothing: one bad reveal should cost that
    // problem's saved copy, not the visitor's whole history.
    const mixed = JSON.stringify({
      version: PROGRESS_VERSION,
      revealed: { good: reveal({ publicId: 'good' }), bad: { publicId: 'bad' } }
    });

    const parsed = parseProgress(mixed);

    expect(Object.keys(parsed.revealed)).toEqual(['good']);
  });

  it('survives absent, empty and non-JSON values', () => {
    expect(parseProgress(null)).toEqual(EMPTY_PROGRESS);
    expect(parseProgress('')).toEqual(EMPTY_PROGRESS);
    expect(parseProgress('not json')).toEqual(EMPTY_PROGRESS);
    expect(parseProgress('[]')).toEqual(EMPTY_PROGRESS);
  });

  it('counts only problems still in the served set', () => {
    // A marker left over from a photo the owner retired must not read as
    // "3 of 2 read", which is what counting stored keys would do.
    const progress = applyReveal(
      applyReveal(EMPTY_PROGRESS, reveal({ publicId: 'a' })),
      reveal({ publicId: 'retired' })
    );

    expect(countRead(progress, ['a', 'b'])).toBe(1);
  });

  it('opens on the first unread problem', () => {
    const progress = applyReveal(EMPTY_PROGRESS, reveal({ publicId: 'a' }));

    expect(firstUnreadIndex(progress, ['a', 'b', 'c'])).toBe(1);
  });

  it('opens on the first problem when the whole set is read', () => {
    // Not -1, and not past the end: both would index outside the array and
    // render an empty stage on a set the visitor has finished.
    const progress = applyReveal(
      applyReveal(EMPTY_PROGRESS, reveal({ publicId: 'a' })),
      reveal({ publicId: 'b' })
    );

    expect(firstUnreadIndex(progress, ['a', 'b'])).toBe(0);
  });

  it('opens on the first problem when nothing is read yet', () => {
    expect(firstUnreadIndex(EMPTY_PROGRESS, ['a', 'b'])).toBe(0);
  });

  it('replaces a re-read problem rather than duplicating it', () => {
    const first = applyReveal(EMPTY_PROGRESS, reveal({ yourGuess: 5 }));
    const second = applyReveal(first, reveal({ yourGuess: 2 }));

    expect(Object.keys(second.revealed)).toHaveLength(1);
    expect(second.revealed['d90607c121edb1ac'].yourGuess).toBe(2);
  });
});
