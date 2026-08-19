---
name: portfolio-terminal-design-system
source: derived
character: "One retro phosphor-CRT terminal identity for the whole app — public portfolio and internal admin both live inside the same terminal-window chrome, monospace type, and single glowing green. What used to be two deliberately distinct systems (an editorial blue/orange public site, a green-terminal internal admin) is now one: the public site adopted the admin's terminal language wholesale rather than the other way around, after the earlier editorial-with-3D-room direction was rejected outright ('looks very childish')."
tokens: "apps/web/src/app/terminal.css and the tailwind.config.ts term.* colors. Never duplicated here. Colour tokens resolve on :root (so <html> paints the overscroll canvas and the pre-paint theme script only stamps one element); typography/spacing/motion stay on .terminal-theme, applied to <body> in the root layout so it covers the whole app."
contrast: "Dark (CRT) — ink #39ff14 on canvas #0a0a0f: 14.57:1 · body #5fcc5f on canvas: 9.68:1 · muted #608c60 on canvas: 5.10:1 · on-accent #0a0a0f on accent #39ff14: 14.57:1 · border #458045 on surface #10160f: 3.87:1 · error #ff3b3b on canvas: 5.59:1. Light (paper) — ink #0f5510 on canvas #f2f1e7: 7.95:1 · body #224820 on canvas: 9.18:1 · muted #4d6b4a on canvas: 5.26:1 · on-accent #fcfbf5 on accent #0f5510: 8.70:1 · border #6f8f6b on surface #fcfbf5: 3.48:1 · error #a81b13 on canvas: 6.54:1 · tony #6f4200 on surface: 8.25:1"
---

## Build mandate

You are a senior product designer. Every page ships as a complete, professional product surface: real copy, a considered layout with hierarchy, all states (empty, loading, error), supporting content. Maximalist, never a lone form or lone widget floating on an empty page. Full disqualifier list: the UI guide's bar.

## Character & direction

An old phosphor CRT terminal, the kind you'd SSH into a server from in 1985. One glowing green (`#39ff14`) does almost all the work — headings, body text, borders, accents — because a real terminal doesn't have a palette, it has a phosphor color and the black behind it. Monospace type end to end (IBM Plex Mono, loaded once in the root layout). Corners are sharp (0–4px), motion is fast and a little harsh (80–200ms, no springs), and the whole app leans into the bit: a scanline texture over the canvas, a blinking cursor accent, copy that reads like shell output (`$ whoami`, `$ cat about.txt`, `$ ls skills/`).

Two modes, one identity. The CRT is still the default and the character of the site, but a visitor can switch — the nav carries a `[ theme: auto|light|dark ]` bracket control, and "auto" (the never-chosen default) follows the OS `prefers-color-scheme`.

**This overrides the earlier "no light mode, a CRT terminal has one mode" rule, which was a deliberate art-direction call — worth a human re-read.** The light palette is not a generic light UI and does not soften the identity: it is a **paper terminal**, the line-printer page the CRT session was printed onto. Same single-hue discipline, same monospace, same sharp corners and shell-output copy; only the medium changes — dark phosphor ink (`#0f5510`) on warm stock (`#f2f1e7`) instead of bright phosphor on black. Two consequences follow from taking the metaphor seriously: ink on paper does not bloom, so the `terminal-glow` text-shadow drops to zero alpha in light; and the scanline texture stays but re-inks dark and faint, where it reads as paper ruling rather than a raster. The interview transcript's dual-phosphor speaker pair survives the switch as a dark green / dark amber pairing, the way two ribbon colors would.

Theme resolution lives in `terminal.css` as three states — explicit light, explicit dark, and absent (`data-theme` unset = follow the OS) — never as per-component overrides. The choice persists in `localStorage` under `tc-portfolio-theme`, and an inline blocking script in the root layout's `<head>` stamps `<html>` before first paint so there is no flash of the wrong theme. Switching is instant: no cross-fade, matching "motion is fast and a little harsh."

Beta (`/beta`) does **not** participate. It keeps its own fixed daylight identity (`.beta-theme`, and `color-scheme` pinned light so an explicit dark choice cannot leak UA-styled dark controls onto it).

