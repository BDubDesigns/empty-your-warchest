import type { GameDataInput } from './schema';

// Brewing at the cauldron (M9). Three base colours (a red, a yellow-green and a blue) span
// oranges, purples, greens, browns and teals, with ash and water to darken and lighten. Every
// number is a first guess, meant to be tuned on a phone.
export const brewing = {
  // About 10 taps a brew, so one takes 30–60 s with the stirring and reading.
  maxFill: 10,
  ingredients: [
    // Strong red.
    { item: 'red_cap', color: '#d8301e', strength: 1.6, tint: 'red' },
    // Yellow-green: with red, oranges and browns; with woad, greens and teals. Against a purple
    // it dulls the colour without darkening it (ash darkens too).
    { item: 'moss', color: '#a3c23a', strength: 1, tint: 'green' },
    // Blue (from farming one day; the starting stock and the debug menu for now). With red,
    // purples.
    { item: 'woad', color: '#2a4f9e', strength: 1.2, tint: 'blue' },
    // Dark grey with next to no colour: darkens and dulls.
    { item: 'ash', color: '#3b3936', strength: 0.8, tint: 'grey' },
  ],
  // Lightens, weakly, but uses fill like anything else.
  water: { name: 'Water', color: '#e4ecee', strength: 0.6 },
  potions: [
    {
      recipe: 'brew_sense',
      // Dusk violet, from a blue-violet to a plum (OKLCh: lightness, chroma, hue in degrees).
      // Every brew's target is picked anywhere in it (seeded), so brews differ visibly. Each one
      // needs red caps and woad for its hue, then moss, ash or water to dull, darken or lighten
      // it. The worst target is 0.015 from its nearest answer within the fill (checked at
      // startup).
      region: {
        L: { min: 0.45, max: 0.58 },
        chroma: { min: 0.035, max: 0.065 },
        hue: { min: 300, max: 350 },
      },
    },
  ],
  // OKLab distance: about 0.02 is a just-noticeable difference side by side, so the bands are
  // differences the eye can see. Drawn as rings round the target on the colour map.
  stars: { three: 0.03, two: 0.06, one: 0.1 },
  // Brandon (Nov 26): every potion is the same; better brews make more and give an ingredient back.
  rewards: {
    one: { potions: 1, refunds: 0 },
    two: { potions: 1, refunds: 1 },
    three: { potions: 2, refunds: 1 },
  },
  // The ladle frees fill when a drop has put the best brew out of reach: 3 drops' worth a scoop
  // (half the pot at most), twice a brew. What it scoops is lost, which is its cost.
  ladle: { scoop: 3, most: 0.5, uses: 2 },
  // The colour map beside the pot: hue and chroma (OKLab a and b) round every shelf colour,
  // `margin` past the outermost.
  map: { margin: 0.03 },
  // Which way a brew is off: within 0.012 (under the 0.02 the eye notices) is spot on, past 0.04
  // it's "much too light" / "too red" rather than "a shade" / "a touch". The map badges the pot
  // too light or too dark once lightness is half the error or more (Brandon's water drop: all of
  // it was lightness, and the dot sat dead centre).
  advice: { spotOn: 0.012, much: 0.04, lightShare: 0.5 },
  // Shelf icons drawn 128 px (shown about 52 px across): 6 px of black round the item's shape,
  // then 6 px of white, about 2.5 px each on screen.
  icons: { px: 128, outline: 6, halo: 6 },
  yard: { radius: 2.4, wear: 0.65 },
  feel: {
    // About 3 turns of the spoon blend a drop in fully.
    stirPerTurn: 0.35,
    maxTurnsPerSecond: 1.5,
    stirDeadPx: 6,
    dropSeconds: 0.45,
    swirlDrift: 0.04,
    // The map shows which ring the pot is in once no more than this share is unstirred.
    revealUnmixed: 0.1,
    // How wide each unstirred drop's blur is on the map (px at full strength).
    cloudPx: 16,
    // Drag an ingredient onto the pot to add it: 8 px of movement lifts it (a tap does nothing),
    // a miss snaps back in 0.25 s, and the pot counts 28 px past its edge on screen (thumbs).
    dragStartPx: 8,
    snapBackSeconds: 0.25,
    dropPadPx: 28,
    buzzDropMs: 14,
    buzzStirMs: 5,
    buzzBottleMs: 40,
  },
} satisfies GameDataInput['brewing'];
