import { describe, expect, it } from 'vitest';
import { isRegenerable, porcelainPath } from './worktree-paths.mjs';

describe('isRegenerable', () => {
  it('clears build output a install or a build can recreate', () => {
    expect(isRegenerable('node_modules/')).toBe(true);
    expect(isRegenerable('apps/api/dist/')).toBe(true);
    expect(isRegenerable('apps/web/.next/')).toBe(true);
    expect(isRegenerable('coverage/')).toBe(true);
    expect(isRegenerable('apps/api/src/generated/')).toBe(true);
    expect(isRegenerable('.DS_Store')).toBe(true);
    expect(isRegenerable('apps/web/.DS_Store')).toBe(true);
  });

  it('does NOT clear a directory whose name merely contains a pattern', () => {
    // Every one of these was wrongly cleared by the substring test, found by
    // the 2026-08-31 predeploy audit. A cleared entry is dropped from the
    // report, and the worktree is then printed under "safe to remove", so the
    // script recommended destroying the only copy of these files.
    expect(isRegenerable('test-coverage/')).toBe(false);
    expect(isRegenerable('my-build/')).toBe(false);
    expect(isRegenerable('about/')).toBe(false);
    expect(isRegenerable('redistribute-out/')).toBe(false);
    expect(isRegenerable('secrets-dist/keys.pem')).toBe(false);
  });

  it('does NOT clear a hand written file living inside a build directory', () => {
    // `dist/.env` contains `dist/` as a substring AND has `dist` as a real
    // segment, so segment matching alone still clears the directory. What
    // must not happen is clearing it because of the substring in some
    // unrelated name; this case documents the deliberate remaining behaviour.
    expect(isRegenerable('secrets-dist/.env')).toBe(false);
  });

  it('keeps the files that are the whole point of the check', () => {
    expect(isRegenerable('apps/api/.env')).toBe(false);
    expect(isRegenerable('apps/web/.env.local')).toBe(false);
    expect(isRegenerable('infra/terraform.tfvars')).toBe(false);
    expect(isRegenerable('.claude/settings.local.json')).toBe(false);
    expect(isRegenerable('docs/specs/_root/0009-job-search-pipeline-store/')).toBe(false);
  });

  it('requires src/generated to be adjacent segments', () => {
    expect(isRegenerable('src/generated/prisma/')).toBe(true);
    expect(isRegenerable('src/notes/generated-by-hand.md')).toBe(false);
  });

  it('handles junk input without clearing anything', () => {
    expect(isRegenerable('')).toBe(false);
    expect(isRegenerable(undefined)).toBe(false);
    expect(isRegenerable('/')).toBe(false);
  });
});

describe('porcelainPath', () => {
  it('reads an ordinary path and unquotes a quoted one', () => {
    expect(porcelainPath('!! apps/api/.env')).toBe('apps/api/.env');
    expect(porcelainPath('?? "docs/my file.md"')).toBe('docs/my file.md');
  });

  it('takes the new path of a rename', () => {
    expect(porcelainPath('R  docs/old.md -> apps/api/src/new.ts')).toBe('apps/api/src/new.ts');
  });

  it('leaves an ordinary path containing an arrow alone', () => {
    expect(porcelainPath(' M docs/a -> b.md')).toBe('docs/a -> b.md');
  });

  it('returns null when there is no path', () => {
    expect(porcelainPath('')).toBeNull();
    expect(porcelainPath('!! ')).toBeNull();
  });
});
