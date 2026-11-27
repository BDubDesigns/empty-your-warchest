import type { GameDataInput } from './schema';

// Brewing at the cauldron (M9 first slice). Colours and strengths were picked so a Sense potion's
// red-orange is reachable from red caps, moss, ash and water (blue, woad, comes later from
// farming); every number is a first guess, meant to be tuned on a phone.
export const brewing = {
  // About 10 taps a brew, so one takes 30–60 s with the stirring and reading.
  maxFill: 10,
  ingredients: [
    // Strong: the brew's red. 3–7 of them in a Sense potion.
    { item: 'red_cap', color: '#d8301e', strength: 1.6 },
    // Yellow-green: turns red toward orange (and toward mud if overdone).
    { item: 'moss', color: '#a3c23a', strength: 1 },
    // Dark grey with next to no colour: darkens and dulls.
    { item: 'ash', color: '#3b3936', strength: 0.8 },
  ],
  // Lightens, weakly, but uses fill like anything else.
  water: { name: 'Water', color: '#e4ecee', strength: 0.6 },
  potions: [
    {
      recipe: 'brew_sense',
      // Red-orange. Its best answers are around 6 red caps, 2 moss and an ash.
      target: '#c65530',
      // Lighter or darker, redder or more orange: always solvable within the fill (checked at
      // startup), with a different mix most brews.
      jitter: { L: 0.035, a: 0.02, b: 0.012 },
    },
  ],
  // OKLab distance: about 0.02 is a just-noticeable difference side by side. The worst target in
  // the jitter box is 0.019 from its nearest answer, so 3 stars is always reachable.
  stars: { three: 0.025, two: 0.05, one: 0.1 },
  // Brandon (Nov 26): every potion is the same; better brews make more and give an ingredient back.
  rewards: {
    one: { potions: 1, refunds: 0 },
    two: { potions: 1, refunds: 1 },
    three: { potions: 2, refunds: 1 },
  },
  yard: { radius: 2.4, wear: 0.65 },
  feel: {
    // About 3 turns of the spoon blend a drop in fully.
    stirPerTurn: 0.35,
    maxTurnsPerSecond: 1.5,
    stirDeadPx: 6,
    dropSeconds: 0.45,
    swirlDrift: 0.04,
    buzzDropMs: 14,
    buzzStirMs: 5,
    buzzBottleMs: 40,
  },
} satisfies GameDataInput['brewing'];
