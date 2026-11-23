# AGENTS.md

Guide for any coding agent (or person) working on this repo. Keep it short: how we work and the
rules the code follows. Design, decisions, history and progress live in **Notion**, not here.

## Start here

- **Notion is the source of truth for design and status.** Read these before changing behaviour:
  - [Progress & Current State](https://app.notion.com/p/4212a9ef9db28114a89ec4bd981b741b): what's
    built, what's next, open questions
  - [Warchest (working title)](https://app.notion.com/p/4202a9ef9db281a59c63fbc081650f85): the
    design pages (Core Loop, Skills, Attack Run, Items & Recipes, Tech & Platform, Idea Inbox,
    Open Questions)
  - [Build Plan — Prototype](https://app.notion.com/p/4202a9ef9db2814497c4fa9ee811904f): milestones
    and their "done when" checks, plus a page per milestone with every change and its reason
- If Notion doesn't answer a design question, ask Brandon (or flag it in the PR). Don't invent
  design. Pure tuning numbers may be guessed if they live in data and are noted in the PR.

## How we work

- **One slice at a time.** Summarize the plan and ask questions before coding. Small PRs.
- **Branch + PR for every change.** Never push to `main`. Merge only when Brandon says so.
- **Brandon tests on his phone through deployed URLs only** (no local network). Cloudflare Pages
  builds every branch: `https://<branch>.empty-your-warchest.pages.dev`; `main` is production at
  https://empty-your-warchest.pages.dev. Check the preview yourself before handing it over.
- **Keep Notion up to date as you go**, in the same session as the change: what changed and an
  italic _Why_, on the milestone page; update Progress & Current State when status changes; raw
  ideas go to the Idea Inbox, unresolved questions to Open Questions.
- **Phone logs:** Brandon sends exports from Debug → Export. Check `woodcutting.roundStart` feel
  values against `src/data` first: live-tuning slider overrides persist on the phone until
  "Reset to data" and can hide data changes.
- **Be honest, don't fold.** If an idea of Brandon's isn't the best fix, say so, explain why and
  recommend the better option; then do what he decides. He's growing into game dev, so briefly
  explain the game dev reasoning or terms behind a call when it helps.

## Engineering rules

- **Single source of truth, nothing hardcoded.** Every item, recipe, rate, cap, threshold, timing,
  layout and piece of feel tuning lives in `src/data/`, typed and validated at startup (zod plus
  cross-reference checks; bad data fails loudly). Code reads data; it never repeats it.
- **Modular: easy to add, change and reuse.** Not architecture for its own sake. A new station is
  new data plus one mechanic module (`src/stations/registry.ts`); shared pieces (sounds, the
  warchest, live tuning, logging) are written once and reused by every mini game.
- **Rules apart from rendering.** `src/core`, `src/data`, `src/runner/sim` and
  `src/stations/*/logic` never import Phaser or three.js (ESLint enforces it). Views feed input to
  the rules and draw their state, so visuals can change without touching gameplay.
- **What you see is what counts.** Visuals are sized and timed from the rules' numbers (e.g. tree
  models are scaled to the data's reach and canopy), never the other way round.
- **Deterministic.** Randomness goes through the seeded RNG (`src/core/rng.ts`) so rounds replay.
- **Log everything useful** through the shared event logger, so tuning comes from playtest data.
- **No save migrations before launch.** A save that doesn't fit the data is discarded and logged.
- Exact dependency versions; TypeScript strict; match the surrounding code's style and comments.

## Commands

```bash
npm ci                 # install (Node version in .node-version)
npm run dev            # local dev server
npm run typecheck      # tsc
npm run lint           # eslint (type-aware, strict)
npm run format:check   # prettier (npm run format to fix)
npm test               # vitest unit tests
npm run build          # production build into dist/
npm run test:e2e       # playwright on a phone viewport (builds and serves dist/)
```

CI runs all of these on every push. The e2e tests pin the simpler Kenney trees because CI renders
3D in software, where the detailed trees are slow.

## Layout

```
src/
  app/        app shell: switches Phaser and three.js screens, sound, theme
  data/       single source of truth (schema.ts + validate.ts + one file per area)
  core/       game state, inventory, recipes, XP, save, event logger, live tuning, seeded RNG
  camp/       Phaser camp hub and warchest screen (stations built from data)
  stations/   one folder per mini game: logic/ (rules, unit tested) and its view
  runner/     sim/ (pure, deterministic) and view/ (three.js)
  debug/      debug menu (items, levels, log export, live tuning)
tests/        Vitest unit tests      e2e/   Playwright tests
public/       models and audio (CC0; credits in each CREDITS.md)
```