This direction replaced two earlier attempts on the public site: a full-bleed 3D interview room (dropped — "looks very childish"), then a content-forward 2D editorial page with a blue/orange accent system (dropped in favor of unifying with the internal admin's already-working terminal identity, rather than running two systems side by side). The interviewer/Tony speaker coloring survives as the one deliberate exception to "one accent," but was itself recolored from a modern blue/orange UI palette to a dual-phosphor pairing — bright green `#39ff14` (same as the ink/accent) for the interviewer, amber `#ffb000` for Tony (AI) — the same way an old terminal used distinct ANSI/phosphor colors for different log sources without breaking the illusion. Scoped to exactly the interview transcript (avatar badge + role label), nowhere else.

Public 3D survives, but strictly opt-in: the site loads straight to the 2D page, and the only way into the scene is the colophon link in the contact section (`[ view the 3d desk ]`) — no nav button, no first-visit auto-play. The scene is a small desk vignette (desk, CRT-styled monitor, keyboard, and props) built from a Blender-exported GLB (`public/Untitled.glb`) rather than in-code primitive geometry, with drag-to-orbit while idle. Clicking the monitor — or pressing the auto-focused `[ enter site → ]` DOM overlay button or Escape, the keyboard route in a scene whose canvas is pointer-only — zooms the camera in and then **hard-swaps** to the real 2D site: the 3D canvas unmounts entirely, so the actual site is always real, accessible DOM, never a WebGL texture. See `DeskScene.tsx` / `DeskSceneProvider.tsx`. Accent lighting in the scene is single-hue cyan (`#22d3ee`, matching the monitor backlight) from a visible under-desk LED strip — the earlier magenta/cyan floating rim-light pair was removed as sourceless and untasteful.

## Scope

The entire app: the public portfolio (`page.tsx` and its sections) and the internal admin (`/internal/usage`). Both render inside the same `.terminal-theme` root (applied to `<body>` in `apps/web/src/app/layout.tsx`), so there is exactly one design system now, not two. The internal admin differs only in content (an authenticated ops dashboard vs. a public portfolio) and in being a single centered `TerminalWindow`, where the public site chains several `TerminalWindow`s down one scrolling page.

## Composition patterns

- **`TerminalWindow`** (`src/components/TerminalWindow.tsx`): the one shared shell — thin green border, a faux title bar (three traffic-light dots, a `user@host:~/path$`-style label), sharp corners. Every content block on the public site and the entire internal admin page is one of these. Callers control their own outer spacing/max-width via `className`; the component itself is unopinionated about placement.
- **Public site nav**: sticky top bar styled as a shell prompt (`$ tonychou@portfolio:~` on the left) with bracket-style anchor links (`[ about ]`, `[ interview ]`, `[ contact ]`) and, after a `|` divider, a `[ resume ]` trigger button and the `[ theme: … ]` cycle control on the right — the theme control lives in the nav rather than as a floating widget so it sits in the row that already holds the site's bracket controls. `html { scroll-behavior: smooth }` (disabled under `prefers-reduced-motion`) drives anchor jumps; each section carries `scroll-mt-20`.
- **Hero**: one `TerminalWindow`, framed as a `whoami`/`cat mission.txt` shell session rather than a headline-and-dek hero — name and role as command output, then a short mission paragraph, then a bracket CTA (`[ talk to ai-tony → ]`) anchor-linking to the interview section.
- **About**: one `TerminalWindow`, `cat about.txt` for the summary paragraph, `ls skills/` for the skill groups (plain comma-free monospace lists grouped under uppercase category labels, not pill badges — pills read as a UI-kit component, a flat list reads as terminal output).
- **Interview**: unchanged internally from earlier iterations (topic picker → transcript → advance/wrap-up state machine), reskinned to terminal chrome — the `TerminalWindow`'s path label includes the live topic slug (`tonychou@portfolio:~/interview/<slug>$`) once a topic is chosen. Buttons are bracket-style (`[ continue the interview → ]`, `[ change topic ]`). The interviewer/Tony phosphor-pair coloring stays exactly here, nowhere else.
- **Resume**: not a page section. A `[ resume ]` nav button opens a native `<dialog>` (`ResumeModalProvider.tsx`, exposing `useResumeModal()` so any component can trigger it) containing a `TerminalWindow` with the full experience timeline and a `[ DOWNLOAD PDF ]` link to the static asset. Native `<dialog>` gives focus trap and Escape-to-close for free; a click on the backdrop (not the window itself) also closes it.
- **Contact**: one `TerminalWindow`, `cat contact.txt` — email/linkedin/location as `label:` / value pairs. No phone number published by default. A `cat colophon.txt` sub-block follows: one plain line on how the site is built (Next.js/Tailwind, NestJS, React Three Fiber) and the `[ view the 3d desk ]` bracket button — the sole entry point to the 3D scene.
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
