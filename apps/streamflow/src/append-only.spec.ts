import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything the scan must not walk into. `generated` holds the Prisma client,
 * which offers update and delete for every model: that is the client's whole
 * surface, and the rule is about what we call, not what exists.
 */
const SKIP_DIRECTORIES = new Set([
  'generated',
  'node_modules',
  'dist',
  'coverage',
  'migrations',
]);

/** The workspace root, so scripts/ is covered as well as src/. */
const WORKSPACE_ROOT = join(__dirname, '..');

/**
 * Guards the store's central invariant across the whole workspace rather than
 * at one call site: an observation is never updated and never deleted, so a
 * changed reading can only ever arrive as a new row with a later recordedAt.
 *
 * This is a source scan on purpose. A mocked client can only prove that one
 * tested path behaves; it cannot prove that no other file quietly mutates the
 * table, and that is the property worth holding onto as later slices land.
 */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...sourceFiles(path));
      continue;
    }

    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(path);
    }
  }

  return found;
}

const FORBIDDEN = [
  'observation.update',
  'observation.updateMany',
  'observation.delete',
  'observation.deleteMany',
  'observation.upsert',
];

describe('the observation store is append only', () => {
  const files = sourceFiles(WORKSPACE_ROOT);

  it('finds the pipeline sources to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('covers scripts as well as src, since scripts write to the store too', () => {
    const areas = ['/src/', '/scripts/'];

    for (const area of areas) {
      expect(files.some((file) => file.includes(area))).toBe(true);
    }
  });

  it.each(FORBIDDEN)('never calls %s', (call) => {
    const offenders = files.filter((file) =>
      readFileSync(file, 'utf8').includes(call),
    );

    expect(offenders).toEqual([]);
  });

  it('never issues UPDATE or DELETE against the observations table', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /\b(update|delete)\s+(from\s+)?"?observations"?/i.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
