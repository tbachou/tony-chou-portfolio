import { readFileSync } from 'fs';
import { join } from 'path';

// The interview simulator's agent prompts live as markdown skill files on
// disk beside the module (the repo-wide rule; Beta and Grade already follow
// it — this mirrors their loaders). They ship with the repo checkout, so we
// read from src/ at runtime: process.cwd() is apps/api both in dev and on
// Render. The repo-root fallback covers running the compiled server from the
// monorepo root by hand.
const SKILL_DIR_CANDIDATES = [
  join(process.cwd(), 'src', 'modules', 'conversation', 'skills'),
  join(process.cwd(), 'apps', 'api', 'src', 'modules', 'conversation', 'skills'),
];

const cache = new Map<string, string>();

export type ConversationSkillName = 'interviewer' | 'tony';

export function loadConversationSkill(name: ConversationSkillName): string {
  const cached = cache.get(name);
  if (cached) return cached;

  for (const dir of SKILL_DIR_CANDIDATES) {
    try {
      // trimEnd keeps the prompt byte-identical to the inline constants this
      // loader replaced: a file's trailing newline is an editor artifact,
      // not prompt content, and must not perturb prompt-cache prefixes or
      // the committed eval baseline.
      const content = readFileSync(join(dir, `${name}.md`), 'utf8').trimEnd();
      cache.set(name, content);
      return content;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `Conversation skill file ${name}.md not found in: ${SKILL_DIR_CANDIDATES.join(', ')}`,
  );
}
