import { classifyDirtyFiles, isInert, porcelainPath } from './dirty-tree';

describe('porcelainPath', () => {
  it('reads the path out of an ordinary status line', () => {
    expect(porcelainPath(' M apps/api/prisma/fixtures.ts')).toBe('apps/api/prisma/fixtures.ts');
    expect(porcelainPath('?? docs/notes.md')).toBe('docs/notes.md');
    expect(porcelainPath('MM apps/web/src/app/page.tsx')).toBe('apps/web/src/app/page.tsx');
  });

  it('takes the NEW path of a rename, not the whole "old -> new" string', () => {
    // The 2026-08-31 predeploy audit found this by running it. Slicing off the
    // status and stopping left the whole string, which starts with `docs/`, so
    // a renamed interviewer prompt was waved through as inert and a paid run
    // proceeded against modified prompts.
    expect(
      porcelainPath(
        'R  docs/oldname.md -> apps/api/src/modules/conversation/skills/interviewer.md',
      ),
    ).toBe('apps/api/src/modules/conversation/skills/interviewer.md');
    expect(porcelainPath('RM docs/evals/x.json -> apps/api/src/prompt.ts')).toBe(
      'apps/api/src/prompt.ts',
    );
    expect(porcelainPath('C  docs/a.md -> apps/api/prisma/fixtures.ts')).toBe(
      'apps/api/prisma/fixtures.ts',
    );
  });

  it('does not split an ordinary path that happens to contain " -> "', () => {
    // Only a rename or copy carries two paths. Splitting unconditionally would
    // corrupt this one and report the wrong file.
    expect(porcelainPath(' M docs/a -> b.md')).toBe('docs/a -> b.md');
  });

  it('unquotes a path git quoted because of a space', () => {
    expect(porcelainPath('?? "docs/my file.md"')).toBe('docs/my file.md');
    expect(porcelainPath('R  "docs/old one.md" -> "apps/api/src/new file.ts"')).toBe(
      'apps/api/src/new file.ts',
    );
  });

  it('returns null for a line carrying no path', () => {
    expect(porcelainPath('')).toBeNull();
    expect(porcelainPath('M')).toBeNull();
    expect(porcelainPath(' M ')).toBeNull();
  });
});

describe('rename classification, end to end', () => {
  it('refuses a rename whose destination is a file the suite loads', () => {
    // The exact failing input from the audit: old path inert, new path a live
    // prompt. Parsing first is what makes the classifier see the real target.
    const line = 'R  docs/oldname.md -> apps/api/src/modules/conversation/skills/interviewer.md';
    const parsed = porcelainPath(line) as string;
    expect(isInert(parsed)).toBe(false);
    expect(classifyDirtyFiles([parsed]).material).toEqual([
      'apps/api/src/modules/conversation/skills/interviewer.md',
    ]);
  });

  it('still allows a rename whose destination the suite never reads', () => {
    const parsed = porcelainPath('R  apps/api/prisma/fixtures.ts -> docs/renamed.ts') as string;
    expect(isInert(parsed)).toBe(true);
  });
});

describe('isInert', () => {
  it('treats the suite\'s own outputs as inert, since every run rewrites them', () => {
    expect(isInert('docs/evals/interview/scoreboard.md')).toBe(true);
    expect(isInert('docs/evals/interview/baseline.json')).toBe(true);
    expect(isInert('docs/specs/_root/0012-grounded-portfolio-agent/index.md')).toBe(true);
  });

  it('treats the two files from the 2026-08-31 incident as inert', () => {
    // The run flagged dirty by these was reproducible, and refusing it would
    // have bought a second paid run for nothing. This is the case the module
    // exists to get right.
    expect(isInert('skills-lock.json')).toBe(true);
    expect(isInert('docs/specs/_root/0012-grounded-portfolio-agent/0012-public-evals-page.md')).toBe(
      true,
    );
  });

  it('treats surfaces the suite never executes as inert', () => {
    expect(isInert('apps/web/src/app/page.tsx')).toBe(true);
    expect(isInert('apps/streamflow/src/config.ts')).toBe(true);
    expect(isInert('.github/workflows/ci.yml')).toBe(true);
    expect(isInert('README.md')).toBe(true);
  });

  it('treats everything the suite actually loads as material', () => {
    expect(isInert('apps/api/src/modules/conversation/ownership-guard.ts')).toBe(false);
    expect(isInert('apps/api/src/modules/conversation/skills/tony.md')).toBe(false);
    expect(isInert('apps/api/prisma/fixtures.ts')).toBe(false);
    expect(isInert('apps/api/scripts/interview-eval/golden.ts')).toBe(false);
    expect(isInert('packages/shared/contracts.ts')).toBe(false);
  });

  it('fails safe: an unknown area counts as material rather than harmless', () => {
    // The allow list names the harmless. A new top level directory nobody
    // thought about must stop the run, not be waved through.
    expect(isInert('apps/brand-new-service/src/main.ts')).toBe(false);
    expect(isInert('package-lock.json')).toBe(false);
    expect(isInert('some-new-root-file.ts')).toBe(false);
  });

  it('matches a bare file name exactly, not as a prefix', () => {
    // `README.md` is inert; a different file whose name merely starts with it
    // is not, or `README.md.backup.ts` would slip through.
    expect(isInert('README.md')).toBe(true);
    expect(isInert('README.md.ts')).toBe(false);
    expect(isInert('apps/api/README.md')).toBe(false);
  });

  it('does not treat a path that merely contains an inert segment as inert', () => {
    // The check is anchored at the start, so a source file under a directory
    // named `docs` inside the api is still material.
    expect(isInert('apps/api/src/docs/loader.ts')).toBe(false);
  });
});

describe('classifyDirtyFiles', () => {
  it('splits a mixed list and keeps every file in exactly one bucket', () => {
    const files = [
      'skills-lock.json',
      'apps/api/prisma/fixtures.ts',
      'docs/evals/interview/scoreboard.md',
      'apps/api/src/modules/conversation/ownership-guard.ts',
    ];
    const { inert, material } = classifyDirtyFiles(files);
    expect(inert).toEqual(['skills-lock.json', 'docs/evals/interview/scoreboard.md']);
    expect(material).toEqual([
      'apps/api/prisma/fixtures.ts',
      'apps/api/src/modules/conversation/ownership-guard.ts',
    ]);
    expect(inert.length + material.length).toBe(files.length);
  });

  it('reports no material files for a clean tree, so the run proceeds', () => {
    expect(classifyDirtyFiles([])).toEqual({ inert: [], material: [] });
  });

  it('reports no material files when everything differing is inert', () => {
    // This is the case that must NOT refuse: the run is reproducible from its
    // commit even though git calls the tree dirty.
    const { material } = classifyDirtyFiles(['skills-lock.json', 'README.md']);
    expect(material).toEqual([]);
  });
});
