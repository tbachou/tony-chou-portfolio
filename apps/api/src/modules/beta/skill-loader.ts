import { readFileSync } from 'fs';
import { join } from 'path';

// Beta's agent prompts live as markdown skill files on disk, mirroring the
// Panel and Carryover pattern (spec 0004). They ship with the repo checkout,
// so we read from src/ at runtime: process.cwd() is apps/api both in dev
// (npm run start:dev --workspace=apps/api) and on Render (start:prod runs
// through the same workspace script). The repo-root fallback covers running
// the compiled server from the monorepo root by hand.
const SKILL_DIR_CANDIDATES = [
  join(process.cwd(), 'src', 'modules', 'beta', 'skills'),
  join(process.cwd(), 'apps', 'api', 'src', 'modules', 'beta', 'skills'),
];

const cache = new Map<string, string>();

export type BetaSkillName = 'screener' | 'drafter' | 'coach';

export function loadBetaSkill(name: BetaSkillName): string {
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
    `Beta skill file ${name}.md not found in: ${SKILL_DIR_CANDIDATES.join(', ')}`,
  );
}
