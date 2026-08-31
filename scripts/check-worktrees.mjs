#!/usr/bin/env node
/**
 * Reports what every git worktree holds, so you can decide which ones are
 * finished with. It reports; it does not judge, and it never prints a command
 * that deletes anything.
 *
 * That restraint is the whole design, and it was learned three times over.
 * This script exists because on 2026-08-31 an eval run was started by accident
 * in a merged worktree that still held uncommitted files: it cost real budget
 * and produced a result no commit could reproduce. Every version since has
 * tried to answer "is this one safe to delete?", and every version got that
 * answer wrong in a new way:
 *
 *   1. `git status` does not list ignored files, so a worktree holding a
 *      `.env` looked clean and was printed as safe to remove.
 *   2. The regenerable filter matched substrings, so `test-coverage/` matched
 *      `coverage/` and hand written notes were cleared.
 *   3. `--ignored=matching` collapses a wholly ignored directory to one entry,
 *      so `!! dist/` cleared everything inside it, including a hand typed
 *      `dist/.env`. Confirmed by removing the worktree and losing the file.
 *
 * Each fix was right about the case in front of it and left the shape intact:
 * a wrong verdict here destroys data, and there is always another case. So the
 * verdict is gone. What is left is the part that was always useful, which is
 * seeing what a directory holds before you decide, including the ignored files
 * a plain `git status` would never show you.
 */

import { execFileSync } from 'node:child_process';
import { porcelainPath } from './worktree-paths.mjs';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function baseRef() {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      git(['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      // try the next one
    }
  }
  return null;
}

const base = baseRef();
if (!base) {
  console.error('check:worktrees — no main/master ref found; nothing to compare against.');
  process.exit(0);
}

const worktrees = [];
let current = {};
// `git worktree list` always names the primary checkout first. It cannot be
// removed, so it is marked and left out of the "finished with?" section.
let first = true;
for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
  if (line.startsWith('worktree ')) {
    current = { path: line.slice(9), primary: first };
    first = false;
  } else if (line.startsWith('branch ')) {
    current.branch = line.slice(7).replace('refs/heads/', '');
  } else if (line.startsWith('detached')) {
    current.branch = '(detached)';
  } else if (line === '') {
    if (current.path) worktrees.push(current);
    current = {};
  }
}
if (current.path) worktrees.push(current);

const rows = worktrees.map((wt) => {
  let unmerged = null;
  let tracked = [];
  let ignored = [];
  try {
    unmerged = Number(git(['rev-list', '--count', `${base}..HEAD`], wt.path));
  } catch {
    /* unreadable worktree */
  }
  try {
    // --ignored=matching collapses a wholly ignored directory into one entry,
    // which keeps this cheap with node_modules present. Nothing is filtered
    // out of the result: a collapsed directory can contain anything, and
    // deciding it cannot is exactly the mistake this script stopped making.
    const lines = git(['status', '--porcelain', '--ignored=matching'], wt.path)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    tracked = lines.filter((l) => !l.startsWith('!!'));
    ignored = lines
      .filter((l) => l.startsWith('!!'))
      .map((l) => porcelainPath(l))
      .filter((f) => f !== null);
  } catch {
    /* unreadable worktree */
  }
  return { ...wt, unmerged, tracked, ignored };
});

const name = (r) => r.path.split('/').pop() + (r.primary ? ' (main)' : '');
const pad = (s, n) => String(s).padEnd(n);
const width = Math.max(20, ...rows.map((r) => name(r).length));

console.log(`\nWorktrees, compared against ${base}:\n`);
console.log(`  ${pad('directory', width)}  ${pad('branch', 38)}  unmerged  uncommitted  ignored`);
console.log(`  ${'-'.repeat(width)}  ${'-'.repeat(38)}  --------  -----------  -------`);
for (const r of rows) {
  console.log(
    `  ${pad(name(r), width)}  ${pad(r.branch ?? '?', 38)}  ` +
      `${pad(r.unmerged ?? '?', 8)}  ${pad(r.tracked.length, 11)}  ${r.ignored.length}`,
  );
}

const list = (label, entries) => {
  if (entries.length === 0) return;
  console.log(`    ${label}`);
  for (const entry of entries.slice(0, 12)) console.log(`      ${entry}`);
  if (entries.length > 12) console.log(`      … and ${entries.length - 12} more`);
};

const merged = rows.filter((r) => !r.primary && r.unmerged === 0);

if (merged.length === 0) {
  console.log('\n✓ Every worktree holds commits that are not on the base branch.\n');
} else {
  console.log(
    `\nFully merged, so nothing in them is missing from ${base}. ` +
      'Here is what each one still holds:\n',
  );
  for (const r of merged) {
    console.log(`  ${r.path}`);
    list('uncommitted:', r.tracked);
    list('ignored (a plain git status never shows these):', r.ignored);
    if (r.tracked.length === 0 && r.ignored.length === 0) {
      console.log('    nothing: no uncommitted files, no ignored files');
    }
    console.log('');
  }
  console.log(
    '  Removing a worktree deletes its whole directory, everything listed above\n' +
      '  included. Read the list, then remove the ones you are done with yourself.\n' +
      '  Never run anything that spends money from a directory you have not checked.\n',
  );
}
