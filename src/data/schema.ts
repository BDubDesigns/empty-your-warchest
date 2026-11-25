import { z } from 'zod';

/** lower_snake_case id used to reference one piece of data from another. */
const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use a lower_snake_case id');
const name = z.string().min(1);
const fraction = z.number().min(0).max(1);
const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const nonNegative = z.number().nonnegative();

/** A spot in the camp, as a fraction of the portrait screen (0,0 top-left; 1,1 bottom-right). */
const campSpotSchema = z.object({ x: fraction, y: fraction });

export const skillSchema = z.object({ id, name });

export const itemSchema = z.object({ id, name });

export const itemStackSchema = z.object({
  item: id,
  count: positiveInt,
});

export const stationSchema = z.object({
  id,
  name,
  /** Skill that earns XP here. */
  skill: id,
  /** Which mini game module runs this station. */
  mechanic: id,
  camp: campSpotSchema,
});

export const campSchema = z.object({
  /** Where the chest that opens the warchest view sits. */
  chest: campSpotSchema,
});

export const recipeSchema = z.object({
  id,
  station: id,
  inputs: z.array(itemStackSchema),
  outputs: z.array(itemStackSchema).min(1),
  /** XP per batch, paid to the station's skill. */
  xp: nonNegative,
});

export const unitSchema = z.object({
  id,
  name,
  hp: positiveInt,
  /** Damage when no weapon was left in the warchest for this unit. */
  unarmedDamage: nonNegative,
  weapon: z.object({ item: id, damage: nonNegative }),
});

export const enemySchema = z.object({ id, name, hp: positiveInt, damage: nonNegative });

const gateSchema = z.object({
  op: z.enum(['add', 'subtract', 'multiply', 'divide']),
  value: positiveInt,
  /** Attack it on approach to turn it from negative to positive. */
  flippable: z.boolean().default(false),
});

/** `at` is how far along the track the event happens, from 0 (start) to 1 (end). */
const levelEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gates'), at: fraction, left: gateSchema, right: gateSchema }),
  z.object({ type: z.literal('enemies'), at: fraction, enemy: id, count: positiveInt }),
  z.object({ type: z.literal('wall'), at: fraction, hp: positiveInt }),
]);

export const levelSchema = z.object({
  id,
  name,
  kind: z.enum(['skirmish']),
  durationSeconds: positive,
  /** The unit every recruit becomes. */
  unit: id,
  startingRecruits: positiveInt,
  events: z.array(levelEventSchema).min(1),
  rewards: z.object({ xpPerEnemy: nonNegative, xpPerSurvivor: nonNegative }),
});

export const tuningSchema = z.object({
  /** RuneScape-style curve: each level costs floor(n + base * 2^(n / doublingLevels)) points, divided by divisor. */
  xpCurve: z.object({
    maxLevel: z.number().int().min(2),
    base: positive,
    doublingLevels: positive,
    divisor: positive,
  }),
  idle: z.object({ capMinutes: positive }),
  /** Share of used weapons recovered after winning a run. */
  weaponRecoveryOnWin: fraction,
});

