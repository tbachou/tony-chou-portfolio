/**
 * The one skip link, shared by every page that has a `#main-content`
 * landmark. Those ids already existed with nothing pointing at them;
 * landmarks and headings already satisfy 2.4.1, so this is a convenience
 * rather than a fix: invisible until focused, and first in the tab order.
 *
 * Render it as the FIRST element inside the page, before any header, and
 * give the target `tabIndex={-1}` — without that the browser scrolls to
 * the landmark but leaves focus on the link, so the next Tab goes back to
 * the top of the page and the link does nothing useful for a keyboard.
 *
 * Appearance is NOT hardcoded to a theme. This app has two identities that
 * share no palette (the terminal theme and Beta), so the styling lives in
 * `globals.css` behind `--skip-link-*`, which beta.css remaps under
 * `.beta-theme`. `label` exists for the same reason: bracketed text is
 * terminal chrome, not something Beta's daylight identity should inherit.
 */
export function SkipLink({ label = 'Skip to main content' }: { label?: string }) {
  return (
    <a href="#main-content" className="skip-link">
      {label}
    </a>
  );
}
