import type { GameDataInput } from './schema';

// Riving (M4a feel prototype). All numbers are first guesses, meant to be tuned on a phone.
export const riving = {
  recipe: 'rive_stave',
  // Grains multiply the whole log, high enough that every good grain kept counts.
  multiplierCap: 18,
  checkTolerance: 8,
  // Three heads to start, then one more every few levels (a drip-feed), up to the 16-way.
  cutters: [
    { count: 4, level: 1 },
    { count: 5, level: 1 },
    { count: 6, level: 1 },
    { count: 7, level: 3 },
    { count: 8, level: 5 },
    { count: 9, level: 8 },
    { count: 10, level: 11 },
    { count: 11, level: 14 },
    { count: 12, level: 17 },
    { count: 13, level: 21 },
    { count: 14, level: 25 },
    { count: 15, level: 30 },
    { count: 16, level: 35 },
  ],
  // The best split is always within reach (you can see the total while you turn the cuts), so
  // 3 stars asks for most of it. The bonus matches woodcutting's.
  stars: { one: 0.4, two: 0.7, three: 0.9 },
  starBonus: { two: 0.1, three: 0.25 },
  // Good grains come narrow to wide: a 55° one won't fit an 8-way's 45° wedges, a 75° one
  // needs the 4-way. Rot is narrower, so cutting it out takes aim.
  grainKinds: [
    { id: 'rot', name: 'Rot', multiplier: 0.5, weight: 1, width: { min: 10, max: 26 } },
    { id: 'silver', name: 'Silver', multiplier: 2, weight: 60, width: { min: 12, max: 80 } },
    { id: 'gold', name: 'Gold', multiplier: 3, weight: 40, width: { min: 12, max: 70 } },
  ],
  tutorialLog: {
    id: 'tutorial_log',
    radius: 1,
    height: 1.7,
    rings: 14,
    checks: [100, 280],
    // Run a cut through the rot and keep the silver whole.
    knots: [],
    grains: [
      { kind: 'rot', angle: 40, width: 16 },
      { kind: 'silver', angle: 215, width: 40 },
    ],
  },
  generator: {
    radius: { min: 0.92, max: 1.08 },
    height: { min: 1.55, max: 1.8 },
    rings: { min: 11, max: 19 },
    checks: { min: 0, max: 2 },
    // Always something to keep and something to cut out.
    good: { min: 1, max: 3 },
    bad: { min: 1, max: 2 },
    // Knots are parked while rot does the "bad patch" job: one bad rule reads clearer than two.
    knots: { min: 0, max: 0 },
    knotWidth: { min: 10, max: 18 },
    grainGap: 10,
    nearChance: 0.7,
    nearGap: { min: 4, max: 30 },
    // With good and bad grains on every log, typically 2–4% of head × turn plans earn 3 stars.
    // The easiest logs (over 6%) are mostly made again; about 1 in 4 of them gets through.
    easyShare: 0.06,
    easyChance: 0.25,
    tries: 12,
  },
  feel: {
    fineAimStep: 0.5,
    strikeSeconds: 0.22,
    hitStopMs: 70,
    shakeStrength: 1,
    leverTravel: 300,
    pressureAt: 0.3,
    driveSeconds: 1.4,
    slowDriveSeconds: 4,
    pressurePull: 0.8,
    wobble: 0.4,
    wobbleFrom: 5,
    wobblePerStave: 0.3,
    wobbleSeconds: 0.6,
    leanRate: 3.5,
    leanTravel: 70,
    knotJitter: 1.2,
    checkEase: 0.5,
    pieceSeconds: 0.45,
    burstSeconds: 1.1,
    heapSeconds: 0.6,
    buzzStrikeMs: 20,
    buzzPressMs: 8,
    pressPulseSlow: 0.35,
    pressPulseFast: 0.07,
    buzzLostMs: 40,
    buzzBurstMs: 60,
  },
} satisfies GameDataInput['riving'];