const clearingSchema = z.object({
  id,
  /** Size of the clearing in its own units; it's scaled to fit the phone screen. */
  width: positive,
  height: positive,
  /**
   * Radius of every tree's canopy. A falling tree knocks over a standing tree when its canopy
   * reaches that tree's trunk (as it would in 3D: a standing tree's canopy is up in the air,
   * out of reach of a tree falling past it, so it's the trunk that gets hit).
   */
  canopyRadius: positive,
  /** Radius of every tree's trunk, for those hits. */
  trunkRadius: positive,
  /**
   * Where the canopy starts up the tree (share of its height); below that it's bare trunk, so a
   * falling tree's lower part only knocks over trunks it actually touches.
   */
  canopyStart: z.number().min(0).max(1),
  trees: z
    .array(
      z.object({
        id,
        x: nonNegative,
        y: nonNegative,
        /** How far the tree reaches when it falls. */
        height: positive,
        /**
         * A forked tree falls as 2–3 trunks fanning out: one per offset (degrees) from the
         * fall direction. Each trunk knocks trees over on its own line.
         */
        forks: z.array(z.number().min(-90).max(90)).min(2).max(3).optional(),
      }),
    )
    .min(1),
  /**
   * Boulders: a falling tree that touches one (its trunk or canopy, lying down) knocks it rolling
   * by the pool cut rule: dead on straight along the fall, a half hit 30° off to its side, an edge
   * clipped nearly sideways. It rolls `boulderRoll` (feel) units, knocking over every tree it runs
   * into the same way, bounces off the fence around the clearing (keeping `boulderBounce` of the
   * roll left each time), and stops early against the cabin (a crash) or another boulder (which it
   * sets rolling). It stays where it stops.
   */
  boulders: z.array(z.object({ id, x: nonNegative, y: nonNegative, radius: positive })).default([]),
  /**
   * The cabin: a falling tree that touches it crashes into it and stops there. The chain's logs
   * are lost and the round ends. A box centred on (x, y), `width` across and `depth` down the
   * clearing, `height` tall.
   */
  cabin: z
    .object({
      x: nonNegative,
      y: nonNegative,
      width: positive,
      depth: positive,
      height: positive,
    })
    .optional(),
});

/** Feel numbers for the woodcutting mini game. The debug menu can override them live. */
export const woodcuttingFeelSchema = z.object({
  /** Passes per second the chop bar's marker sweeps across while you hold the axe back. */
  meterSpeed: positive,
  /** Width of the green (good) zone around the yellow, as a share of the bar. */
  timingWindow: fraction,
  /**
   * Width of the yellow (perfect) zone at a full pull. A lighter pull makes it wider, up to
   * perfectWindowLight at the lightest pull. It moves to a new spot after every chop.
   */
  perfectWindow: fraction,
  perfectWindowLight: fraction,
  /** Seconds for the axe to swing from wound-up into the tree. */
  swingSeconds: positive,
  /** Most a good chop can knock the fall direction off, in degrees (perfect: never). */
  goodScatter: z.number().min(0).max(90),
  /** Most a glancing chop can knock the fall direction off, in degrees. */
  glancingScatter: z.number().min(0).max(90),
  /** Chop points needed to fell a tree. */
  chopPoints: positiveInt,
  /** Points a full pull of the axe deals; a partial pull deals its share (at least 1). */
  fullPullPoints: positiveInt,
  /** Extra points for a chop released on yellow. A glancing chop deals half. */
  perfectBonus: nonNegative,
  /** Degrees each tap of a fine-tune button turns the aim. */
  fineAimStep: positive,
  /** Seconds for a tree to fall from upright to the ground. */
  fallSeconds: positive,
  /** How sharply a fall speeds up: 1 = steady, higher = slower start and faster finish. */
  fallEase: z.number().min(1),
  /** Extra pause before a hit tree starts to fall, so the cascade ripples. */
  chainDelay: nonNegative,
  /**
   * Boulders: how far one rolls when knocked (clearing units), how fast it sets off (units per
   * second; it slows evenly to a stop), and how much of the roll left it keeps after each bounce
   * off the fence.
   */
  boulderRoll: positive,
  boulderSpeed: positive,
  boulderBounce: fraction,
  /** Multiplier for every screen shake. 0 turns shake off. */
  shakeStrength: nonNegative,
  /** How long the game freezes on a perfect chop (hit-stop), in milliseconds. */
  hitStopMs: nonNegative,
  /** Vibration pulses, in milliseconds (0 = none). A chop biting in; a perfect one. */
  buzzChopMs: nonNegative,
  buzzPerfectMs: nonNegative,
  /** A falling tree knocking into the next: a lighter tick before the landing. */
  buzzHitMs: nonNegative,
  /** A tree landing: longer for each tree the chain has landed so far, up to the max. */
  buzzLandMs: nonNegative,
  buzzLandPerTreeMs: nonNegative,
  buzzLandMaxMs: nonNegative,
  /**
   * The cabin crash. Hit-stop on impact (ms), how hard the screen shakes, and how far the camera
   * punches in toward the cabin (share of its distance), then time slows to `crashSlowMo` for
   * `crashSlowMoSeconds` (real seconds) as the cabin gives way.
   */
  crashHitStopMs: nonNegative,
  crashShake: nonNegative,
  crashPunch: z.number().min(0).max(0.5),
  crashSlowMo: z.number().min(0.05).max(1),
  crashSlowMoSeconds: nonNegative,
  /**
   * The wreck (only looks: the rules have already called the crash). How fast the parts nearest
   * the hit fly off in the fall's direction, how hard every part is thrown out from the cabin's
   * middle (a second per world unit up, so the walls splay and the roof drops in), gravity, and
   * the parts' friction and bounce.
   */
  crashPush: nonNegative,
  crashShove: nonNegative,
  crashGravity: positive,
  crashFriction: fraction,
  crashBounce: fraction,
  /**
   * The tree that hit the cabin sinks with the caving roof, over `crashSagSeconds`, until it rests
   * on the rubble at `crashRubble` of the cabin's height (it still knocks nothing else).
   */
  crashRubble: fraction,
  crashSagSeconds: positive,
  /** Seconds the summary waits after the crash, so the wreck can settle. */
  crashSettleSeconds: nonNegative,
  /** The crash's buzz: `buzzCrashPulses` pulses, the first `buzzCrashMs` long, each one shorter. */
  buzzCrashMs: nonNegative,
  buzzCrashPulses: z.number().int().min(1),
});

