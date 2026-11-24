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

export const qualitySchema = z.object({ id, name });

export const skillSchema = z.object({ id, name });

export const itemSchema = z.object({
  id,
  name,
  /** Tiered items are counted per quality tier (e.g. Poor/Good/Perfect spears). */
  tiered: z.boolean(),
});

export const itemStackSchema = z.object({
  item: id,
  count: positiveInt,
  /** Only for tiered items. A tiered recipe output without one gets its tier from the mini game. */
  quality: id.optional(),
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
  weapon: z.object({
    item: id,
    damageByQuality: z.record(id, nonNegative),
  }),
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
  /** Share of used weapons recovered after winning a run, per quality tier. */
  weaponRecoveryOnWin: z.record(id, fraction),
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

/** Feel numbers for riving. The debug menu can override them live. */
export const rivingFeelSchema = z.object({
  /** Degrees each ↺ ↻ tap turns the froe. */
  fineAimStep: positive,
  /** Seconds the mallet takes to come down on the froe, and the freeze when it lands (ms). */
  strikeSeconds: positive,
  hitStopMs: nonNegative,
  shakeStrength: nonNegative,
  /** Screen pixels of handle drag that run the crack all the way down the log. */
  leverTravel: positive,
  /**
   * The steady speed band, in log lengths per second the crack runs: faster than `bandHigh`
   * builds strain, slower than `bandLow` for `bindSeconds` and the crack binds (strike again).
   * Speed is averaged over `speedWindow` seconds so a jittery finger isn't punished.
   */
  bandLow: positive,
  bandHigh: positive,
  bindSeconds: positive,
  speedWindow: positive,
  /** Strain gained per second per log length a second over the band, lost per second within it;
   * at 1 the split runs out. A check on the line multiplies the gain by `checkEase`. */
  strainRise: positive,
  strainRecover: nonNegative,
  checkEase: fraction,
  /** Seconds the halves take to come apart after a split. */
  pieceSeconds: positive,
  /** Vibration (ms): the mallet strike, each tick of a straining crack, a clean split, a runout. */
  buzzStrikeMs: nonNegative,
  buzzCrackMs: nonNegative,
  buzzCleanMs: nonNegative,
  buzzRunoutMs: nonNegative,
});

/** A log to rive: its size, end grain, and the grains on its end face. */
const rivingLogSchema = z.object({
  id,
  /** Size in world units, for drawing it. */
  radius: positive,
  height: positive,
  rings: positiveInt,
  /** Natural cracks in the end grain, as angles (degrees) from the pith. */
  checks: z.array(z.number()),
  /** Grains: patches of the end face, each `width` degrees wide centred on `angle`. */
  grains: z.array(z.object({ kind: id, angle: z.number(), width: positive })),
});

/**
 * Riving a log into staves with a froe. Every split runs along a radius through the pith (the
 * first one across the whole log), halving a piece: `halvings` splits deep, a piece is a stave.
 * A split more than `centreTolerance` (share of the piece) off its middle loses the smaller side;
 * a runout wastes the short side. Grains multiply the whole log's staves (rot halves them, silver
 * and gold double and triple them) if they end up in a stave you keep, and a split line through a
 * grain cancels it, good or bad.
 */
const rivingSchema = z.object({
  /** The recipe a riven log runs: its yield is the staves it's worth. */
  recipe: id,
  halvings: positiveInt,
  centreTolerance: fraction,
  multiplierCap: positive,
  /** A split line within this many degrees of a check runs along it, and splits more easily. */
  checkTolerance: nonNegative,
  /**
   * The kinds of grain: what each multiplies the whole log's staves by when it ends up in a stave
   * you keep (they multiply together, up to `multiplierCap`), and how often each turns up.
   */
  grainKinds: z
    .array(
      z.object({
        id,
        name: z.string().min(1),
        multiplier: positive,
        weight: positive,
      }),
    )
    .min(1),
  /** The first log ever: no grains, to learn the controls on. */
  tutorialLog: rivingLogSchema,
  /** Random logs: sizes, rings, checks and grains, from a seed. */
  generator: z.object({
    radius: z.object({ min: positive, max: positive }),
    height: z.object({ min: positive, max: positive }),
    rings: z.object({ min: positiveInt, max: positiveInt }),
    checks: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
    grains: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
    grainWidth: z.object({ min: positive, max: positive }),
    /** Least gap (degrees) between two grains, so each reads on its own. */
    grainGap: nonNegative,
  }),
  feel: rivingFeelSchema,
});

export const gameDataShape = z.object({
  /** Ordered worst to best. */
  qualities: z.array(qualitySchema).min(1),
  skills: z.array(skillSchema).min(1),
  items: z.array(itemSchema).min(1),
  stations: z.array(stationSchema),
  recipes: z.array(recipeSchema),
  units: z.array(unitSchema),
  enemies: z.array(enemySchema),
  levels: z.array(levelSchema),
  camp: campSchema,
  woodcutting: woodcuttingSchema,
  riving: rivingSchema,
  warchest: warchestSchema,
  tuning: tuningSchema,
});

export type GameDataInput = z.input<typeof gameDataShape>;
export type GameData = z.output<typeof gameDataShape>;
export type Quality = GameData['qualities'][number];
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
export type Riving = GameData['riving'];
export type RivingLog = Riving['tutorialLog'];
export type RivingFeel = Riving['feel'];
