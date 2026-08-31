import { describe, expect, it } from 'vitest';
import { porcelainPath } from './worktree-paths.mjs';

/**
 * `isRegenerable` used to be tested here. It is gone with the "safe to remove"
 * verdict it fed, so its tests went with it. What remains is the parsing the
 * report still needs to list what a worktree holds.
 */
describe('porcelainPath', () => {
  it('reads the path out of an ordinary status line', () => {
    expect(porcelainPath('!! apps/api/.env')).toBe('apps/api/.env');
    expect(porcelainPath('?? docs/notes.md')).toBe('docs/notes.md');
    expect(porcelainPath(' M apps/api/prisma/fixtures.ts')).toBe('apps/api/prisma/fixtures.ts');
  });

  it('keeps a collapsed ignored directory as the directory it is', () => {
    // The report lists this verbatim rather than deciding what is inside it.
    // Deciding is what lost a hand typed dist/.env.
    expect(porcelainPath('!! dist/')).toBe('dist/');
    expect(porcelainPath('!! node_modules/')).toBe('node_modules/');
  });

  it('takes the new path of a rename, not the whole "old -> new" string', () => {
    expect(porcelainPath('R  docs/old.md -> apps/api/src/new.ts')).toBe('apps/api/src/new.ts');
    expect(porcelainPath('C  docs/a.md -> docs/b.md')).toBe('docs/b.md');
  });

  it('does not split an ordinary path that happens to contain " -> "', () => {
    expect(porcelainPath(' M docs/a -> b.md')).toBe('docs/a -> b.md');
  });

  it('unquotes a path git quoted because of a space', () => {
    expect(porcelainPath('?? "docs/my file.md"')).toBe('docs/my file.md');
    expect(porcelainPath('R  "docs/old one.md" -> "apps/api/new file.ts"')).toBe(
      'apps/api/new file.ts',
    );
  });

  it('returns null for a line carrying no path', () => {
    expect(porcelainPath('')).toBeNull();
    expect(porcelainPath('!! ')).toBeNull();
    expect(porcelainPath(undefined)).toBeNull();
  });
});
