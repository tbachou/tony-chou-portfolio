# apps/web — Next.js site

## Overview

The public portfolio on Vercel: a terminal-themed single-page site (interview simulator, projects, case studies, internal admin) plus `/beta`, a product page with its own separate visual identity. App Router, React 19, server components by default with client islands.

## Stack

Next.js 15 (App Router) · React 19 · Tailwind 3.4 mapped to CSS custom properties · React Three Fiber + drei (the opt-in 3D desk scene) · IBM Plex Mono via next/font · better-auth client for the internal admin.

## Commands

```bash
npm run dev:web                              # dev server :3000 (from repo root)
npx tsc --noEmit -p apps/web/tsconfig.json   # typecheck
npm run lint --workspace=apps/web            # ESLint (root flat config)
```

## Conventions

- **Art direction lives in [design.md](design.md)** — read it before building any UI. Terminal tokens: `src/app/terminal.css` + the `term.*` Tailwind colors. Beta's separate identity: tokens scoped under `.beta-theme` in `src/app/beta/beta.css`.
- Sections compose from `TerminalWindow`; buttons are bracket-style text; modals are native `<dialog>`.
- API calls go through typed helpers in `src/lib/` (`api.ts`, `beta-api.ts`); SSE consumption uses the async-generator fetch parser pattern — copy it, don't reinvent it.
- Metadata per page (`Metadata` export) with canonical URLs; OG images are `opengraph-image.tsx` files per route segment.

## Gotchas

- The root layout hardcodes `.terminal-theme`, fixed overlay divs, and the RetroCursor onto `<body>`. A route with its own identity must escape via `body:has(...)` rules — see the top of `src/app/beta/beta.css` for the working pattern (overlays, cursor restoration, background).
- `.beta-theme a:not(.beta-btn)` exists because plain link-color rules outrank button classes — keep the `:not()` when touching link styles.
- Demo GIFs use `<img>` (not next/image) deliberately, with eslint-disable comments that must stay.
- `NEXT_PUBLIC_API_URL` defaults to `http://localhost:3001`; production points at Render, CORS-gated.
- Beta launch links from the terminal site open in a new tab on purpose (the identities are separate sites to a visitor).

## Agent skills

Installed globally, not committed here (spec 0014); `skills-lock.json` at the repo root is the list.

- `react-markdown`: `mikkelkrogsholm/dev-skills`, rendering markdown as React elements (remark/rehype plugins, component overrides). Governs one module, `src/app/projects/interview-simulator/evals/Markdown.tsx`, which is why it is listed here and not at the root
- `vercel-react-best-practices`: `vercel-labs/agent-skills`, React/Next performance patterns
- `tailwindcss-*` (6 skills, e.g. `tailwindcss-advanced-layouts`): `josiahsiegel/claude-plugin-marketplace`, layout/animation/mobile patterns

## Related specs

[0003 frontend/deploy](../../docs/specs/_root/0003-frontend-deployment-platform.md) · [0004 Beta](../../docs/specs/_root/0004-beta-climbing-rehab-planner/index.md) · [design.md](design.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
