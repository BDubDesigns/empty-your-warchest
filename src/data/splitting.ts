import type { GameDataInput } from './schema';

// Splitting (M4a feel prototype). All numbers are first guesses, meant to be tuned on a phone.
export const splitting = {
  recipe: 'split_stave',
  // Grains multiply the whole log, high enough that every good grain kept counts.
  multiplierCap: 18,
  // Whole degrees: half-degree steps made the best split a sliver you could slip off lifting a
  // finger.
  turnStep: 1,
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
  // Playtest 6: 70% / 90% was too strict (0 or 1 star until the exact best). The bonus matches
  // woodcutting's.
  stars: { one: 0.25, two: 0.5, three: 0.8 },
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
    rings: 22,
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
    // Growth rings, only drawn: enough that the end grain reads as a real log.
    rings: { min: 18, max: 30 },
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
    // A 3-star split you can find without pixel-hunting.
    leeway: 3,
    tries: 12,
  },
  // Grass round the block, trodden bare in the middle where the work happens.
  yard: { radius: 2.6, wear: 0.6 },
  feel: {
    strikeSeconds: 0.4,
    hitStopMs: 70,
    shakeStrength: 1,
    buzzCutMs: 6,
    tickGapMs: 35,
    liftMs: 120,
    liftPx: 8,
    pumpTravel: 70,
    pumpsFew: 3,
    pumpsMany: 5,
    pumpSeconds: 0.12,
    burstSeconds: 1.1,
    heapSeconds: 0.6,
    // Room for a big heap in front of the block (Brandon, Nov 25: the staves looked tiny).
    heapCameraBack: 3,
    heapCameraSeconds: 0.5,
    buzzStrikeMs: 20,
    buzzPumpMs: 18,
    buzzPumpBuildMs: 30,
    buzzBurstMs: 60,
  },
} satisfies GameDataInput['splitting'];
