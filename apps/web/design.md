---
name: portfolio-terminal-design-system
source: derived
character: "One retro phosphor-CRT terminal identity for the whole app — public portfolio and internal admin both live inside the same terminal-window chrome, monospace type, and single glowing green. What used to be two deliberately distinct systems (an editorial blue/orange public site, a green-terminal internal admin) is now one: the public site adopted the admin's terminal language wholesale rather than the other way around, after the earlier editorial-with-3D-room direction was rejected outright ('looks very childish')."
tokens: "apps/web/src/app/terminal.css (the .terminal-theme token source, applied to <body> in the root layout so it covers the whole app) and the tailwind.config.ts term.* colors. Never duplicated here."
contrast: "ink #39ff14 on canvas #0a0a0f: 14.57:1 · body #5fcc5f on canvas: 9.68:1 · muted #608c60 on canvas: 5.10:1 · on-accent #0a0a0f on accent #39ff14: 14.57:1 · border #458045 on surface #10160f: 3.87:1 · error #ff3b3b on canvas: 5.59:1"
---

## Build mandate

You are a senior product designer. Every page ships as a complete, professional product surface: real copy, a considered layout with hierarchy, all states (empty, loading, error), supporting content. Maximalist, never a lone form or lone widget floating on an empty page. Full disqualifier list: the UI guide's bar.

## Character & direction

An old phosphor CRT terminal, the kind you'd SSH into a server from in 1985. One glowing green (`#39ff14`) does almost all the work — headings, body text, borders, accents — because a real terminal doesn't have a palette, it has a phosphor color and the black behind it. Monospace type end to end (IBM Plex Mono, loaded once in the root layout). Corners are sharp (0–4px), motion is fast and a little harsh (80–200ms, no springs), and the whole app leans into the bit: a scanline texture over the canvas, a blinking cursor accent, copy that reads like shell output (`$ whoami`, `$ cat about.txt`, `$ ls skills/`).

No light mode. A CRT terminal has one mode. Fixed dark theme regardless of system `prefers-color-scheme`.

