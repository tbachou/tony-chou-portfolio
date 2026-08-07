---
name: portfolio-design-systems
source: derived (public site) + derived (internal admin)
character: "Two deliberately distinct systems in one app: a dark 3D interview showcase for the public site (blue/orange dual accent, extracted from the already-shipped InterviewRoom.tsx), and a retro CRT terminal for the internal admin surface. They share only the near-black canvas darkness; everything else diverges on purpose."
tokens: "public site: apps/web/src/app/globals.css and the base tailwind.config.ts colors (background/foreground). internal admin: apps/web/src/app/internal/terminal.css and the tailwind.config.ts term.* colors. Never duplicated here."
contrast: "see each system's own section below"
---

## Build mandate

You are a senior product designer. Every page ships as a complete, professional product surface: real copy, a considered layout with hierarchy, all states (empty, loading, error), supporting content. Maximalist, never a lone form or lone widget floating on an empty page. Full disqualifier list: the UI guide's bar.

---

# System 1: Public site (3D interview showcase)

## Scope

Everything a visitor reaches without signing in: the page shell (`page.tsx`), the 3D interview room (`InterviewRoom.tsx`), and the 2D conversation UI (`TopicPicker.tsx`, `ConversationPanel.tsx`). This is the actual product the whole app is built to demonstrate.

## Character & direction

Content-forward, 3D as supporting accent — not a full-bleed 3D hero. A real editorial page carries the content: header, headline, and copy in normal document flow, then a two-column section where the 2D conversation panel is the primary focus and the 3D room sits alongside it, contained in a bordered, glow-framed card rather than filling the viewport. This direction was chosen deliberately after the original full-bleed-3D-plus-floating-overlay layout read as visually weak — the room is a nice accent, not a strong enough visual to carry the whole page on its own.

The two figures remain color-coded by role — blue `#5b7fff` for the interviewer, orange `#ff9d5b` for Tony (AI) — and that pairing is load-bearing in the 3D scene (each figure's material color) before any 2D UI existed. The 2D transcript reuses the same two colors for the same purpose (avatar badge + label color per speaker), so the conversation panel reads as continuous with the room, not a bolted-on interface.

## Contrast (verified before writing CSS)

- Ink `#f5f5f7` on canvas `#0a0a0f`: ~19:1
- Interviewer accent `#5b7fff` on canvas: 5.57:1
- Tony accent `#ff9d5b` on canvas: 9.62:1
- Muted `#9a9aa8` on canvas: 7.12:1

## Composition patterns

- **Page shell**: header (name + title) in normal flow, then a hero section (eyebrow label, headline, dek copy) constrained to a readable measure (`max-w-3xl`), then a two-column section (`md:grid-cols-[1fr_1.5fr]`) with the 3D room on the left and the conversation panel on the right — panel gets the wider column since it's the primary focus.
- **3D room card**: `aspect-[4/3]`, rounded corners, hairline border, contained with a soft accent-colored glow shadow (not full-bleed, not edge-to-edge), sticky-positioned on scroll on desktop so it stays in view alongside a longer transcript. A one-line caption underneath explains it's interactive ("drag to look around").
- **Idle / topic picker state**: the conversation panel shows numbered topic cards (topic label + description per card, from `GET /topics`) in its own bordered card, with a hover-revealed "start this interview" affordance per card.
- **Active conversation state**: topic cards replaced by a scrollable transcript (avatar-badge speaker rows, role-colored label + streamed text), inside the same bordered card, with a header (topic name, "change topic" control) and footer action area, plus a **click to advance** control once a turn pair completes (the visitor drives pacing, per PROJECT_BRIEF's "watch/steer" framing — it does not auto-play continuously).
- **Wrap up state**: once `isFinal: true`, the footer action area shows a close-out message and "pick another topic" control, not left as a dead end.
- **Streaming feedback**: a visible role-colored blinking caret at the end of the in-progress line while `token` events are arriving, distinct from the idle "click to advance" state, so the visitor never wonders if it's frozen.

## Component & usage rules

- Interviewer copy/UI always uses the blue accent; Tony copy/UI always uses the orange accent. Never swap or mix. Each transcript line pairs a small colored avatar circle (initial: "IV" / "T") with a same-colored role label.
- The conversation panel is a solid card (`bg-white/[0.03]`, hairline `border-white/10`), not a translucent HUD over the 3D view — the two live in separate columns, so there's no glass-over-3D effect to maintain.
- Buttons/controls sized for touch (44×44px minimum), since this is the primary visitor-facing interaction.

## Responsive & accessibility direction

- Below `md` (768px), the grid collapses to a single column; the conversation panel comes first in source order (it's the primary content) with the 3D card below it, so mobile visitors reach the interview immediately without scrolling past the room.
- `OrbitControls` (3D camera drag) is scoped to its own contained card, so it never competes with page-level touch scrolling the way a full-viewport 3D background would.
- Streamed text updates announce via `aria-live="polite"` on the transcript region so screen reader users get the conversation without a flood of per-token announcements (batch by turn, not by token).

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
