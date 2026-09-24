import { readFileSync } from 'fs';
import { join } from 'path';

// The interview simulator's agent prompts live as markdown skill files on
// disk beside the module (the repo-wide rule; Beta and Grade already follow
// it — this mirrors their loaders). They ship with the repo checkout, so we
// read from src/ at runtime: process.cwd() is apps/api both in dev and on
// Render. The repo-root fallback covers running the compiled server from the
// monorepo root by hand.
const MODULE_ROOT_CANDIDATES = [
  join(process.cwd(), 'src', 'modules', 'conversation'),
  join(process.cwd(), 'apps', 'api', 'src', 'modules', 'conversation'),
];

/**
 * Where each prompt lives, relative to the conversation module root.
 *
 * Both the name union and the directory list used to be closed around a single
 * `skills/` folder, so a prompt belonging to a sub module had nowhere to go but
 * next to `tony.md` (spec 0012 phase six, AC-12). Keying the subdirectory off
 * the name widens both at once and keeps one cache and one error path, rather
 * than growing a second loader that would drift from this one.
 *
 * A prompt is filed with the code that sends it. `rerank.md` is retrieval's,
 * not the persona's, and putting it in `skills/` would imply the persona reads
 * it.
 */
const SKILL_SUBDIR = {
  interviewer: 'skills',
  tony: 'skills',
  'credential-check': 'skills',
  rerank: join('retrieval', 'skills'),
} as const;

const cache = new Map<string, string>();

export type ConversationSkillName = keyof typeof SKILL_SUBDIR;

export function loadConversationSkill(name: ConversationSkillName): string {
  const cached = cache.get(name);
  // Checked against undefined rather than truthiness: an empty prompt file
  // would otherwise miss the cache and be re-read on every call.
  if (cached !== undefined) return cached;

  const dirs = MODULE_ROOT_CANDIDATES.map((root) => join(root, SKILL_SUBDIR[name]));
  for (const dir of dirs) {
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
    `Conversation skill file ${name}.md not found in: ${dirs.join(', ')}`,
  );
}