This direction replaced two earlier attempts on the public site: a full-bleed 3D interview room (dropped — "looks very childish"), then a content-forward 2D editorial page with a blue/orange accent system (dropped in favor of unifying with the internal admin's already-working terminal identity, rather than running two systems side by side). The interviewer/Tony speaker coloring survives as the one deliberate exception to "one accent," but was itself recolored from a modern blue/orange UI palette to a dual-phosphor pairing — bright green `#39ff14` (same as the ink/accent) for the interviewer, amber `#ffb000` for Tony (AI) — the same way an old terminal used distinct ANSI/phosphor colors for different log sources without breaking the illusion. Scoped to exactly the interview transcript (avatar badge + role label), nowhere else.

Public 3D returned, but scoped tightly: a small click-to-enter scene (a low-poly desk with a CRT-styled monitor, keyboard, mouse, and a couple of plants — everything built from primitive/rounded-box geometry, no external 3D assets) plays once per first-time visitor, with drag-to-orbit before entering. Clicking the screen zooms the camera in and then **hard-swaps** to the real 2D site — the 3D canvas unmounts entirely, so the actual site is always real, accessible DOM, never a WebGL texture. A `[ zoom out ]` nav control can re-enter the 3D view any time afterward. See `SiteIntroScene.tsx` / `SiteIntroProvider.tsx`.

## Scope

The entire app: the public portfolio (`page.tsx` and its sections) and the internal admin (`/internal/usage`). Both render inside the same `.terminal-theme` root (applied to `<body>` in `apps/web/src/app/layout.tsx`), so there is exactly one design system now, not two. The internal admin differs only in content (an authenticated ops dashboard vs. a public portfolio) and in being a single centered `TerminalWindow`, where the public site chains several `TerminalWindow`s down one scrolling page.

## Composition patterns

- **`TerminalWindow`** (`src/components/TerminalWindow.tsx`): the one shared shell — thin green border, a faux title bar (three traffic-light dots, a `user@host:~/path$`-style label), sharp corners. Every content block on the public site and the entire internal admin page is one of these. Callers control their own outer spacing/max-width via `className`; the component itself is unopinionated about placement.
- **Public site nav**: sticky top bar styled as a shell prompt (`$ tonychou@portfolio:~` on the left) with bracket-style anchor links (`[ about ]`, `[ interview ]`, `[ contact ]`) and a `[ resume ]` trigger button on the right. `html { scroll-behavior: smooth }` (disabled under `prefers-reduced-motion`) drives anchor jumps; each section carries `scroll-mt-20`.
- **Hero**: one `TerminalWindow`, framed as a `whoami`/`cat mission.txt` shell session rather than a headline-and-dek hero — name and role as command output, then a short mission paragraph, then a bracket CTA (`[ talk to ai-tony → ]`) anchor-linking to the interview section.
- **About**: one `TerminalWindow`, `cat about.txt` for the summary paragraph, `ls skills/` for the skill groups (plain comma-free monospace lists grouped under uppercase category labels, not pill badges — pills read as a UI-kit component, a flat list reads as terminal output).
- **Interview**: unchanged internally from earlier iterations (topic picker → transcript → advance/wrap-up state machine), reskinned to terminal chrome — the `TerminalWindow`'s path label includes the live topic slug (`tonychou@portfolio:~/interview/<slug>$`) once a topic is chosen. Buttons are bracket-style (`[ continue the interview → ]`, `[ change topic ]`). The interviewer/Tony phosphor-pair coloring stays exactly here, nowhere else.
- **Resume**: not a page section. A `[ resume ]` nav button opens a native `<dialog>` (`ResumeModalProvider.tsx`, exposing `useResumeModal()` so any component can trigger it) containing a `TerminalWindow` with the full experience timeline and a `[ DOWNLOAD PDF ]` link to the static asset. Native `<dialog>` gives focus trap and Escape-to-close for free; a click on the backdrop (not the window itself) also closes it.
- **Contact**: one `TerminalWindow`, `cat contact.txt` — email/linkedin/location as `label:` / value pairs. No phone number published by default.
- **Full-viewport sections**: every top-level public section (`hero`, `about`, `interview`, `contact`) carries `min-h-dvh` and vertically centers its content — a visitor sees one section fill the screen at a time, and only reveals the next by scrolling or using the nav, rather than a dense stacked scroll.

## Component & usage rules

- Accent (`#39ff14`) marks emphasis and interactive elements only; do not paint large surfaces with it.
- Borders are hairline (1px), never a shadow for elevation.
- Buttons are text-first, bracket-styled (`[ SIGN IN ]`, `[ CLOSE ]`, `[ continue the interview → ]`).
- Section/subsection headers read as shell commands (`$ cat about.txt`, `$ ls skills/`) rather than conventional eyebrow labels.
- Interviewer copy/UI always uses phosphor green; Tony copy/UI always uses amber — scoped to the interview transcript only, never elsewhere on the page.
- Tables (internal admin) use monospace alignment (numbers right-aligned).
- A blinking-cursor motif is reserved for exactly one focal point per screen (a loading state, the login prompt).
- Custom cursor (`RetroCursor.tsx`): a small sharp-edged green block that trails the real pointer with a slight lag, using `mix-blend-mode: difference` so it inverts whatever it passes over — the same trick a soft glow-cursor uses, but sharp and phosphor-green instead of blurred, matching the CRT identity. Grows on hover over interactive elements, reverts to the native cursor over text inputs. Only activates when JS confirms a fine pointer and no `prefers-reduced-motion`; native cursor is the default otherwise. Portals itself into whichever `<dialog>` is currently open (native dialogs paint in the browser's top layer, above normal z-index, so a cursor living outside the dialog would otherwise be invisible while one is open).

## Responsive & accessibility direction

- Scanline/glow textures are decorative (`aria-hidden`, `pointer-events: none`), never reduce actual text contrast.
- Respect `prefers-reduced-motion`: disable the cursor blink, any flicker/scan animation, and smooth-scroll.
- Public nav links wrap on narrow viewports rather than collapsing into a hamburger menu — few enough links that wrapping stays legible.
- The résumé dialog fills the viewport edge-to-edge on mobile and stays independently scrollable; the `TerminalWindow` frame itself has no fixed-width assumptions anywhere.
- Monospace body copy at 16px minimum; do not shrink below 13px for anything that carries information.
- Streamed text updates in the interview section announce via `aria-live="polite"` so screen reader users get the conversation without a flood of per-token announcements (batch by turn, not by token).