/** A min–max range. */
const rangeSchema = z.object({ min: nonNegative, max: nonNegative });

/** The low plants and stones scattered outside the woodcutting fence (models picked by name). */
export const sceneryPlantKinds = [
  'grassTall',
  'grassShort',
  'fern',
  'plant',
  'bush',
  'flowers',
  'rock',
  'mushroom',
] as const;

/**
 * What's outside the woodcutting fence: only looks, none of it in play. Places are in clearing
 * units, from the clearing's top-left corner (y grows toward the camera), so outside the fence is
 * below 0 or past the clearing's width or height.
 */
export const woodcuttingScenerySchema = z.object({
  /** Seed for where everything goes: the same every round. */
  seed: z.number().int(),
  /**
   * Plants scattered from the fence out to `reach`, bunched toward the fence by `bunch` (1 even,
   * higher bunches more), each `height` tall. Their tips sway `sway` of their height in the wind.
   */
  plants: z.array(
    z.object({
      kind: z.enum(sceneryPlantKinds),
      count: z.number().int().min(0),
      height: rangeSchema,
      reach: positive,
      bunch: z.number().min(1),
      sway: z.number().min(0).max(0.5),
    }),
  ),
  /**
   * How thickly plants grow along each side of the fence, relative to its length: the camera
   * sees the near and far sides most (on a phone the long sides are mostly off screen).
   */
  sides: z.object({ far: nonNegative, near: nonNegative, left: nonNegative, right: nonNegative }),
  /** Share of the clearing (inside the fence) worn through the grass to bare earth. */
  clearingWear: fraction,
  /** Wind gusts per second. */
  windSpeed: positive,
  /**
   * Trees that can't be chopped, from `gap` outside the fence out to `gap + depth`, at least
   * `spacing` apart. On the camera's side they start `nearGap` out, so they never hide the clearing.
   */
  forest: z.object({
    trees: z.number().int().min(0),
    gap: nonNegative,
    nearGap: nonNegative,
    depth: positive,
    spacing: positive,
    height: rangeSchema,
  }),
  /** A trodden track leading off from the fence on the camera's side, centred on `x`. */
  track: z.object({ x: z.number(), width: positive, length: positive }),
  /** A stack of split logs beside the track: `rows` rows (the bottom one widest) of logs. */
  woodpile: z.object({
    x: z.number(),
    y: z.number(),
    rows: positiveInt,
    length: positive,
    radius: positive,
  }),
  /** A chopping block with an axe in it. */
  block: z.object({ x: z.number(), y: z.number(), radius: positive, height: positive }),
  /**
   * Birds burst from the trees outside: always when the cabin is hit, and on `chance` of tree
   * landings. A flock of `flock` birds flies off at `speed` (clearing units per second) and is
   * gone after `seconds`.
   */
  birds: z.object({
    flock: z.object({ min: positiveInt, max: positiveInt }),
    speed: positive,
    seconds: positive,
    chance: fraction,
  }),
});

