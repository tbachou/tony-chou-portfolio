#!/usr/bin/env node
/**
 * Skill layout check (spec 0014, replacing spec 0007's).
 *
 * 0007 vendored every skill and this check enforced that. 0014 splits them by
 * authorship: the skills Tony wrote stay committed here, and third party ones
 * are installed per machine into `~/.claude/skills/` and never committed. So
 * the check now enforces a shape with TWO valid states rather than one, and
 * the interesting rule is the new one: a `registry` skill must NOT have a
 * directory here. That is the regression this file exists to catch, because
 * running `npx skills add` inside the repo silently puts the files back.
 *
 * Every rule is decidable from a plain checkout with NO network calls, which is
 * the point: a check that reached the registry could flake on the registry
 * being down, and would then be disabled, and the layout would rot again.
 *
 * Run locally (`npm run check:skills`) and in CI.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS_DIR = '.claude/skills';
const MANIFEST = 'skills-lock.json';

/** Git's mode for a symlink blob. The failure 0007 existed to kill. */
const SYMLINK_MODE = '120000';

/**
 * The only values `kind` may take.
 *
 * - `authored`  Tony's own. Committed here, and a directory is required.
 * - `registry`  Someone else's. Installed globally, and a directory is a failure.
 * - `vendored`  A registry skill with nowhere to install it from. The escape
 *               hatch in 0014, which requires a directory AND a `reason`.
 *
 * Fails closed: an entry with a missing or unrecognised `kind` is a failure,
 * not a skip. Without that, the registry rule below is a test on a value, so
 * an entry with no `kind` would satisfy it vacuously while holding vendored
 * third party content. That was the live state of `react-markdown` before 0014.
 */
const KINDS_REQUIRING_DIRECTORY = new Set(['authored', 'vendored']);
const VALID_KINDS = new Set(['authored', 'registry', 'vendored']);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
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
      // report a TRACKED path as ignored, and every committed skill is tracked,
      // so this rule would be permanently dead in exactly the state the spec
      // creates. Verified by deliberately re-adding a gitignore line.
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

  // Directory side: unchanged. Anything committed here must be declared.
  for (const name of dirs) {
    if (!entries[name]) failures.push(`${name} has no ${MANIFEST} entry.`);
  }

  // Entry side: branches on kind, which is the half 0014 changed. Before this,
  // any entry without a directory failed, which is precisely the state every
  // registry entry is now meant to be in, so the old rule would have failed
  // permanently after the migration.
  for (const [name, entry] of Object.entries(entries)) {
    const kind = entry?.kind;
    if (!kind || !VALID_KINDS.has(kind)) {
      failures.push(
        `${MANIFEST} entry "${name}" has ${kind ? `an unrecognised kind "${kind}"` : 'no kind'}. ` +
          `Expected one of: ${[...VALID_KINDS].join(', ')}.`,
      );
      continue; // Kind is unusable, so the rules below cannot be judged.
    }

    const hasDirectory = dirs.includes(name);

    if (KINDS_REQUIRING_DIRECTORY.has(kind) && !hasDirectory) {
      failures.push(`${MANIFEST} names "${name}" as ${kind}, but there is no directory under ${SKILLS_DIR}.`);
    }

    if (kind === 'registry' && hasDirectory) {
      failures.push(
        `${SKILLS_DIR}/${name} is committed, but ${MANIFEST} declares it registry, which is installed globally and never committed. ` +
          `Running \`npx skills add\` inside the repo does this. Delete the directory and install it with \`-g\`.`,
      );
    }

    if (kind === 'vendored' && !entry.reason) {
      failures.push(
        `${MANIFEST} entry "${name}" is vendored but records no reason. ` +
          `Vendoring is the exception in spec 0014, so the reason has to be visible rather than silent.`,
      );
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

// Run-if-main, so the rules stay importable by a test.
if (process.argv[1] && process.argv[1].endsWith('check-skills.mjs')) {
  const { dirs, failures } = runChecks();
  if (failures.length > 0) {
    console.error(`Skill layout check FAILED (${failures.length} problem(s)):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(`\nSee docs/specs/_root/0014-agent-skill-storage/index.md`);
    process.exit(1);
  }
  console.log(`Skill layout check passed: ${dirs.length} committed skills, all declared in ${MANIFEST}.`);
}
