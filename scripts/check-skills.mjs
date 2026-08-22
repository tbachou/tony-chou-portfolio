#!/usr/bin/env node
/**
 * Skill layout check (spec 0007).
 *
 * Fails when the `.claude/skills/` layout drifts back toward any of the five
 * storage mechanisms that produced a broken checkout: a committed symlink into
 * a gitignored directory, a skill gitignored by name, a duplicate copy, a
 * restore-on-install lock file, or a hand copy.
 *
 * Every rule is decidable from a plain checkout with NO network calls, which is
 * the point: a check that reached the registry could flake on the registry
 * being down, and would then be disabled, and the layout would rot again.
 *
 * Run locally (`npm run check:skills`) and in CI. Local first is deliberate:
 * CI here runs on push to main and there is no PR flow, so a CI-only check
 * fires after the drift has already reached every worktree.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKILLS_DIR = '.claude/skills';
const MANIFEST = 'skills-lock.json';

/** Git's mode for a symlink blob. The failure this whole spec exists to kill. */
const SYMLINK_MODE = '120000';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/** Every file in a skill directory, as repo-relative paths, sorted. */
export function skillFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(dir);
  // Sort on the POSIX form so the hash is identical on Windows.
  return out.sort((a, b) => a.split(sep).join('/').localeCompare(b.split(sep).join('/')));
}

/**
 * sha256 over a skill directory: sorted relative paths, then contents.
 *
 * Paths are folded in as well as contents so that renaming a file changes the
 * hash. Hashing contents alone would call a rename identical.
 */
export function computeSkillHash(dir) {
  const hash = createHash('sha256');
  for (const file of skillFiles(dir)) {
    hash.update(relative(dir, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function listSkillDirs() {
  if (!existsSync(SKILLS_DIR)) return [];
  // lstat, not stat: a symlink to a directory must NOT be counted as a skill
  // directory, or the thing this check exists to catch would look valid.
  return readdirSync(SKILLS_DIR)
    .filter((name) => lstatSync(join(SKILLS_DIR, name)).isDirectory())
    .sort();
}

function checkNoSymlinks(failures) {
  // Covers all of .claude/, not just skills: .claude/agents/ and
  // .claude/commands/ sit next door and could grow the same defect.
  const tracked = git(['ls-files', '-s', '.claude']).trim().split('\n').filter(Boolean);
  for (const line of tracked) {
    const [mode, , , path] = line.split(/\s+/);
    if (mode === SYMLINK_MODE) {
      failures.push(`${path} is stored by git as a symlink (mode ${SYMLINK_MODE}). Commit the real files instead.`);
    }
  }
}

function checkNotIgnored(failures, dirs) {
  // Tested with `git check-ignore` rather than "present but untracked",
  // because a CI checkout has no untracked files at all, so the untracked
  // form of this rule could never fire in the place it actually runs.
  for (const name of dirs) {
    const path = `${SKILLS_DIR}/${name}`;
    try {
      // `--no-index` is load bearing, not tidiness. Without it git refuses to
      // report a TRACKED path as ignored, and after this migration every skill
      // is tracked, so this rule would be permanently dead in exactly the state
      // the spec creates. Verified by deliberately re-adding a gitignore line.
      execFileSync('git', ['check-ignore', '--no-index', '-q', path], { stdio: 'ignore' });
      failures.push(`${path} is matched by a gitignore rule, so it is absent from a fresh clone.`);
    } catch {
      // Exit code 1 means "not ignored", which is what we want.
    }
  }
}

function checkHasSkillMd(failures, dirs) {
  for (const name of dirs) {
    if (!existsSync(join(SKILLS_DIR, name, 'SKILL.md'))) {
      failures.push(`${SKILLS_DIR}/${name} has no SKILL.md.`);
    }
  }
}

function checkManifest(failures, dirs) {
  if (!existsSync(MANIFEST)) {
    failures.push(`${MANIFEST} is missing.`);
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const entries = manifest.skills ?? {};
  for (const name of dirs) {
    if (!entries[name]) failures.push(`${name} has no ${MANIFEST} entry.`);
  }
  for (const name of Object.keys(entries)) {
    if (!dirs.includes(name)) {
      failures.push(`${MANIFEST} names "${name}", which is not a directory under ${SKILLS_DIR}.`);
    }
  }
}

export function runChecks() {
  const dirs = listSkillDirs();
  const failures = [];
  checkNoSymlinks(failures);
  checkNotIgnored(failures, dirs);
  checkHasSkillMd(failures, dirs);
  checkManifest(failures, dirs);
  return { dirs, failures };
}

// Run-if-main, so the manifest generator can import the hash function.
if (process.argv[1] && process.argv[1].endsWith('check-skills.mjs')) {
  const { dirs, failures } = runChecks();
  if (failures.length > 0) {
    console.error(`Skill layout check FAILED (${failures.length} problem(s)):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(`\nSee docs/specs/_root/0007-agent-skills-storage-distribution/index.md`);
    process.exit(1);
  }
  console.log(`Skill layout check passed: ${dirs.length} skills, all committed real files with manifest entries.`);
}