export const woodcuttingSchema = z.object({
  /** Recipe that turns each felled tree into logs. */
  recipe: id,
  /** A chain of N felled trees banks N^chainExponent logs (a forked tree counts once). */
  chainExponent: positive,
  /** Words shouted as a chain grows: the last one whose `trees` is reached shows. */
  comboCallouts: z.array(z.object({ trees: z.number().int().min(2), text: z.string().min(1) })),
  clearings: z.array(clearingSchema).min(1),
  /** The first round ever plays this hand-made clearing; every round after is generated. */
  tutorialClearing: id,
  /**
   * Random clearings. They share the tutorial clearing's size and tree shape (canopy, trunk), so
   * the view and the rules see the same kind of forest every round.
   */
  generator: z.object({
    trees: z.object({ min: positiveInt, max: positiveInt }),
    /** Tree heights (how far a tree reaches), rounded to `heightStep`. */
    height: z.object({ min: positive, max: positive }),
    heightStep: positive,
    /** Closest two trunks may stand, and how far trees stay from the clearing's edges. */
    spacing: positive,
    margin: nonNegative,
    /** Share of trees that are forked, and how far each fork turns from the fall (degrees). */
    forkedShare: fraction,
    forkSpread: z.object({ min: positive, max: positive }),
    /** Every clearing has at least one chain this long; a layout without one is rerolled. */
    minBestChain: positiveInt,
    /** Layouts tried per seed before settling for the best one found. */
    attempts: positiveInt,
    /** Fall directions tried per tree when looking for chains (for the check and for par). */
    aimSamples: positiveInt,
    /**
     * Every random clearing has a cabin among the trees: at least `fenceGap` from the fence, `gap`
     * clear of every trunk, turned either way, and within falling reach of at least `reachTrees`
     * trees (a layout without that is rerolled), so it's always in play.
     */
    cabin: z.object({
      width: positive,
      depth: positive,
      height: positive,
      gap: nonNegative,
      fenceGap: nonNegative,
      reachTrees: z.number().int().min(0),
    }),
    /** Boulders among the trees, at least `gap` from any trunk, the cabin and each other. */
    boulders: z.object({
      count: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
      radius: positive,
      gap: nonNegative,
    }),
  }),
  /**
   * Stars for a finished round, from its logs against the clearing's par (what a solid player
   * would bank, taking the biggest chain they can find each time). 1 star for any banked chain.
   * Hitting the cabin caps the round at `cabinCap` stars, whatever was earned before.
   */
  stars: z.object({ two: fraction, three: fraction, cabinCap: z.number().int().min(0).max(3) }),
  /**
   * Bonus logs when the round ends, as a share of its logs: none for 1 star, then these for 2 and
   * 3 stars. Small, because logs already reward long chains (N × N).
   */
  starBonus: z.object({ two: nonNegative, three: nonNegative }),
  /**
   * What woodcutting levels unlock, in level order. From its level up, an entry changes the random
   * clearings (later entries win). Levels never make the controls more forgiving.
   */
  unlocks: z.array(
    z.object({
      level: positiveInt,
      /** Shown when the level is reached. */
      text: z.string().min(1),
      trees: z.object({ min: positiveInt, max: positiveInt }).optional(),
      forkedShare: fraction.optional(),
      /** Unlocks the fast-fall switch (see `fastFall`). */
      fastFall: z.literal(true).optional(),
    }),
  ),
  /** The fall and chain speeds the fast-fall switch uses (the faster feel from before Nov 23). */
  fastFall: z.object({ fallSeconds: positive, chainDelay: nonNegative }),
  scenery: woodcuttingScenerySchema,
  feel: woodcuttingFeelSchema,
});

