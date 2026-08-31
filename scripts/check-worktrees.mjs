#!/usr/bin/env node
/**
 * Reports every git worktree with the two facts that decide whether it is
 * still useful: does it hold commits that are not on main, and does it hold
 * uncommitted work?
 *
 * This exists because of a specific, expensive failure on 2026-08-31. A
 * worktree whose branch had been fully merged was still on disk, still had a
 * shell pointing at it, and still held two uncommitted files. An eval run was
 * started there by accident. It cost real budget and produced a result that
 * could not be tied to a commit, and the state it measured existed nowhere
 * else. See docs/evals/interview/0012-phase-two-public-evals-page.md.
 *
 * Two shapes are worth acting on, and they are different problems:
 *
 *   MERGED + DIRTY   the trap. Nothing here is unmerged, so the directory
 *                    looks disposable, but deleting it silently destroys the
 *                    uncommitted work. Rescue the changes, then remove it.
 *   MERGED + CLEAN   pure residue. Safe to remove, and worth removing,
 *                    because every one of these is a directory a stale
 *                    terminal tab can still be sitting in.
 *
 * Read only. It never deletes anything: the whole point is that the dangerous
 * case is the one where automatic cleanup would lose work.
 *
 * Ignored files are counted too, and this is not a detail. `git status` does
 * not list them, so a worktree holding a `.env` reports as clean and reads as
 * safe to delete, while `git worktree remove` takes the whole directory and
 * the file with it. That is the same shape of loss this script exists to
 * prevent, hidden one level deeper.
 */

import { execFileSync } from 'node:child_process';
import { isRegenerable, porcelainPath } from './worktree-paths.mjs';

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
// `git worktree list` always names the primary checkout first. It can never
// be removed, and suggesting it would be actively dangerous, so mark it.
let first = true;
for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
  if (line.startsWith('worktree ')) {
    current = { path: line.slice(9), primary: first };
    first = false;
  }
  else if (line.startsWith('branch ')) current.branch = line.slice(7).replace('refs/heads/', '');
  else if (line.startsWith('detached')) current.branch = '(detached)';
  else if (line === '') {
    if (current.path) worktrees.push(current);
    current = {};
  }
}
if (current.path) worktrees.push(current);

const rows = worktrees.map((wt) => {
  let unmerged = null;
  let dirty = null;
  let dirtyFiles = [];
  try {
    unmerged = Number(git(['rev-list', '--count', `${base}..HEAD`], wt.path));
  } catch {
    /* unreadable worktree */
  }
  let hidden = [];
  try {
    // --ignored=matching collapses a wholly ignored directory into one entry,
    // so this stays cheap even with node_modules present.
    const lines = git(['status', '--porcelain', '--ignored=matching'], wt.path)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    dirtyFiles = lines.filter((l) => !l.startsWith('!!'));
    dirty = dirtyFiles.length;
    hidden = lines
      .filter((l) => l.startsWith('!!'))
      .map((l) => porcelainPath(l))
      .filter((f) => f !== null && !isRegenerable(f));
  } catch {
    /* unreadable worktree */
  }
  return { ...wt, unmerged, dirty, dirtyFiles, hidden };
});

const name = (p) => p.split('/').pop();
const pad = (s, n) => String(s).padEnd(n);
const width = Math.max(20, ...rows.map((r) => name(r.path).length + (r.primary ? 7 : 0)));

console.log(`\nWorktrees, compared against ${base}:\n`);
console.log(`  ${pad('directory', width)}  ${pad('branch', 38)}  unmerged  uncommitted`);
console.log(`  ${'-'.repeat(width)}  ${'-'.repeat(38)}  --------  -----------`);
for (const r of rows) {
  console.log(
    `  ${pad(name(r.path) + (r.primary ? ' (main)' : ''), width)}  ${pad(r.branch ?? '?', 38)}  ${pad(r.unmerged ?? '?', 8)}  ${r.dirty ?? '?'}`,
  );
}

// The primary checkout is never residue, whatever its branch says.
const traps = rows.filter((r) => !r.primary && r.unmerged === 0 && r.dirty > 0);
// Merged, clean to `git status`, but holding local only files git never shows.
// Removing one of these looks free and is not.
const quietTraps = rows.filter(
  (r) => !r.primary && r.unmerged === 0 && r.dirty === 0 && r.hidden.length > 0,
);
const residue = rows.filter(
  (r) => !r.primary && r.unmerged === 0 && r.dirty === 0 && r.hidden.length === 0,
);

if (traps.length > 0) {
  console.log('\n⚠ MERGED BUT DIRTY — work here exists nowhere else, and the directory looks disposable:');
  for (const r of traps) {
    console.log(`\n  ${r.path}`);
    for (const f of r.dirtyFiles.slice(0, 10)) console.log(`      ${f}`);
    if (r.dirtyFiles.length > 10) console.log(`      … and ${r.dirtyFiles.length - 10} more`);
  }
  console.log('\n  Commit or move these somewhere real, THEN remove the worktree.');
  console.log('  Do not run anything that costs money from one of these directories.');
}

if (quietTraps.length > 0) {
  console.log(
    '\n⚠ MERGED AND CLEAN, BUT holding local only files git never lists —',
  );
  console.log('  removing these takes the files with them:');
  for (const r of quietTraps) {
    console.log(`\n  ${r.path}`);
    for (const f of r.hidden.slice(0, 10)) console.log(`      ${f}  (ignored)`);
    if (r.hidden.length > 10) console.log(`      … and ${r.hidden.length - 10} more`);
  }
  console.log('\n  Copy anything you still need out first, then remove the worktree.');
}

if (residue.length > 0) {
  console.log('\n· Merged and clean — safe to remove, and worth removing:');
  for (const r of residue) console.log(`    git worktree remove ${r.path}`);
}

if (traps.length === 0 && quietTraps.length === 0 && residue.length === 0) {
  console.log('\n✓ Every worktree holds unmerged work. Nothing stale.');
}

console.log('');
// Never fails the build: this is a hygiene report, and the dangerous case
// needs a human to decide what the uncommitted work was for.
