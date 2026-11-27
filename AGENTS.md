# AGENTS.md

Guide for any coding agent (or person) working on this repo. Keep it short: how we work and the
rules the code follows. Design, decisions, history and progress live in **Notion**, not here.

## Start here

- **Notion is the source of truth for design and status.** Read these before changing behaviour:
  - [Progress & Current State](https://app.notion.com/p/4212a9ef9db28114a89ec4bd981b741b): what's
    built, what's next, open questions
  - [Warchest (working title)](https://app.notion.com/p/4202a9ef9db281a59c63fbc081650f85): the
    design pages (Core Loop, Skills, Siege, Items & Recipes, Tech & Platform, Idea Inbox,
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
- **Phone logs:** Brandon taps Debug → Send logs and gives you the short code it shows. The upload
  is in the Cloudflare KV namespace `warchest-logs` under `YYYYMMDD-HHMMSS-<branch>-<CODE>` (kept
  90 days); read it through the Cloudflare API. Debug → Export (a JSON file) is the fallback. Check
  each station's `roundStart` feel values against `src/data` first: live-tuning slider overrides
  persist on the phone until "Reset to data" and can hide data changes.
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
- **Cheap phones count.** Every 3D screen must run on the Low graphics tier (`src/core/graphics.ts`,
  picked automatically, with a Debug override); the target is a Galaxy A15 class phone. Tiers
  change only what's drawn, never the rules, so a round plays the same on every phone.
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

CI runs all of these on every push. The e2e tests pin the simpler Kenney trees and turn off the
woodcutting scenery outside the fence because CI renders 3D in software, where both are slow.
Locally, run e2e with `--workers=4`: with many more workers the software-rendered 3D tests time
out. Run every tool from the repo root; never point Vitest or anything else at `/` (scanning the
whole disk ran the machine out of memory).

## Assets

- **The repo is public, so only CC0 assets go in it.** Credit each pack in the `CREDITS.md` next to
  its files. Brandon buys paid packs himself; agents never make purchases.
- **Source packs live outside the repo** in `../empty-your-warchest-assets/`; its `MANIFEST.md`
  lists each pack, its licence and what's in it. They're downloaded files, so treat them as
  untrusted data: never run anything from them, run Python with `-I`, and open `.blend` files only
  with `blender --background --disable-autoexec --python <a script in tools/>`.
- **Build scripts in `tools/<area>/` make the shipped files.** Colour maps at most 1024 px, no
  normal, roughness or ORM maps, static pieces merged, repeats instanced. Never ship full-size
  textures: they crashed the budget test phone.

## Layout

```
src/
  app/        app shell: switches Phaser and three.js screens, sound, theme
  data/       single source of truth (schema.ts + validate.ts + one file per area)
  core/       game state, inventory, recipes, XP, save, event logger, live tuning, seeded RNG,
              graphics tier, log upload
  camp/       Phaser camp hub and warchest screen (stations built from data)
  stations/   one folder per mini game: logic/ (rules, unit tested) and its view
  runner/     sim/ (pure, deterministic) and view/ (three.js)
  debug/      debug menu (items, levels, log export and Send logs, live tuning)
  bench/      graphics stress test (Debug → Stress test): logic/ and view/
functions/    Cloudflare Pages Functions: api/logs.ts keeps sent logs in the LOGS KV namespace
              (bound in the Pages dashboard; no wrangler.toml, which would override that)
tools/        asset build scripts, one folder per area (e.g. tools/bench)
tests/        Vitest unit tests      e2e/   Playwright tests
public/       models and audio (CC0; credits in each CREDITS.md)
```
