import { loadConversationSkill } from '../skill-loader.js';

/**
 * Reads the reranker's prompt off disk (spec 0012 phase six, AC-12).
 *
 * The prompt is one markdown file because no prompt text may live in
 * TypeScript, but the System One request wants it in three pieces: the
 * judgement itself, and a description of each of the two answers. This splits
 * the file on its `##` headings rather than storing three files, so the whole
 * prompt stays readable as one document.
 */

export type RerankPrompt = {
  /** The judgement, sent as each question's instructions. */
  task: string;
  /** What a yes answer means. */
  relevant: string;
  /** What a no answer means. */
  notRelevant: string;
};

const TASK_HEADING = 'Task';
const RELEVANT_HEADING = 'Relevant';
const NOT_RELEVANT_HEADING = 'Not relevant';

/**
 * Splits markdown into its `##` sections, keyed by heading text.
 *
 * Anything before the first `##` is dropped, which is deliberate: the file
 * opens with a note to whoever edits it, and that note is not prompt content.
 * `###` does not match, so a deeper heading stays part of its section body.
 */
function parseSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | null = null;
  let body: string[] = [];

  for (const line of markdown.split('\n')) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (heading !== null) sections.set(heading, body.join('\n').trim());
      heading = match[1];
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  if (heading !== null) sections.set(heading, body.join('\n').trim());

  return sections;
}

let cached: RerankPrompt | null = null;

/**
 * A missing or malformed prompt file throws, exactly as `loadConversationSkill`
 * already does for a missing file. That is a deploy time mistake rather than a
 * runtime condition, and the caller wraps this in the same fail open path as
 * every other reranker failure (AC-6), so a broken file costs the cosine
 * selection rather than the turn.
 */
export function loadRerankPrompt(): RerankPrompt {
  if (cached) return cached;

  const sections = parseSections(loadConversationSkill('rerank'));
  const required = [TASK_HEADING, RELEVANT_HEADING, NOT_RELEVANT_HEADING];
  const missing = required.filter((name) => !sections.get(name));
  if (missing.length > 0) {
    throw new Error(
      `rerank.md is missing required section(s): ${missing.join(', ')}. ` +
        `Expected headings: ${required.map((name) => `## ${name}`).join(', ')}.`,
    );
  }

  cached = {
    task: sections.get(TASK_HEADING)!,
    relevant: sections.get(RELEVANT_HEADING)!,
    notRelevant: sections.get(NOT_RELEVANT_HEADING)!,
  };
  return cached;
}

/** Test only. The prompt is cached for the process lifetime in production. */
export function resetRerankPromptCache(): void {
  cached = null;
}
