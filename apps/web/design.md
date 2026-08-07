---
name: portfolio-design-systems
source: derived (public site) + derived (internal admin)
character: "Two deliberately distinct systems in one app: a dark editorial single-page portfolio for the public site (blue/orange dual accent carried over from the AI-interview feature), and a retro CRT terminal for the internal admin surface. They share only the near-black canvas darkness; everything else diverges on purpose."
tokens: "public site: apps/web/src/app/globals.css and the base tailwind.config.ts colors (background/foreground). internal admin: apps/web/src/app/internal/terminal.css and the tailwind.config.ts term.* colors. Never duplicated here."
contrast: "see each system's own section below"
---

## Build mandate

You are a senior product designer. Every page ships as a complete, professional product surface: real copy, a considered layout with hierarchy, all states (empty, loading, error), supporting content. Maximalist, never a lone form or lone widget floating on an empty page. Full disqualifier list: the UI guide's bar.

---

# System 1: Public site (editorial single-page portfolio)

## Scope

Everything a visitor reaches without signing in: the page shell (`page.tsx`), the sticky section nav (`SiteNav.tsx`), and each section — About, the AI interview (`TopicPicker.tsx`, `ConversationPanel.tsx`), Resume, and Contact. This is the actual product the whole app is built to demonstrate, now framed as one portfolio rather than a single-feature demo.

## Character & direction

Content-forward editorial, no 3D on the page. The original direction ran a 3D interview room (two capsule-figure placeholders) as either a full-bleed hero or a contained accent card — both read as visually weak ("looks very childish" was the actual verdict), so it was dropped entirely rather than iterated on further. `InterviewRoom.tsx` still exists in the codebase (unused) as a starting point for a lighter-weight 3D touch later, but nothing on the page currently renders it.

In its place: a single scrolling page with a sticky anchor nav (About / Interview / Resume / Contact), each section a normal-flow content block on a `max-w-6xl` (or `max-w-3xl` for prose-heavy sections) measure. The blue/orange dual accent — blue `#5b7fff` for the interviewer, orange `#ff9d5b` for Tony (AI) — persists as the one deliberate two-color exception, but its scope is now just the interview section's transcript (avatar badge + label color per speaker); nowhere else on the page uses it as a UI color, only as the eyebrow-label accent color repeated per section for continuity.

## Contrast (verified before writing CSS)

- Ink `#f5f5f7` on canvas `#0a0a0f`: ~19:1
- Interviewer accent `#5b7fff` on canvas: 5.57:1
- Tony accent `#ff9d5b` on canvas: 9.62:1
- Muted `#9a9aa8` on canvas: 7.12:1

## Composition patterns

- **Nav**: sticky top bar, `bg-background/80 backdrop-blur`, name on the left, section anchor links on the right; `html { scroll-behavior: smooth }` (disabled under `prefers-reduced-motion`) drives the jump, each section carries `scroll-mt-20` so the sticky nav doesn't cover the heading it scrolled to.
- **Hero**: eyebrow label, headline, one paragraph of dek copy, `max-w-3xl`, normal document flow — no full-bleed visual behind it.
- **About**: two-column on desktop — summary paragraph on the left, a `dl` of skill-group pill lists on the right; collapses to one column on mobile.
- **Interview**: unchanged internally from the previous iteration — topic picker card → transcript card with avatar-badge speaker rows and a **click to advance** control once a turn pair completes (visitor drives pacing, doesn't auto-play) → wrap-up state once `isFinal: true`. Now lives as one section among several instead of the whole page.
- **Resume**: a bordered left-rail timeline of experience entries (org, role, dates, tech-stack pills, bullets) plus a "Download PDF" button that links straight to the static PDF asset; an education entry below the timeline.
- **Contact**: email (`mailto:`), LinkedIn, and location as three simple label/value pairs — no phone number published on the public site by default.

## Component & usage rules

- Interviewer copy/UI always uses the blue accent; Tony copy/UI always uses the orange accent, scoped to the interview section only. Never swap or mix.
- Section eyebrow labels (`ABOUT`, `INTERVIEW`, `RESUME`, `CONTACT`) always use the interviewer blue as a page-wide continuity thread, independent of the interview-specific role coloring.
- Skill/tech pills: `rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs`, reused identically in About's skill groups and Resume's per-role stack tags.
- Buttons/controls sized for touch (44×44px minimum).

## Responsive & accessibility direction

- Nav links wrap on narrow viewports rather than collapsing into a hamburger menu — there are only four of them, so wrapping stays legible and avoids extra interactive state.
- About's skill `dl` and Resume's tech-stack pills wrap freely; no fixed-width assumptions.
- Streamed text updates in the interview section announce via `aria-live="polite"` so screen reader users get the conversation without a flood of per-token announcements (batch by turn, not by token).

---

# System 2: Internal admin (retro terminal)

## Scope

`apps/web`'s internal/admin surface only (currently `/internal/usage`, and any future `/internal/*` route). Untouched by System 1 and vice versa — this is a deliberate divergence (a text-first ops tool looking distinctly different from a 3D showcase), not an inconsistency to fix.

## Character & direction

A single admin, chosen deliberately: an old phosphor CRT terminal, the kind you'd SSH into a server from in 1985. One glowing green (`#39ff14`) does almost all the work — headings, body text, borders, accents, success states — because a real terminal doesn't have a palette, it has a phosphor color and the black behind it. Monospace type end to end (IBM Plex Mono). Corners are sharp (0 to 4px), motion is fast and a little harsh (80 to 200ms, no springs), and the page leans into the bit: a scanline texture over the canvas, a blinking cursor accent, text that reads like log output.

No light mode. A CRT terminal has one mode. Fixed dark theme regardless of system `prefers-color-scheme`.

## Contrast (verified before writing CSS)

ink `#39ff14` on canvas `#0a0a0f`: 14.57:1 · body `#5fcc5f` on canvas: 9.68:1 · muted `#608c60` on canvas: 5.10:1 · on-accent `#0a0a0f` on accent `#39ff14`: 14.57:1 · border `#458045` on surface `#10160f`: 3.87:1 · error `#ff3b3b` on canvas: 5.59:1

## Composition patterns

- **Shell**: a single full-height "terminal window" frame (thin green border, a faux title bar reading something like `tonychou@internal:~/usage$`), centered with generous margin on wide viewports.
- **Login state**: a two-field form (email, password) styled as a command prompt, not a conventional rounded input card.
- **Signed-in state**: a status readout (14-day and latest-day turn/token totals), then a `daily totals` table (last 14 days) and a `top sources` table (top 10 hashed IPs by token count).
- **Footer**: a one-line status note, a sign-out command-styled control.

## Component & usage rules

- Accent (`#39ff14`) marks emphasis and interactive elements only; do not paint large surfaces with it.
- Borders are hairline (1px), never a shadow for elevation.
- Buttons are text-first, bracket-styled (`[ SIGN IN ]`).
- Tables use monospace alignment (numbers right-aligned).
- A blinking-cursor motif is reserved for exactly one focal point per screen.

## Responsive & accessibility direction

- Scanline/glow textures are decorative (`aria-hidden`, `pointer-events: none`), never reduce actual text contrast.
- Respect `prefers-reduced-motion`: disable the cursor blink and any flicker/scan animation.
- Below 480px width, the terminal window frame collapses to fill the viewport edge to edge.
- Monospace body copy at 16px minimum; do not shrink below 13px for anything that carries information.
