import type { GameDataInput } from './schema';

// Riving (M4a feel prototype). All numbers are first guesses, meant to be tuned on a phone.
export const riving = {
  recipe: 'rive_stave',
  // An even eighth (45°) is a stave, so plain halving gives 8; cutting down to 22° gives up to 16.
  stave: { min: 22, max: 46 },
  // Grains multiply the whole log; three could stack to ×18, so they're capped while we tune.
  multiplierCap: 6,
  checkTolerance: 8,
  grainKinds: [
    { id: 'silver', name: 'Silver', multiplier: 2, weight: 60 },
    { id: 'gold', name: 'Gold', multiplier: 3, weight: 40 },
  ],
  tutorialLog: {
    id: 'tutorial_log',
    radius: 1,
    height: 1.7,
    rings: 14,
    checks: [100, 280],
    // One knot to trim off, one grain to keep.
    knots: [{ angle: 60, width: 14 }],
    grains: [{ kind: 'silver', angle: 200, width: 14 }],
  },
  generator: {
    radius: { min: 0.92, max: 1.08 },
    height: { min: 1.55, max: 1.8 },
    rings: { min: 11, max: 19 },
    checks: { min: 0, max: 2 },
    grains: { min: 1, max: 3 },
    grainWidth: { min: 10, max: 20 },
    knots: { min: 1, max: 2 },
    knotWidth: { min: 10, max: 18 },
    grainGap: 12,
    // About two logs in three are the hard case; the rest can come out easy.
    conflictChance: 0.65,
    conflictGap: { min: 4, max: 25 },
  },
  feel: {
    fineAimStep: 0.5,
    strikeSeconds: 0.18,
    hitStopMs: 60,
    shakeStrength: 1,
    leverTravel: 220,
    speedWindow: 0.15,
    pullPerUnevenness: 2.4,
    speedPull: 0.6,
    wobblePerThinness: 0.9,
    wobbleFrom: 90,
    wobbleSeconds: 0.25,
    leanRate: 2.2,
    leanTravel: 70,
    knotPull: 1.5,
    knotJitter: 1.2,
    checkEase: 0.4,
    pieceSeconds: 0.35,
    buzzStrikeMs: 18,
    buzzCrackMs: 6,
    buzzCleanMs: 14,
    buzzRunoutMs: 40,
  },
} satisfies GameDataInput['riving'];
