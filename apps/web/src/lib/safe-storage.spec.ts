import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStored, writeStored } from './safe-storage';

/**
 * The behaviour six call sites relied on before they shared this helper: a
 * localStorage that refuses must not take the page down with it.
 *
 * Each case stubs a store that THROWS rather than one that returns null,
 * because that is what Safari private mode and blocked cookies actually do —
 * a stub that merely returns null would pass without the try/catch existing.
 */

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('localStorage', impl as Storage);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readStored', () => {
  it('returns the stored value', () => {
    stubStorage({ getItem: () => 'dark' });
    expect(readStored('theme')).toBe('dark');
  });

  it('returns null for a key that is not set', () => {
    stubStorage({ getItem: () => null });
    expect(readStored('theme')).toBeNull();
  });

  it('returns null when the store throws', () => {
    stubStorage({
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    // Absent and unavailable are the same answer here on purpose: no caller
    // behaves differently, and every one has a default to fall back to.
    expect(readStored('theme')).toBeNull();
  });

  it('returns null when localStorage is missing entirely', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readStored('theme')).toBeNull();
  });
});

describe('writeStored', () => {
  it('writes and reports success', () => {
    const setItem = vi.fn();
    stubStorage({ setItem });
    expect(writeStored('theme', 'dark')).toBe(true);
    expect(setItem).toHaveBeenCalledWith('theme', 'dark');
  });

  it('reports failure instead of throwing when the quota is full', () => {
    stubStorage({
      setItem: () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      },
    });
    // A preference that does not survive a reload is still worth applying for
    // this visit, which is why callers ignore the return.
    expect(writeStored('theme', 'dark')).toBe(false);
  });

  it('reports failure when localStorage is missing entirely', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(writeStored('theme', 'dark')).toBe(false);
  });
});
