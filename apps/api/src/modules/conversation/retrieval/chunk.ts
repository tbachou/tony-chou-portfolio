/**
 * Splits a committed markdown document into the units that get embedded
 * (spec 0012 phase three, AC-2).
 *
 * Heading boundaries rather than fixed token windows, because these documents
 * are heavily structured (Summary, Requirements, Decision, Consequences) and
 * those headings are already the semantic units. A retrieved chunk then
 * arrives as a coherent section with its heading, which is also what makes
 * attribution readable: the persona can say which document and which part.
 */

/** The character cap from AC-2. */
export const CHUNK_CHARACTER_CAP = 2000;

export type Chunk = {
  /** Stable within a document: the source path plus an ordinal. */
  id: string;
  text: string;
  /** The heading this chunk sits under, or the document title for a preamble. */
  heading: string;
  /** The chain of parent headings, joined, so a chunk carries its context. */
  headingPath: string;
  sourcePath: string;
};

type Section = { heading: string; headingPath: string; lines: string[] };

/** `## Requirements` → { level: 2, text: 'Requirements' }, else null. */
function parseHeading(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
  if (!match) return null;
  return { level: match[1].length, text: match[2] };
}

/**
 * Splits an oversized section at paragraph boundaries.
 *
 * A single paragraph longer than the cap is emitted whole rather than cut
 * mid sentence. That is deliberate: a chunk cut through the middle of a
 * sentence embeds badly and reads worse when quoted back, and an oversized
 * paragraph is a signal to fix the source document rather than something to
 * paper over here. The embed script reports these.
 */
function splitToCap(text: string, cap: number): string[] {
  if (text.length <= cap) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= cap) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    current = paragraph; // may itself exceed the cap; emitted whole on purpose
  }
  if (current) out.push(current);
  return out;
}

/**
 * Chunks one document. Text before the first heading becomes its own chunk
 * headed by the document title, so a spec's opening summary is retrievable.
 */
export function chunkMarkdown(text: string, sourcePath: string): Chunk[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  // Index 0 is unused; 1 to 6 hold the current heading text at each level.
  const openHeadings: string[] = [];
  const fileTitle = sourcePath.split('/').pop() ?? sourcePath;
  let current: Section = { heading: fileTitle, headingPath: fileTitle, lines: [] };
  let inFence = false;

  for (const line of lines) {
    // A `#` inside a fenced code block is not a heading.
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : parseHeading(line);
    if (!heading) {
      current.lines.push(line);
      continue;
    }
    if (current.lines.some((l) => l.trim().length > 0)) sections.push(current);
    openHeadings.length = heading.level - 1;
    openHeadings[heading.level - 1] = heading.text;
    const headingPath = openHeadings.filter(Boolean).join(' > ');
    current = { heading: heading.text, headingPath, lines: [] };
  }
  if (current.lines.some((l) => l.trim().length > 0)) sections.push(current);

  const chunks: Chunk[] = [];
  let ordinal = 0;
  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body) continue;
    // The heading rides along in the embedded text: a section body often does
    // not repeat its own subject, and a query about "the build plan" should
    // match the section headed that way.
    const withHeading = `${section.headingPath}\n\n${body}`;
    for (const piece of splitToCap(withHeading, CHUNK_CHARACTER_CAP)) {
      chunks.push({
        id: `${sourcePath}#${ordinal}`,
        text: piece,
        heading: section.heading,
        headingPath: section.headingPath,
        sourcePath,
      });
      ordinal += 1;
    }
  }
  return chunks;
}

/** Chunks that exceeded the cap as a single paragraph, so the script can report them. */
export function oversizedChunks(chunks: Chunk[]): Chunk[] {
  return chunks.filter((c) => c.text.length > CHUNK_CHARACTER_CAP);
}
