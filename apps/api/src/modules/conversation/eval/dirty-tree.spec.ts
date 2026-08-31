import { classifyDirtyFiles, isInert } from './dirty-tree';

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
