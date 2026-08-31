import { CHUNK_CHARACTER_CAP, chunkMarkdown, oversizedChunks } from './chunk';

const doc = (body: string) => chunkMarkdown(body, 'docs/specs/_root/0012-agent/index.md');

describe('chunkMarkdown', () => {
  it('splits at heading boundaries, one chunk per section', () => {
    const chunks = doc('# Title\n\nintro text\n\n## Requirements\n\nthe rules\n\n## Decision\n\nchosen');
    expect(chunks.map((c) => c.heading)).toEqual(['Title', 'Requirements', 'Decision']);
    expect(chunks[1].text).toContain('the rules');
    expect(chunks[1].text).not.toContain('chosen');
  });

  it('carries the parent heading chain, so a chunk keeps its context', () => {
    const chunks = doc('# Spec\n\nx\n\n## Feature design\n\ny\n\n### Security model\n\nz');
    const security = chunks.find((c) => c.heading === 'Security model');
    expect(security?.headingPath).toBe('Spec > Feature design > Security model');
  });

  it('drops a stale deeper heading when a shallower one follows', () => {
    const chunks = doc('# S\n\na\n\n## One\n\nb\n\n### Deep\n\nc\n\n## Two\n\nd');
    expect(chunks.find((c) => c.heading === 'Two')?.headingPath).toBe('S > Two');
  });

  it('keeps text before the first heading, headed by the document name', () => {
    const chunks = chunkMarkdown('preamble before any heading\n', 'docs/specs/_root/0003-frontend.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe('0003-frontend.md');
    expect(chunks[0].text).toContain('preamble');
  });

  it('does not treat a # inside a fenced code block as a heading', () => {
    // Shell comments in these documents are common, and a false heading would
    // split a section in the middle of an example.
    const chunks = doc('# S\n\nintro\n\n## Commands\n\n```bash\n# not a heading\nnpm run build\n```\n\nafter');
    expect(chunks.map((c) => c.heading)).toEqual(['S', 'Commands']);
    expect(chunks[1].text).toContain('npm run build');
    expect(chunks[1].text).toContain('after');
  });

  it('drops a heading with no body of its own', () => {
    // A spec title immediately followed by its first section is the common
    // shape here, and an empty chunk is worth nothing to retrieve.
    const chunks = doc('# S\n\n## Requirements\n\nthe rules');
    expect(chunks.map((c) => c.heading)).toEqual(['Requirements']);
  });

  it('embeds the heading path with the body, so a query about a section matches it', () => {
    const chunks = doc('# S\n\nx\n\n## Build plan\n\nordered tasks');
    const plan = chunks.find((c) => c.heading === 'Build plan');
    expect(plan?.text.startsWith('S > Build plan')).toBe(true);
  });

  it('splits an oversized section at paragraph boundaries, never mid sentence', () => {
    const para = `${'word '.repeat(150).trim()}.`; // ~750 chars
    const chunks = doc(`# S\n\n## Long\n\n${[para, para, para, para].join('\n\n')}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_CHARACTER_CAP);
    // No chunk ends mid sentence: each piece ends at a paragraph break.
    for (const c of chunks) expect(c.text.trimEnd().endsWith('.')).toBe(true);
  });

  it('emits a single oversized paragraph whole rather than cutting it', () => {
    const huge = 'x'.repeat(CHUNK_CHARACTER_CAP + 500);
    const chunks = doc(`# S\n\n## Huge\n\n${huge}`);
    const over = oversizedChunks(chunks);
    expect(over).toHaveLength(1);
    expect(over[0].text).toContain(huge);
  });

  it('gives every chunk a stable id and its source path', () => {
    const chunks = doc('# S\n\na\n\n## Two\n\nb');
    expect(chunks.map((c) => c.id)).toEqual([
      'docs/specs/_root/0012-agent/index.md#0',
      'docs/specs/_root/0012-agent/index.md#1',
    ]);
    for (const c of chunks) expect(c.sourcePath).toBe('docs/specs/_root/0012-agent/index.md');
  });

  it('produces nothing for an empty or whitespace only document', () => {
    expect(doc('')).toEqual([]);
    expect(doc('\n\n   \n')).toEqual([]);
  });
});
