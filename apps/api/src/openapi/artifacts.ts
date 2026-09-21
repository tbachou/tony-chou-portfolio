/**
 * The two committed artifacts: where they live and exactly how they serialize
 * (spec 0016).
 *
 * Both the builder and the check go through this file, so the bytes the check
 * compares are produced by the same code that wrote them. A formatting choice
 * that lived in only one of the two scripts would make every check fail.
 */
import { buildDocument } from './document.js';
import { renderMarkdown } from './markdown.js';

export const ARTIFACT_DIR = 'docs/api';
export const JSON_ARTIFACT = `${ARTIFACT_DIR}/openapi.json`;
export const MARKDOWN_ARTIFACT = `${ARTIFACT_DIR}/README.md`;

/**
 * Builds both artifacts from the one document object.
 *
 * Nothing here reads a clock, an environment variable or the file system, so
 * two runs against an unchanged tree produce identical bytes (AC-12).
 */
export function renderArtifacts(): { path: string; contents: string }[] {
  const document = buildDocument();
  return [
    { path: JSON_ARTIFACT, contents: `${JSON.stringify(document, null, 2)}\n` },
    { path: MARKDOWN_ARTIFACT, contents: renderMarkdown(document) },
  ];
}