export const warchestSchema = z.object({
  /** Items deposited at a station fly from where they came from into the HUD chest. */
  pour: z.object({
    /** At most this many pieces fly; each carries a share, so big deposits stay readable. */
    maxPieces: z.number().int().min(1),
    /** Seconds between pieces leaving. */
    stagger: z.number().min(0),
    /** Seconds each piece hops out of where it came from before flying. */
    popSeconds: positive,
    /** Seconds each piece takes to fly into the chest. */
    flightSeconds: positive,
    /** How high the flight curves, as a share of its length. */
    arcHeight: z.number().min(0),
    /** Seconds the lid stays open after the last piece lands. */
    closeDelay: z.number().min(0),
  }),
  /** Vibration pulses when the HUD chest opens and when its lid slams, in milliseconds. */
  haptics: z.object({ openMs: nonNegative, slamMs: nonNegative }),
});

/** Feel numbers for splitting. The debug menu can override them live. */
export const splittingFeelSchema = z.object({
  /** Seconds the press takes to swing over and slam the head onto the log, and the freeze then (ms). */
  strikeSeconds: positive,
  hitStopMs: nonNegative,
  shakeStrength: nonNegative,
  /**
   * Turning the cuts: a buzz (ms) when turning makes a line start or stop cutting a grain, and a
   * soft click for each step of turn, at most one every `tickGapMs`. A finger that moved under
   * `liftPx` in its last `liftMs` before lifting was holding still: the turn goes back to where
   * it was, so lifting off can't nudge it.
   */
  buzzCutMs: nonNegative,
  tickGapMs: nonNegative,
  liftMs: nonNegative,
  liftPx: nonNegative,
  /**
   * The pump: a swipe of `pumpTravel` pixels down is one stroke (back up halfway, or lift, for
   * the next). The fewest-piece head takes `pumpsFew` strokes to go through, the most-piece head
   * `pumpsMany`, the rest in between. Each stroke drives the head in over `pumpSeconds`.
   */
  pumpTravel: positive,
  pumpsFew: positiveInt,
  pumpsMany: positiveInt,
  pumpSeconds: positive,
  /** Seconds the staves take to burst out and land, then sit in a heap before pouring in. */
  burstSeconds: positive,
  heapSeconds: nonNegative,
  /**
   * Vibration (ms): the head landing, each stroke of the pump (plus up to `buzzPumpBuildMs` more
   * by the last), and the burst.
   */
  buzzStrikeMs: nonNegative,
  buzzPumpMs: nonNegative,
  buzzPumpBuildMs: nonNegative,
  buzzBurstMs: nonNegative,
});

/** A log to split: its size, end grain, and the grains on its end face. */
const splittingLogSchema = z.object({
  id,
  /** Size in world units, for drawing it. */
  radius: positive,
  height: positive,
  rings: positiveInt,
  /** Grains: patches of the end face, each `width` degrees wide centred on `angle`. */
  grains: z.array(z.object({ kind: id, angle: z.number(), width: positive })),
  /** Knots: arcs of the end face (as grains are) that spoil any stave they touch. */
  knots: z.array(z.object({ angle: z.number(), width: positive })),
});

/**
 * Splitting a log into staves with a splitting head: a star of blades that splits the whole log
 * into `count` equal wedges at once, each one a stave. You pick a head (more open up with
 * levels) and turn the cuts, then pump the handle to drive it through. Grains multiply the
 * whole log's staves if they end up whole in a stave; a cut line through a grain cancels it, good
 * or bad. Knots spoil the staves they touch.
 */
