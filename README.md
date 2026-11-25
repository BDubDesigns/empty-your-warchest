# Empty Your Warchest

Working title. A scapelike made of small mini games: build the warchest by hand, then run the attack.

Design and the build plan live in Notion. This repo follows the "Build Plan — Prototype" page. Working on the code (people or agents): read [AGENTS.md](AGENTS.md) first.

## Stack

TypeScript (strict) + Vite, Phaser for the 2D camp and mini games, three.js for 3D (woodcutting and the runner), Vitest for unit tests, Playwright for the smoke test.

## Commands

```bash
npm ci              # install
npm run dev         # local dev server
npm run typecheck   # tsc
npm run lint        # eslint
npm run format      # prettier --write
npm test            # vitest
npm run build       # production build into dist/
npm run test:e2e    # playwright smoke test (builds and serves dist/ first)
```

## Layout

```
src/
  app/        app shell: switches between Phaser and three.js screens
  data/       single source of truth: skills, items, recipes, stations, units, levels, tuning
  core/       state, inventory, recipes, XP curve, idle engine, save/load, event logger, seeded RNG
  camp/       Phaser camp scene (stations built from data)
  stations/   one folder per mini game (woodcutting, splitting, firemaking)
  runner/
    sim/      pure TS, deterministic, no rendering imports (enforced by ESLint)
    view/     three.js rendering + input
  debug/      debug menu
tests/        Vitest unit tests
e2e/          Playwright smoke test (phone viewport, touch)
```

## Deploys

Cloudflare Pages builds every push: `main` is production, every other branch gets a preview URL. The build branch and commit show in the bottom-right corner of the game, so you can tell which deploy you're looking at.

Build settings: framework preset none, build command `npm run build`, output directory `dist`. Node version comes from `.node-version`.
