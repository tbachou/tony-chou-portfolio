import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GradePhoto } from '@/lib/grade-photos-api';

/**
 * The one guarantee on this page that is not merely cosmetic: the release
 * readiness count.
 *
 * "Playable on release" is narrower than "active", because an unlicensed test
 * photo is active today and refused the moment the game goes live (AC-18). If
 * this number counted active rows, the page would report a pool of ten while
 * the released game had eight and repeated every eight days — and the R8
 * checklist ("upload a real pool of 10 or more") would pass on a pool that
 * does not exist. That is worth a test; the form's field wiring is not.
 */
let pool: GradePhoto[] = [];
let listFails = false;

vi.mock('@/lib/grade-photos-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/grade-photos-api')>();
  return {
    ...actual,
    fetchGradePhotos: vi.fn(async () => {
      if (listFails) throw new Error('Your session has expired. Sign in again.');
      return pool;
    }),
  };
});

vi.mock('@/lib/auth-client', () => ({
  signOut: vi.fn(),
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}));

const { GradePhotoAdmin } = await import('./GradePhotoAdmin');

function photo(overrides: Partial<GradePhoto> = {}): GradePhoto {
  return {
    id: 'north-gym-prow',
    trueGrade: 4,
    source: 'own_photo',
    sourceNote: null,
    note: null,
    active: true,
    createdAt: '2026-08-21T10:00:00.000Z',
    imageUrl: 'https://bucket.s3.us-east-2.amazonaws.com/photos/abc.webp?sig=1',
    ...overrides,
  };
}

/**
 * Read the number under one of the summary tiles.
 *
 * Scoped to the summary list rather than the whole document: labels like
 * "ACTIVE" also appear as the status of each row in the pool below.
 */
function tile(label: string): string {
  const summary = document.querySelector('dl');
  if (!summary) throw new Error('summary tiles are not rendered');
  const term = Array.from(summary.querySelectorAll('dt')).find(
    (node) => node.textContent === label,
  );
  return term?.parentElement?.querySelector('dd')?.textContent ?? '';
}

beforeEach(() => {
  pool = [];
  listFails = false;
});

afterEach(cleanup);

describe('GradePhotoAdmin release readiness', () => {
  it('counts an unlicensed test photo as active but NOT as playable', async () => {
    pool = [
      photo({ id: 'mine', source: 'own_photo' }),
      photo({ id: 'borrowed', source: 'unlicensed_test' }),
    ];

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() => expect(tile('ACTIVE')).toBe('2'));
    expect(tile('PLAYABLE ON RELEASE')).toContain('1');
  });

  it('excludes a deactivated photo from the playable count', async () => {
    pool = [
      photo({ id: 'live', active: true }),
      photo({ id: 'retired', active: false }),
    ];

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() => expect(tile('IN POOL')).toBe('2'));
    expect(tile('ACTIVE')).toBe('1');
    expect(tile('PLAYABLE ON RELEASE')).toContain('1');
  });

  it('says how many photos the licence gate will block', async () => {
    pool = [
      photo({ id: 'a', source: 'unlicensed_test' }),
      photo({ id: 'b', source: 'unlicensed_test' }),
      photo({ id: 'c' }),
    ];

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() =>
      expect(
        screen.getByText(/2 active photos are marked as an unlicensed test image/i),
      ).toBeTruthy(),
    );
  });

  it('reports the cycle length from the playable pool, not the active one', async () => {
    // The cycle repeats every poolSize days, and poolSize at release is the
    // eligible count. Reporting 3 here when the game would repeat every 2 is
    // the same lie in a different tile.
    pool = [
      photo({ id: 'a' }),
      photo({ id: 'b' }),
      photo({ id: 'c', source: 'unlicensed_test' }),
    ];

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() => expect(tile('CYCLE REPEATS EVERY')).toBe('2d'));
  });

  it('names the grades with no playable photo yet', async () => {
    pool = [photo({ id: 'a', trueGrade: 0 }), photo({ id: 'b', trueGrade: 8 })];

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() => expect(screen.getByText(/No playable photo yet/i)).toBeTruthy());
    const message = screen.getByText(/No playable photo yet/i).textContent ?? '';
    expect(message).toContain('V1');
    expect(message).toContain('V7');
    expect(message).not.toContain('V0');
    expect(message).not.toContain('V8');
  });

  it('does not count an unlicensed test photo towards grade coverage', async () => {
    pool = Array.from({ length: 9 }, (_, grade) =>
      photo({
        id: `v${grade}`,
        trueGrade: grade,
        source: grade === 3 ? 'unlicensed_test' : 'own_photo',
      }),
    );

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() => expect(screen.getByText(/No playable photo yet/i)).toBeTruthy());
    expect(screen.getByText(/No playable photo yet/i).textContent).toContain('V3');
  });

  it('confirms full coverage only when every grade is playable', async () => {
    pool = Array.from({ length: 9 }, (_, grade) =>
      photo({ id: `v${grade}`, trueGrade: grade }),
    );

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() =>
      expect(screen.getByText(/Every grade from V0 to V8/i)).toBeTruthy(),
    );
  });
});

describe('GradePhotoAdmin states', () => {
  it('shows the empty pool state and says the game is unplayable', async () => {
    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() => expect(screen.getByText('POOL IS EMPTY.')).toBeTruthy());
    expect(screen.getByText(/serves 503 until at least one photo is active/i)).toBeTruthy();
  });

  it('surfaces a load failure instead of an empty pool', async () => {
    // An expired session must not read as "you have no photos", which would
    // invite re-uploading a pool that is already there.
    listFails = true;

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('session has expired'),
    );
    expect(screen.queryByText('POOL IS EMPTY.')).toBeNull();
  });

  it('renders each photo with an alt text that names its grade', async () => {
    pool = [photo({ id: 'north-gym-prow', trueGrade: 6 })];

    render(<GradePhotoAdmin email="tony@example.com" />);

    await waitFor(() =>
      expect(
        screen.getByAltText('Boulder problem north-gym-prow, graded V6'),
      ).toBeTruthy(),
    );
  });
});
