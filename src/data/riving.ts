import type { GameDataInput } from './schema';

// Riving (M4a feel prototype). All numbers are first guesses, meant to be tuned on a phone.
export const riving = {
  recipe: 'rive_stave',
  // Log → 2 → 4 → 8 staves.
  halvings: 3,
  // A split within 10% of the piece's middle is even enough; past that the smaller side is lost.
  centreTolerance: 0.1,
  checkTolerance: 8,
  grainKinds: [
    { id: 'rot', name: 'Rot', multiplier: 0.5, weight: 45 },
    { id: 'silver', name: 'Silver grain', multiplier: 2, weight: 35 },
    { id: 'gold', name: 'Gold grain', multiplier: 3, weight: 20 },
  ],
  tutorialLog: {
    id: 'tutorial_log',
    radius: 1,
    height: 1.7,
    rings: 14,
    checks: [100, 280],
    grains: [],
  },
  generator: {
    radius: { min: 0.92, max: 1.08 },
    height: { min: 1.55, max: 1.8 },
    rings: { min: 11, max: 19 },
    checks: { min: 0, max: 2 },
    grains: { min: 1, max: 3 },
    grainWidth: { min: 10, max: 20 },
    grainGap: 12,
  },
  feel: {
    fineAimStep: 1,
    strikeSeconds: 0.18,
    hitStopMs: 60,
    shakeStrength: 1,
    leverTravel: 220,
    bandLow: 0.5,
    bandHigh: 1.4,
    bindSeconds: 0.7,
    speedWindow: 0.15,
    strainRise: 3,
    strainRecover: 1.2,
    checkEase: 0.4,
    pieceSeconds: 0.35,
    buzzStrikeMs: 18,
    buzzCrackMs: 6,
    buzzCleanMs: 14,
    buzzRunoutMs: 40,
  },
} satisfies GameDataInput['riving'];