const splittingSchema = z.object({
  /** The recipe a split log runs: its yield is the staves it's worth. */
  recipe: id,
  multiplierCap: positive,
  /** Degrees the cuts turn in steps of (dragging and ↺ ↻ alike): whole steps round a turn. */
  turnStep: positive,
  /** The splitting heads: how many staves each makes, and the Splitting level it opens up at. */
  cutters: z.array(z.object({ count: z.number().int().min(2), level: positiveInt })).min(1),
  /**
   * Stars, by the share of the best a log could make with the heads you have (every head at
   * every step of turn), and the bonus staves for 2 and 3 stars, as a share of the log.
   */
  stars: z.object({ one: fraction, two: fraction, three: fraction }),
  starBonus: z.object({ two: nonNegative, three: nonNegative }),
  /**
   * The kinds of grain: what each multiplies the whole log's staves by when it ends up whole in
   * a stave (they multiply together, up to `multiplierCap`; under 1 is a bad grain), how often
   * each turns up among the good or bad ones, and how wide (degrees) it can be. A grain must fit
   * inside one wedge to count, so a wide one can only be kept by a head with few pieces.
   */
  grainKinds: z
    .array(
      z.object({
        id,
        name: z.string().min(1),
        multiplier: positive,
        weight: positive,
        width: z.object({ min: positive, max: positive }),
      }),
    )
    .min(1),
  /** The first log ever: to learn the controls on, with a grain to keep and one to cut. */
  tutorialLog: splittingLogSchema,
  /** Random logs: sizes, rings and grains, from a seed. */
  generator: z.object({
    radius: z.object({ min: positive, max: positive }),
    height: z.object({ min: positive, max: positive }),
    rings: z.object({ min: positiveInt, max: positiveInt }),
    /** Good grains (multiplier over 1) and bad ones on every log. */
    good: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
    bad: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
    knots: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
    knotWidth: z.object({ min: positive, max: positive }),
    /** Least gap (degrees) between two grains or knots, so each reads on its own. */
    grainGap: nonNegative,
    /**
     * How often the first good grain sits close to the first bad one (`nearGap` degrees from its
     * edge), so a line through the bad one lands its neighbours near the good one.
     */
    nearChance: fraction,
    nearGap: z.object({ min: nonNegative, max: positive }),
    /**
     * Logs are checked with the best-split search: a log is easy when more than `easyShare` of
     * every head at every turn would earn 3 stars. Only `easyChance` of easy logs are kept; the
     * rest are made again (up to `tries` times), so most logs are a real choice.
     */
    easyShare: fraction,
    easyChance: fraction,
    /**
     * And a log is fiddly when no head keeps 3 stars over `leeway` degrees of turn in a row:
     * those are always made again (the last fair one is used if every try is fiddly).
     */
    leeway: nonNegative,
    tries: positiveInt,
  }),
  /**
   * The yard round the chopping block: grass, worn to bare earth in an oval `radius` (world units)
   * across the middle, `wear` of it bare.
   */
  yard: z.object({ radius: positive, wear: fraction }),
  feel: splittingFeelSchema,
});

/** Feel numbers for fire-hardening. The debug menu can override them live. */
export const firemakingFeelSchema = z.object({
  /**
   * The fire: heat a log adds to the two staves over its own spot, and the little it spills onto
   * the nearest stave each side. Fires are generated with these, so a change applies from the
   * next fire.
   */
  heatPerLog: positive,
  spill: nonNegative,
  /**
   * Cooking: seconds a stave at the flat fire's heat takes to harden (hotter staves are quicker,
   * colder ones slower), and how far past that it chars, as a share of the time it took to harden:
   * 1.3 chars at 1.3 times it. So every stave's pull window is the same share of its cook, and a
   * hotter one's is shorter in seconds.
   */
  cookSeconds: positive,
  charRatio: z.number().gt(1),
  /** Smoke, as a share of the way to hardened: thin white wisps, then thicker. Thick grey is ready. */
  smokeWisps: fraction,
  smokeThick: fraction,
  /** The hot streak: how deep racks can stack (1 = no streak). */
  streakCap: positiveInt,
  /**
   * The pull: a touch within `grabPx` of the handle grabs it (forgiving), and the pull counts once
   * it has moved `dragPx`; the rack slides out over `pullSeconds`.
   */
  grabPx: positive,
  dragPx: positive,
  pullSeconds: positive,
  /** The payoff: spears plunged into the bucket (seconds), then a wait before they pour in. */
  plungeSeconds: positive,
  pourDelaySeconds: nonNegative,
  hitStopMs: nonNegative,
  shakeStrength: nonNegative,
  /** Vibration (ms): a log dropping onto a spot, laying the rack, the pull, the plunge. */
  buzzLogMs: nonNegative,
  buzzLayMs: nonNegative,
  buzzPullMs: nonNegative,
  buzzPlungeMs: nonNegative,
});

