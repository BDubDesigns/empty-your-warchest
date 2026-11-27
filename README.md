# Empty Your Warchest

Working title. A scapelike made of small mini games: build the warchest by hand, then run the attack.

Design and the build plan live in Notion. This repo follows the "Build Plan — Prototype" page. Working on the code (people or agents): read [AGENTS.md](AGENTS.md) first.

## Stack

TypeScript (strict) + Vite, Phaser for the 2D camp, three.js for the 3D stations and the siege, Rapier and cannon-es physics, zod-validated data, Vitest for unit tests, Playwright for phone-viewport tests.

Commands, code layout and the engineering rules are in [AGENTS.md](AGENTS.md), so there's one copy to keep up to date.

## Deploys

Cloudflare Pages builds every push: `main` is production, every other branch gets a preview URL. The build branch and commit show in the bottom-right corner of the game, so you can tell which deploy you're looking at.

Build settings: framework preset none, build command `npm run build`, output directory `dist`. Node version comes from `.node-version`.
