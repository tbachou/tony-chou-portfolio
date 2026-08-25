import { describe, expect, it } from 'vitest';

import { rangeSource } from './range-source';

/**
 * The distinction the page got wrong until it was written down.
 *
 * A range built from hundreds of real errors and the fixed `[c / 3, c * 3]`
 * band both carry `intervalSeeded` false, so a page reading that flag alone
 * calls the first one a placeholder. Nothing catches that but a test: both
 * render as two numbers and an asterisk.
 */
describe('rangeSource', () => {
  it('calls a regime conditioned range conditioned', () => {
    expect(rangeSource({ intervalSeeded: true, bucketSize: 232 })).toBe(
      'conditioned',
    );
  });

  it('calls a pooled range pooled, not a placeholder', () => {
    // The case observed on 2026-08-24: a central of 166 with a range of 126
    // to 221, drawn from 232 real errors, labelled "a deliberately wide
    // placeholder" while the actual placeholder would have been 55 to 498.
    expect(rangeSource({ intervalSeeded: false, bucketSize: 232 })).toBe(
      'pooled',
    );
  });

  it('calls the fixed band a placeholder', () => {
    // The only state AC-20 asks to be marked as unseeded: no bucket reached
    // the minimum, so no error ever measured went into these bounds.
    expect(rangeSource({ intervalSeeded: false, bucketSize: 0 })).toBe(
      'placeholder',
    );
  });

  it('never calls a conditioned range anything else, whatever the bucket says', () => {
    // Conditioning is the flag's whole meaning, so it wins outright. A
    // conditioned range with a zero bucket cannot occur, and if it ever did
    // the flag would be the broken half, not this.
    expect(rangeSource({ intervalSeeded: true, bucketSize: 0 })).toBe(
      'conditioned',
    );
  });
});
