import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { STATUS_ARGS } from './dirty-tree';

/**
 * These run real git against a throwaway repository on purpose. The thing
 * under test IS the pathspec, so a mock would only prove the strings were
 * passed along, and every bug this guard has had came from git behaving in a
 * way the code did not model. No network, no database; the repo is deleted
 * afterwards.
 */

const repos: string[] = [];

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
}

function repo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dirty-tree-'));
  repos.push(root);
  git(['init', '-q', '.'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'test'], root);
  for (const file of [
    'apps/api/src/modules/conversation/skills/interviewer.md',
    'apps/api/prisma/fixtures.ts',
    'packages/shared/contracts.ts',
    'docs/specs/note.md',
    'docs/evals/interview/scoreboard.md',
    'README.md',
  ]) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'original\n');
  }
  git(['add', '-A'], root);
  git(['commit', '-qm', 'init'], root);
  return root;
}

/** What the preflight sees. Empty output means the run may proceed. */
const status = (root: string, cwd = root) => git(STATUS_ARGS, cwd);

afterEach(() => {
  while (repos.length) rmSync(repos.pop() as string, { recursive: true, force: true });
});

describe('commit before you run', () => {
  it('allows a clean tree', () => {
    expect(status(repo())).toBe('');
  });

  it('refuses any uncommitted change, wherever it is', () => {
    // The flat rule: no judgement about whether the file could affect a score.
    // A run cannot claim a commit it does not match.
    for (const file of [
      'apps/api/src/modules/conversation/skills/interviewer.md',
      'apps/api/prisma/fixtures.ts',
      'packages/shared/contracts.ts',
      'docs/specs/note.md',
      'README.md',
    ]) {
      const root = repo();
      writeFileSync(path.join(root, file), 'changed\n');
      expect(status(root)).not.toBe('');
    }
  });

  it('ignores the suite\'s own outputs, the one carve out', () => {
    // Every run rewrites these, so counting them would make the second run in
    // a row always refuse.
    const root = repo();
    writeFileSync(path.join(root, 'docs/evals/interview/scoreboard.md'), 'changed\n');
    writeFileSync(path.join(root, 'docs/evals/interview/results.json'), '{}\n');
    expect(status(root)).toBe('');
  });

  it('still sees a change outside the working directory', () => {
    // The runner executes with cwd = apps/api. A relative pathspec would scope
    // the whole check to that workspace and miss a dirty packages/shared.
    const root = repo();
    writeFileSync(path.join(root, 'packages/shared/contracts.ts'), 'changed\n');
    expect(status(root, path.join(root, 'apps/api'))).toContain('packages/shared');
  });

  it('sees a rename, which a hand written parser twice did not', () => {
    const root = repo();
    git(['mv', 'docs/specs/note.md', 'apps/api/src/renamed.md'], root);
    expect(status(root)).not.toBe('');
  });
});
