import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CommitRef } from '@/lib/evals';
import { Markdown } from './Markdown';

/**
 * The writeups are trusted repo files, but they quote text a model wrote and
 * they link the way files link, not the way pages link. These tests pin the
 * three rules that make rendering them safe and correct on a public page.
 */

const commit: CommitRef = { sha: 'abc1234', pinned: true };
const blob = 'https://github.com/tbachou/tony-chou-portfolio/blob/abc1234';

const SOURCE = [
  '# A writeup title',
  '',
  'Some prose.',
  '',
  '### A sub heading',
  '',
  '| Dimension | Mean |',
  '|---|---|',
  '| honesty | 1.000 |',
  '',
  'A [child spec](../../specs/_root/0012-grounded-portfolio-agent/index.md) and a',
  '[results file](results/2026-08-30-bf4c88e.json) and an [external link](https://example.com/x).',
  '',
  '![a chart](assets/chart.png)',
  '',
  '<script>window.__pwned = true;</script>'
].join('\n');

describe('Markdown', () => {
  it('shifts every heading down one level so the page keeps one h1 (AC-6)', () => {
    const { container } = render(<Markdown source={SOURCE} commit={commit} />);

    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('A writeup title');
    // The source h3 lands on h4, not on h3.
    expect(container.querySelector('h4')?.textContent).toBe('A sub heading');
    expect(container.querySelector('h3')).toBeNull();
  });

  it('renders a GFM table inside its own scroll container (AC-6, AC-14)', () => {
    const { container } = render(<Markdown source={SOURCE} commit={commit} />);

    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.parentElement?.className).toContain('overflow-x-auto');
    expect(container.querySelector('th')?.textContent).toBe('Dimension');
  });

  it('rewrites relative links and images to pinned blob URLs, and leaves external ones alone (AC-7)', () => {
    const { container } = render(<Markdown source={SOURCE} commit={commit} />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    // Resolved against docs/evals/interview/, so `../../specs/...` climbs to
    // docs/specs/... exactly as it does on disk.
    expect(hrefs).toContain(`${blob}/docs/specs/_root/0012-grounded-portfolio-agent/index.md`);
    expect(hrefs).toContain(
      `${blob}/docs/evals/interview/results/2026-08-30-bf4c88e.json`
    );
    expect(hrefs).toContain('https://example.com/x');

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      `${blob}/docs/evals/interview/assets/chart.png`
    );
  });

  it('escapes raw HTML rather than executing it (AC-6)', () => {
    const { container } = render(<Markdown source={SOURCE} commit={commit} />);

    // `rehype-raw` is deliberately absent, so the tag arrives as text: no
    // element is created and nothing runs.
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).toContain('&lt;script&gt;');
    expect(container.textContent).toContain('<script>window.__pwned = true;</script>');
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('points at main, unpinned, when the build could not resolve a commit (AC-7)', () => {
    const { container } = render(
      <Markdown source="[a spec](../../specs/x.md)" commit={{ sha: 'main', pinned: false }} />
    );

    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/tbachou/tony-chou-portfolio/blob/main/docs/specs/x.md'
    );
  });
});
