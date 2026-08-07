---
name: retro-terminal-admin-design-system
source: derived
character: "A CRT terminal / phosphor monitor aesthetic for the internal admin surface: near-black canvas, a single glowing green accent used for nearly all text and emphasis, monospace type throughout, sharp corners, fast harsh motion. Deliberately not the public site's look."
tokens: "real values live in apps/web/src/app/globals.css and apps/web/tailwind.config.ts; read them there, never duplicated here"
contrast: "ink #39ff14 on canvas #0a0a0f: 14.57:1 · body #5fcc5f on canvas: 9.68:1 · muted #608c60 on canvas: 5.10:1 · on-accent #0a0a0f on accent #39ff14: 14.57:1 · border #458045 on surface #10160f: 3.87:1 · error #ff3b3b on canvas: 5.59:1"
---

## Build mandate

You are a senior product designer. Every page under this system ships as a complete, professional product surface: real copy, a considered layout with hierarchy, all states (empty, loading, error), supporting content. Maximalist, never a lone form floating on an empty page. Full disqualifier list: the UI guide's bar.

## Scope

This system governs **`apps/web`'s internal/admin surface only** (currently just `/internal/usage`, and any future `/internal/*` route). It does NOT govern the public-facing site (the 3D interview room and anything reachable by a visitor without signing in), which already has its own shipped visual language (near-black `#0a0a0f` canvas, blue `#5b7fff` / orange `#ff9d5b` dual accent representing the interviewer and Tony personas) — that system is untouched by this one. The two share the same canvas darkness deliberately (continuity of "the same app"), and diverge from there on purpose: the public site is a 3D showcase, the internal surface is a text-first ops tool, and looking distinctly different from each other is correct, not an inconsistency to fix.

## Character & direction

A single admin, chosen deliberately: an old phosphor CRT terminal, the kind you'd SSH into a server from in 1985. One glowing green (`#39ff14`) does almost all the work — headings, body text, borders, accents, success states — because a real terminal doesn't have a palette, it has a phosphor color and the black behind it. Monospace type end to end (IBM Plex Mono). Corners are sharp (0 to 4px), motion is fast and a little harsh (80 to 200ms, no springs), and the page leans into the bit: a scanline texture over the canvas, a blinking cursor accent, text that reads like log output. This is not a joke skin bolted onto a normal dashboard; the terminal framing IS the information architecture (numbers read like a system status readout, not a SaaS analytics card).

No light mode. A CRT terminal has one mode. Fixed dark theme regardless of system `prefers-color-scheme`.

## Composition patterns

- **Shell**: a single full-height "terminal window" frame (thin green border, a faux title bar reading something like `tonychou@internal:~/usage$`), centered with generous margin on wide viewports so it reads as a window on a desk, not a stretched-full browser page.
- **Login state**: the terminal boots into a sign-in prompt — a two-field form (email, password) styled as a command prompt, not a conventional rounded input card.
- **Signed-in state**: a status readout at the top (today's turn/token counts against the daily caps, if available), then two sections: a `daily totals` table (last 14 days) and a `top sources` table (top 10 hashed IPs by token count), each framed like a fixed-width terminal table with `ASCII`-style borders (`│`, `─`, `┌┐└┘` or simple CSS borders standing in for them).
- **Footer**: a one-line status bar (session state, a sign-out command-styled control).

## Component & usage rules

- Accent (`#39ff14`) marks emphasis and interactive elements only (links, the active nav state, table headers, the cursor); do not paint large surfaces with it, or the glow becomes noise instead of signal.
- Borders are hairline (1px) `--color-border`, never a shadow for elevation; this system has no drop shadows, elevation is expressed by border + slightly lighter surface fill only.
- Buttons are text-first, bracket-styled (`[ SIGN IN ]`) rather than filled pill/rounded buttons, consistent with the terminal command feel.
- Tables use monospace alignment (numbers right-aligned, consistent column widths) since misaligned columns break the terminal illusion immediately.
- A blinking-cursor motif (`--duration-instant` step interval) is reserved for exactly one focal point per screen (the prompt cursor on login, or a "live" indicator once signed in); more than one blinking element reads as broken, not retro.

## Responsive & accessibility direction

- Scanline/glow textures are decorative (`aria-hidden`, `pointer-events: none`) and must never reduce actual text contrast below the verified ratios above; the glow is a `text-shadow`/`box-shadow` layered on top of already-passing solid colors, not a substitute for contrast.
- Respect `prefers-reduced-motion`: disable the cursor blink and any flicker/scan animation, keep the layout and content identical.
- Below 480px width, the terminal window frame collapses to fill the viewport edge to edge (no faux window margin) so the chrome doesn't eat content space on mobile.
- Monospace body copy at 16px minimum; do not shrink below `--text-sm` (13px) for anything that carries information (table data, form labels).
