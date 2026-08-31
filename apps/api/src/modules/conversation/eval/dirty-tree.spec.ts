import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  ALL_STATUS_ARGS,
  INERT_PATHSPECS,
  MATERIAL_STATUS_ARGS,
} from './dirty-tree';

/**
 * These run real git against a throwaway repository on purpose.
 *
 * The thing under test IS the pathspec, and a mock would only prove that the
 * strings were passed along. Every bug this guard has had came from git
 * behaving in a way the code did not model (a rename printing two paths, a
 * quoted path, a relative pathspec scoping to the working directory), so the
 * test has to ask the same git the runner asks. No network, no database, and
 * the repository is deleted afterwards.
 */

const repos: string[] = [];

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
}

/** A repo shaped like this one: material areas, and inert ones beside them. */
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
    'apps/web/src/app/page.tsx',
    'docs/specs/note.md',
    'docs/evals/interview/scoreboard.md',
    'skills-lock.json',
  ]) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'original\n');
  }
  git(['add', '-A'], root);
  git(['commit', '-qm', 'init'], root);
  return root;
}

/** Runs the preflight's two questions the way the runner runs them. */
function status(root: string, cwd = root) {
  return {
    all: git(ALL_STATUS_ARGS, cwd),
    material: git(MATERIAL_STATUS_ARGS, cwd),
  };
}

afterEach(() => {
  while (repos.length) rmSync(repos.pop() as string, { recursive: true, force: true });
});

describe('what counts as material', () => {
  it('a clean tree is clean, so the run proceeds', () => {
    const root = repo();
    expect(status(root).all).toBe('');
    expect(status(root).material).toBe('');
  });

  it('refuses a changed prompt', () => {
    const root = repo();
    writeFileSync(
      path.join(root, 'apps/api/src/modules/conversation/skills/interviewer.md'),
      'changed\n',
    );
    expect(status(root).material).toContain('interviewer.md');
  });

  it('refuses a changed fixture, which is the eval corpus', () => {
    const root = repo();
    writeFileSync(path.join(root, 'apps/api/prisma/fixtures.ts'), 'changed\n');
    expect(status(root).material).toContain('fixtures.ts');
  });

  it('allows a changed spec, and says the tree differs anyway', () => {
    // The case that cost a paid run when the rule was "any dirt is a defect".
    const root = repo();
    writeFileSync(path.join(root, 'docs/specs/note.md'), 'changed\n');
    expect(status(root).material).toBe('');
    expect(status(root).all).toContain('docs/specs/note.md');
  });

  it('allows a changed skills-lock.json and a changed web app', () => {
    const root = repo();
    writeFileSync(path.join(root, 'skills-lock.json'), 'changed\n');
    writeFileSync(path.join(root, 'apps/web/src/app/page.tsx'), 'changed\n');
    expect(status(root).material).toBe('');
  });

  it('never lists the suite\'s own outputs, which every run rewrites', () => {
    const root = repo();
    writeFileSync(path.join(root, 'docs/evals/interview/scoreboard.md'), 'changed\n');
    expect(status(root).all).toBe('');
    expect(status(root).material).toBe('');
  });
});

describe('the cases that defeated the hand written parser', () => {
  it('refuses a rename INTO a prompt file, judging the destination', () => {
    // `R  old -> new` was matched whole, and it started with `docs/`, so a
    // renamed prompt was waved through and a paid run measured it.
    const root = repo();
    git(
      [
        'mv',
        'docs/specs/note.md',
        'apps/api/src/modules/conversation/skills/renamed-prompt.md',
      ],
      root,
    );
    expect(status(root).material).toContain('renamed-prompt.md');
  });

  it('refuses a rename whose OLD path was under docs/evals', () => {
    // This one was dropped entirely: the string began docs/evals/, the filter
    // removed it, and the banner printed "clean" with the file listed nowhere.
    const root = repo();
    git(
      ['mv', 'docs/evals/interview/scoreboard.md', 'apps/api/src/moved-in.md'],
      root,
    );
    expect(status(root).material).toContain('moved-in.md');
  });

  it('still allows a rename OUT of a material area into an inert one', () => {
    const root = repo();
    git(['mv', 'apps/api/prisma/fixtures.ts', 'docs/specs/retired.ts'], root);
    // The file the suite loaded is gone, which git records as a deletion under
    // a material path, so this is correctly still a refusal.
    expect(status(root).material).toContain('fixtures.ts');
  });

  it('refuses a material path that git has to quote', () => {
    const root = repo();
    const quoted = path.join(root, 'apps/api/src/needs quoting.ts');
    writeFileSync(quoted, 'x\n');
    git(['add', '-A'], root);
    expect(status(root).material).toContain('quoting');
  });

  it('is not fooled by a directory whose name merely starts with an inert one', () => {
    // The old prefix test happened to get this right too, because its prefixes
    // carried a trailing slash. Pinned anyway: it is the property that makes
    // the exclusion safe, and it should not depend on remembering the slash.
    const root = repo();
    const sneaky = path.join(root, 'apps/webhooks/handler.ts');
    mkdirSync(path.dirname(sneaky), { recursive: true });
    writeFileSync(sneaky, 'x\n');
    git(['add', '-A'], root);
    expect(status(root).material).toContain('webhooks');
  });
});

describe('the pathspec itself', () => {
  it('sees a material change outside the working directory', () => {
    // The runner executes with cwd = apps/api. A relative pathspec scoped the
    // whole check to that workspace, so a dirty packages/shared went unseen.
    const root = repo();
    writeFileSync(path.join(root, 'packages/shared/contracts.ts'), 'changed\n');
    const fromApi = status(root, path.join(root, 'apps/api'));
    expect(fromApi.material).toContain('packages/shared/contracts.ts');
  });

  it('anchors every exclusion at the repo root', () => {
    // Without the leading slash an exclusion is relative to the cwd, which is
    // how the check above silently narrows.
    for (const spec of INERT_PATHSPECS) {
      expect(spec.startsWith(':!/')).toBe(true);
    }
  });

  it('excludes the harmless rather than listing the dangerous', () => {
    // An area nobody has thought of must be material by default. If this ever
    // becomes a list of material paths, a new source tree gets waved through.
    expect(MATERIAL_STATUS_ARGS.filter((a) => a.startsWith(':!'))).not.toHaveLength(0);
    expect(MATERIAL_STATUS_ARGS.filter((a) => a === ':/')).toHaveLength(1);
  });
});
