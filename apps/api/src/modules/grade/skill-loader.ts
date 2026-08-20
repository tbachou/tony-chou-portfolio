import { readFileSync } from 'fs';
import { join } from 'path';

// The grader's prompt lives as a markdown skill file on disk beside this
// module, never inline in code (repo rule). Same resolution strategy as
// Beta's loader: process.cwd() is apps/api both in dev and on Render, with a
// repo-root fallback for running the compiled server from the monorepo root.
const SKILL_DIR_CANDIDATES = [
  join(process.cwd(), 'src', 'modules', 'grade', 'skills'),
  join(process.cwd(), 'apps', 'api', 'src', 'modules', 'grade', 'skills'),
];

const cache = new Map<string, string>();

export type GradeSkillName = 'grader';

export function loadGradeSkill(name: GradeSkillName): string {
  const cached = cache.get(name);
  if (cached) return cached;

  for (const dir of SKILL_DIR_CANDIDATES) {
    try {
      const content = readFileSync(join(dir, `${name}.md`), 'utf8');
      cache.set(name, content);
      return content;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `Grade skill file ${name}.md not found in: ${SKILL_DIR_CANDIDATES.join(', ')}`,
  );
}
