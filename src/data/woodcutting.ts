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
    // About two trees wide, among the trees, where at least 4 can fall on it.
    cabin: { width: 96, depth: 64, height: 60, gap: 24, fenceGap: 50, reachTrees: 4 },
    // Big enough to read beside a tree: a little smaller than a canopy.
    boulders: { count: { min: 1, max: 3 }, radius: 20, gap: 26 },
  },
  // Par comes from trying every fall direction, so it finds chains people often miss: stars are
  // given well short of it.
  // A cabin hit makes it a 1-star round (no star bonus), however well it was going.
  stars: { two: 0.4, three: 0.7, cabinCap: 1 },
  starBonus: { two: 0.1, three: 0.25 },
  unlocks: [
    { level: 10, text: 'Bigger clearings: up to 20 trees', trees: { min: 16, max: 20 } },
    { level: 20, text: 'Fast fall: a switch for faster falling trees', fastFall: true },
    { level: 30, text: 'More forked trees', forkedShare: 0.2 },
    { level: 40, text: 'Denser clearings: up to 22 trees', trees: { min: 18, max: 22 } },
  ],
  fastFall: { fallSeconds: 0.9, chainDelay: 0.12 },
  // Outside the fence: grass thick by the fence and thinning out, undergrowth, a wall of forest
  // (held back on the camera's side), and the woodcutter's track, woodpile and chopping block.
  scenery: {
    seed: 11,
    plants: [
      {
        kind: 'grassTall',
        count: 900,
        height: { min: 18, max: 30 },
        reach: 330,
        bunch: 1.6,
        sway: 0.18,
      },
      {
        kind: 'grassShort',
        count: 1100,
        height: { min: 12, max: 20 },
        reach: 330,
        bunch: 1.3,
        sway: 0.15,
      },
      { kind: 'fern', count: 60, height: { min: 14, max: 22 }, reach: 300, bunch: 1.5, sway: 0.06 },
      {
        kind: 'plant',
        count: 30,
        height: { min: 12, max: 20 },
        reach: 300,
        bunch: 1.2,
        sway: 0.05,
      },
      { kind: 'bush', count: 24, height: { min: 20, max: 32 }, reach: 320, bunch: 1.1, sway: 0.02 },
      {
        kind: 'flowers',
        count: 40,
        height: { min: 8, max: 13 },
        reach: 220,
        bunch: 1.4,
        sway: 0.12,
      },
      { kind: 'rock', count: 14, height: { min: 10, max: 22 }, reach: 330, bunch: 1, sway: 0 },
      { kind: 'mushroom', count: 24, height: { min: 3, max: 5 }, reach: 200, bunch: 1.8, sway: 0 },
    ],
    sides: { far: 1, near: 1.6, left: 0.5, right: 0.5 },
    // A forest clearing worked by hand: grass with bare earth worn through in places.
    clearingWear: 0.45,
    windSpeed: 0.6,
    forest: {
      trees: 44,
      gap: 50,
      nearGap: 330,
      depth: 330,
      spacing: 55,
      height: { min: 100, max: 150 },
    },
    track: { x: 180, width: 46, length: 360 },
    woodpile: { x: 262, y: 700, rows: 4, length: 34, radius: 5 },
    block: { x: 112, y: 690, radius: 10, height: 12 },
    birds: { flock: { min: 5, max: 9 }, speed: 240, seconds: 3, chance: 0.35 },
  },
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
    // The cabin crash: a freeze, a punch in, then half a second at a third speed as it caves in;
    // the summary waits for the wreck to settle.
    crashHitStopMs: 90,
    crashShake: 0.45,
    crashPunch: 0.12,
    crashSlowMo: 0.35,
    crashSlowMoSeconds: 0.6,
    crashPush: 6,
    crashShove: 1.6,
    crashGravity: 14,
    crashFriction: 0.35,
    crashBounce: 0.1,
    crashRubble: 0.3,
    crashSagSeconds: 0.5,
    crashSettleSeconds: 2.6,
    buzzCrashMs: 70,
    buzzCrashPulses: 5,
  },
} satisfies GameDataInput['woodcutting'];
