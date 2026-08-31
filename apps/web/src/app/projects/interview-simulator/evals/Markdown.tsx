import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { blobUrl, evalsRepoPath, type CommitRef } from '@/lib/evals';

/**
 * Renders a committed writeup, or a baseline history detail, as part of the
 * page rather than as a foreign block.
 *
 * Three rules, all of them load bearing (spec 0012 phase two, AC-6, AC-7):
 *
 * 1. No raw HTML. `rehype-raw` is deliberately absent, so a `<script>` in a
 *    markdown file is inert. These files are repo authored, but they quote
 *    text a model wrote, and the trust boundary should not depend on nobody
 *    ever pasting a tag.
 * 2. Every heading shifts down one level. The page owns its `h1`; a writeup
 *    that opens with one would give the document two and wreck the outline
 *    for anyone reading it through a screen reader's heading list.
 * 3. Relative links and images are rewritten to pinned blob URLs. A writeup
 *    links to `../../specs/...` because it lives on disk next to those
 *    files; on the page that target does not exist, so it is resolved
 *    against the evals directory and pointed at the repo at the build
 *    commit. A link that silently 404s is worse than no link.
 */

function isExternal(target: string): boolean {
  // A scheme (https:, mailto:, data:), a protocol relative URL, or an
  // in page anchor: all of these already mean what they say.
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#');
}

function rewrite(target: string | undefined, commit: CommitRef): string | undefined {
  if (!target) return target;
  if (isExternal(target)) return target;
  // A leading slash in these files means the repo root, not the site root:
  // nothing in a writeup links to a page of this site.
  return blobUrl(target.startsWith('/') ? target : evalsRepoPath(target), commit);
}

function markdownComponents(commit: CommitRef): Components {
  const heading = 'font-bold text-term-ink';
  return {
    // Rule 2: h1 becomes h2, through h5 becomes h6. An h6 stays an h6,
    // since there is no h7 to shift into.
    h1: ({ children }) => <h2 className={`mt-8 text-term-lg ${heading}`}>{children}</h2>,
    h2: ({ children }) => <h3 className={`mt-8 text-term-base ${heading}`}>{children}</h3>,
    h3: ({ children }) => <h4 className={`mt-6 text-term-base ${heading}`}>{children}</h4>,
    h4: ({ children }) => <h5 className={`mt-6 text-term-sm ${heading}`}>{children}</h5>,
    h5: ({ children }) => <h6 className={`mt-6 text-term-sm ${heading}`}>{children}</h6>,
    h6: ({ children }) => <h6 className={`mt-6 text-term-sm ${heading}`}>{children}</h6>,

    p: ({ children }) => (
      <p className="mt-3 text-term-sm leading-relaxed text-term-body">{children}</p>
    ),
    strong: ({ children }) => <strong className="font-bold text-term-ink">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => (
      <ul className="mt-3 list-disc space-y-2 pl-5 text-term-sm leading-relaxed text-term-body">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-term-sm leading-relaxed text-term-body">
        {children}
      </ol>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mt-4 border-l border-term-border pl-4 text-term-sm text-term-muted">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="mt-6 border-term-border" />,
    code: ({ children }) => (
      <code className="break-words bg-[color:var(--card-bg)] px-1 text-term-xs text-term-accent">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="mt-4 overflow-x-auto border border-term-border p-3 text-term-xs text-term-body">
        {children}
      </pre>
    ),

    // Rule 3, for both anchors and images.
    a: ({ href, children }) => (
      <a
        href={rewrite(href, commit)}
        className="text-term-accent underline underline-offset-2 hover:no-underline"
      >
        {children}
      </a>
    ),
    // The source is a GitHub blob URL resolved at build from markdown, so
    // there is no static import for next/image to optimise and no known
    // dimensions to hand it. The disable comment stays.
    img: ({ src, alt }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={rewrite(typeof src === 'string' ? src : undefined, commit)}
        alt={alt ?? ''}
        className="mt-4 max-w-full border border-term-border"
      />
    ),

    // A GFM table from a writeup gets the same scroll container the page's
    // own tables get, so a wide table never makes the body scroll sideways.
    table: ({ children }) => (
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left text-term-xs">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="text-term-muted">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-term-border px-2 py-2 font-bold">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-b border-term-border px-2 py-2 align-top text-term-body">{children}</td>
    )
  };
}

export function Markdown({ source, commit }: { source: string; commit: CommitRef }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents(commit)}>
      {source}
    </ReactMarkdown>
  );
}
