import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRerankPrompt, resetRerankPromptCache } from './rerank-prompt.js';
import { loadConversationSkill } from '../skill-loader.js';

/**
 * The reranker's prompt lives on disk, not in TypeScript (spec 0012 phase
 * six, AC-12).
 */

describe('loadRerankPrompt', () => {
  beforeEach(() => {
    resetRerankPromptCache();
  });

  it('loads all three sections from disk, none of them empty', () => {
    const prompt = loadRerankPrompt();
    expect(prompt.task.length).toBeGreaterThan(0);
    expect(prompt.relevant.length).toBeGreaterThan(0);
    expect(prompt.notRelevant.length).toBeGreaterThan(0);
  });

  it('drops the editor note above the first heading, which is not prompt content', () => {
    const prompt = loadRerankPrompt();
    expect(prompt.task).not.toContain('rerank-prompt.ts');
    expect(prompt.task).not.toMatch(/^#\s/m);
  });

  it('judges against the interviewer question as well as the search query', () => {
    // The lesson carried in from the 2026-09-21 gate: a search query is the
    // persona's paraphrase, so judging relevance against it alone optimises
    // for the paraphrase rather than for what was asked.
    const prompt = loadRerankPrompt();
    expect(prompt.task).toContain('interviewerQuestion');
    expect(prompt.task).toContain('searchQuery');
  });

  it('is reachable through the generalised skill loader (AC-12)', () => {
    // The loader's directory list and name union were both closed before this
    // phase, so a retrieval prompt had nowhere to go but next to tony.md.
    expect(loadConversationSkill('rerank')).toContain('## Task');
  });

  it('still loads the prompts that were there before it was generalised', () => {
    expect(loadConversationSkill('tony').length).toBeGreaterThan(0);
    expect(loadConversationSkill('interviewer').length).toBeGreaterThan(0);
    expect(loadConversationSkill('credential-check').length).toBeGreaterThan(0);
  });

  it('keeps no prompt text in the TypeScript that sends it (AC-12)', () => {
    const prompt = loadRerankPrompt();
    const here = import.meta.dirname;
    const sources = ['reranker.ts', 'rerank-prompt.ts'].map((name) =>
      readFileSync(join(here, name), 'utf8'),
    );
    // A distinctive sentence from each section: if any of these ever appears
    // in a .ts file, the prompt has been copied back into code.
    for (const section of [prompt.task, prompt.relevant, prompt.notRelevant]) {
      const sentence = section.split('\n').find((line) => line.trim().length > 40)!;
      for (const source of sources) {
        expect(source).not.toContain(sentence.trim());
      }
    }
  });
});