/**
 * Fire-hardening: a rack of staves over a trench of coals that never burns evenly. Drop logs into
 * the fuel spots under it to even out the heat, lay the rack, and pull it out when the points
 * smoke thick grey. Hardened staves become spears; underdone ones go back as staves; charred ones
 * are lost.
 */
const firemakingSchema = z.object({
  /** The recipe a hardened stave runs, and the item burned as fuel. */
  recipe: id,
  fuel: id,
  /** The rack: staves on it, fuel spots under it (each under the same number of staves), logs a spot holds. */
  rack: z.object({ staves: positiveInt, spots: positiveInt, maxLogs: positiveInt }),
  /** Stars count the staves that didn't harden: 3 for none, 2 for up to `twoMissed`, else 1. */
  stars: z.object({ twoMissed: z.number().int().min(0) }),
  /**
   * Fires, from a seed, built backwards from a flat fire at `flat` heat so one always has a full
   * answer: a random answer of `answerLogs` logs is taken off, plus `noise` (heat) of lumps, and no
   * coal under `minHeat`. A fire is made again (up to `tries` times) if it needs no fuel, if
   * filling every spot also hardens the whole rack, or if its answer's pull window is under
   * `minWindow` seconds.
   */
  generator: z.object({
    flat: positive,
    answerLogs: z.object({ min: positiveInt, max: positiveInt }),
    noise: nonNegative,
    minHeat: positive,
    minWindow: nonNegative,
    tries: positiveInt,
  }),
  /** Grass round the fire pit, trodden bare round the trench. */
  yard: z.object({ radius: positive, wear: fraction }),
  feel: firemakingFeelSchema,
});

export const gameDataShape = z.object({
  skills: z.array(skillSchema).min(1),
  items: z.array(itemSchema).min(1),
  stations: z.array(stationSchema),
  recipes: z.array(recipeSchema),
  units: z.array(unitSchema),
  enemies: z.array(enemySchema),
  levels: z.array(levelSchema),
  camp: campSchema,
  woodcutting: woodcuttingSchema,
  splitting: splittingSchema,
  firemaking: firemakingSchema,
  warchest: warchestSchema,
  tuning: tuningSchema,
});

export type GameDataInput = z.input<typeof gameDataShape>;
export type GameData = z.output<typeof gameDataShape>;
export type Skill = GameData['skills'][number];
export type Item = GameData['items'][number];
export type ItemStack = z.output<typeof itemStackSchema>;
export type Station = GameData['stations'][number];
export type Recipe = GameData['recipes'][number];
export type Unit = GameData['units'][number];
export type Enemy = GameData['enemies'][number];
export type Level = GameData['levels'][number];
export type Tuning = GameData['tuning'];
export type Camp = GameData['camp'];
export type CampSpot = Camp['chest'];
export type Clearing = GameData['woodcutting']['clearings'][number];
export type ClearingTree = Clearing['trees'][number];
export type WoodcuttingFeel = GameData['woodcutting']['feel'];
export type WoodcuttingScenery = GameData['woodcutting']['scenery'];
export type SceneryPlantKind = (typeof sceneryPlantKinds)[number];
export type Splitting = GameData['splitting'];
export type SplittingLog = Splitting['tutorialLog'];
export type SplittingFeel = Splitting['feel'];
export type Firemaking = GameData['firemaking'];
export type FiremakingFeel = Firemaking['feel'];
