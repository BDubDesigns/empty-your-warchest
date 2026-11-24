import type { GameDataInput } from './schema';

// The hand-made tutorial clearing, the generator for every round after it, and the feel. All
// numbers are first guesses, meant to be tuned on a phone.
export const woodcutting = {
  recipe: 'fell_tree',
  chainExponent: 2,
  comboCallouts: [
    { trees: 4, text: 'Nice!' },
    { trees: 5, text: 'Huge!' },
    { trees: 6, text: 'Paul Bunyan!' },
  ],
  clearings: [
    {
      id: 'first_clearing',
      width: 360,
      height: 640,
      canopyRadius: 28,
      trunkRadius: 7,
      canopyStart: 0.3,
      trees: [
        // A diagonal run that chains when aimed down-right.
        { id: 'a1', x: 70, y: 110, height: 100 },
        { id: 'a2', x: 140, y: 170, height: 100 },
        { id: 'a3', x: 210, y: 230, height: 100 },
        { id: 'a4', x: 280, y: 290, height: 90 },
        // A column along the left edge.
        { id: 'b1', x: 60, y: 300, height: 110 },
        { id: 'b2', x: 60, y: 400, height: 110 },
        { id: 'b3', x: 65, y: 505, height: 100 },
        // A loose cluster to find a line through.
        // Forked: falls as two trunks fanning out.
        { id: 'c1', x: 180, y: 380, height: 120, forks: [-25, 25] },
        { id: 'c2', x: 250, y: 430, height: 100 },
        { id: 'c3', x: 300, y: 520, height: 100 },
        { id: 'c4', x: 170, y: 560, height: 100 },
        // Loners.
        { id: 'd1', x: 290, y: 120, height: 110, forks: [-30, 30] },
        { id: 'd2', x: 170, y: 300, height: 90 },
        { id: 'd3', x: 300, y: 610, height: 90 },
      ],
      // The tutorial has no hazards; random clearings bring the cabin and boulders.
    },
  ],
  tutorialClearing: 'first_clearing',
  generator: {
    trees: { min: 14, max: 18 },
    height: { min: 90, max: 120 },
    heightStep: 5,
    spacing: 66,
    margin: 30,
    forkedShare: 0.12,
    forkSpread: { min: 20, max: 30 },
    minBestChain: 3,
    attempts: 40,
    aimSamples: 120,
    // About two trees wide, at an edge.
    cabin: { width: 96, depth: 64, height: 60, gap: 24, edgeInset: 8 },
    // Big enough to read beside a tree: a little smaller than a canopy.
    boulders: { count: { min: 1, max: 3 }, radius: 20, gap: 26 },
  },
  // Par comes from trying every fall direction, so it finds chains people often miss: stars are
  // given well short of it.
  stars: { two: 0.4, three: 0.7 },
  starBonus: { two: 0.1, three: 0.25 },
  unlocks: [
    { level: 10, text: 'Bigger clearings: up to 20 trees', trees: { min: 16, max: 20 } },
    { level: 20, text: 'Fast fall: a switch for faster falling trees', fastFall: true },
    { level: 30, text: 'More forked trees', forkedShare: 0.2 },
    { level: 40, text: 'Denser clearings: up to 22 trees', trees: { min: 18, max: 22 } },
  ],
  fastFall: { fallSeconds: 0.9, chainDelay: 0.12 },
  feel: {
    meterSpeed: 1.1,
    timingWindow: 0.46,
    perfectWindow: 0.06,
    perfectWindowLight: 0.18,
    swingSeconds: 0.12,
    goodScatter: 8,
    glancingScatter: 20,
    chopPoints: 6,
    fullPullPoints: 3,
    perfectBonus: 1,
    fineAimStep: 1,
    fallSeconds: 1.5,
    fallEase: 2.5,
    chainDelay: 0.22,
    // About 2.4 tree heights, most of the clearing's width, over about 3 s; 80% kept per bounce.
    boulderRoll: 260,
    boulderSpeed: 180,
    boulderBounce: 0.8,
    shakeStrength: 1,
    hitStopMs: 70,
    buzzChopMs: 10,
    buzzPerfectMs: 22,
    buzzHitMs: 8,
    buzzLandMs: 12,
    buzzLandPerTreeMs: 4,
    buzzLandMaxMs: 30,
  },
} satisfies GameDataInput['woodcutting'];
