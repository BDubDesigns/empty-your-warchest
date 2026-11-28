import { z } from 'zod';
import { charactersSchema } from './characterSchema';
import { farmingSchema } from './farmingSchema';

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

/**
 * How an item looks as a piece flying into a warchest: a round log, a split stave, a pointed shaft
 * (a spear), a bottle, a green tuft (moss), a mushroom cap, a little grey heap (ash), a blue leaf
 * (woad), a striped sunflower seed, a dark woad seed pod, a puff of mushroom spores, a feather, a
 * fletched arrow and a bare one (a shaft with no feathers), a feather duster of an arrow (feathers
 * stuck on every which way), a plain round arrow shaft, and a handful of yellow petals.
 */
export const itemLooks = [
  'round',
  'split',
  'pointed',
  'bottle',
  'tuft',
  'cap',
  'heap',
  'leaf',
  'seed',
  'pod',
  'spores',
  'feather',
  'arrow',
  'shaft',
  'duster',
  'dowel',
  'petals',
] as const;

/** A colour as '#rrggbb'. */
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour');

export const itemSchema = z.object({ id, name, look: z.enum(itemLooks) });

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

/** What a new save starts with. */
export const newGameSchema = z.object({
  /** In the warchest from the start (e.g. a brewing kit, so the cauldron can be tried at once). */
  inventory: z.array(itemStackSchema),
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

/**
 * Enemies fight with a unit's numbers (decided Nov 24, keep it simple): an unarmed bandit is an
 * unarmed recruit, an armed one fights like that unit with its spear.
 */
export const enemySchema = z.object({ id, name, unit: id });

const gateOp = z.enum(['add', 'subtract', 'multiply', 'divide']);

/**
 * A number rolled for each run (decided Nov 25: random maps, scaled by Command level): a whole
 * number from `min` to `min + perLevel × (level − 1)`, rounded down. A plain number is fixed.
 * Brandon's "between 1 and your Command level" is `{ min: 1, perLevel: 1 }`.
 */
const rollSchema = z.union([positiveInt, z.object({ min: positiveInt, perLevel: nonNegative })]);

const gateSchema = z.object({
  op: gateOp,
  value: rollSchema,
  /**
   * A guarded gate: enemies stand in front of it in its lane, and a squad on that side has to
   * fight through them to reach it (decided Nov 24: a blue gate behind enemies reads as "fight for
   * it"; it replaced the red flip gate, which read as "bad thing, guarded").
   */
  guards: z
    .object({
      enemy: id,
      count: rollSchema,
      /** Share of them carrying spears (rounded); the armed lead and fall first. */
      armedShare: fraction,
    })
    .optional(),
});

/** `at` is how far along the track the event happens, from 0 (start) to 1 (end). */
const levelEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('gates'),
    at: fraction,
    left: gateSchema,
    right: gateSchema,
    /** Swap the two sides at random each run, so the greedy side isn't always the same. */
    shuffle: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('enemies'),
    at: fraction,
    enemy: id,
    count: rollSchema,
    /** Share of them carrying spears (rounded); the armed lead and fall first. */
    armedShare: fraction,
    /** A group in one lane only blocks a squad on that side; `both` blocks the whole track. */
    lane: z.enum(['both', 'left', 'right']).default('both'),
  }),
  z.object({
    type: z.literal('wall'),
    at: fraction,
    hp: rollSchema,
    /** Archers on the walkway: every `volleySeconds` a volley drops `perVolley` units. */
    archers: z.object({ volleySeconds: positive, perVolley: positiveInt }),
  }),
]);

export const levelSchema = z.object({
  id,
  name,
  kind: z.enum(['skirmish']),
  durationSeconds: positive,
  /** The unit every recruit becomes. */
  unit: id,
  /** Decided Nov 25: always 1, so every run shows the growth from one guy to an army. */
  startingRecruits: positiveInt,
  /** A template: its rolls are made fresh for each run from the run's seed and Command level. */
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
  /** Share of used weapons recovered after winning a run. */
  weaponRecoveryOnWin: fraction,
  /** Opening the stations' own (3D) screens. */
  screens: z.object({
    /**
     * At the camp, each station screen's code and models load in the background when the
     * browser is idle; this is the longest wait for an idle moment before loading the next one
     * anyway (ms). Without idle callbacks (Safari) each one waits this long.
     */
    preloadIdleTimeoutMs: positive,
    /** How long a station may take to open before the loading card shows (ms). */
    loadingCardDelayMs: nonNegative,
  }),
  /**
   * The debug menu's sliders on a touch screen. A touch that starts on one does nothing until it
   * has moved `slopPx` (CSS px); then it drags the slider only if it went more than `sideways`
   * times as far across as up or down, and otherwise it's left to scroll the menu.
   */
  debugSliders: z.object({ slopPx: positive, sideways: positive }),
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
  /**
   * Fell the rest (only looks: the rules bank it at once). Seconds between one tree starting to
   * topple and the next, at most `fellRestSpread` seconds from the first to the last however many
   * are standing, and seconds each tree takes to fall.
   */
  fellRestGap: nonNegative,
  fellRestSpread: nonNegative,
  fellRestFallSeconds: positive,
});

/** A min–max range. */
const rangeSchema = z.object({ min: nonNegative, max: nonNegative });
/** A whole-number min–max range, at least 1. */
const countRange = z.object({ min: positiveInt, max: positiveInt });

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
  /**
   * Fell the rest: once a round has `minStars` stars, every tree still standing can be knocked
   * down at once as singles, `logsPerTree` logs each (no chain, cabin or boulder), and the round
   * ends. Each tree falls a seeded way: up to `angleTries` directions are tried for one that
   * touches nothing (the cabin, a boulder, a mushroom patch). How it looks is in the feel.
   */
  fellRest: z.object({
    minStars: z.number().int().min(1).max(3),
    logsPerTree: positiveInt,
    angleTries: positiveInt,
  }),
  /**
   * Ingredients to forage, set when a round's trees are seeded so each one's drop is fixed and
   * shows from the start. Mossy trees (moss on the trunk) and mushroom trees (mushrooms at the
   * foot) drop theirs when felled; mossy boulders shed theirs the first time they're hit, and are
   * plain boulders from then on. Mushroom patches on the ground pay `yield` once a round, when a
   * falling tree lands on one or a rolling boulder runs over it, and sit `gap` clear of every
   * trunk, boulder and the cabin, `margin` in from the fence. Drops bank with the chain's logs.
   */
  forage: z.object({
    mossyTrees: z.object({ share: fraction, item: id, count: countRange }),
    mushroomTrees: z.object({ share: fraction, item: id, count: countRange }),
    mossyBoulders: z.object({ share: fraction, item: id, count: countRange }),
    patches: z.object({
      count: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
      item: id,
      yield: positiveInt,
      radius: positive,
      gap: nonNegative,
      margin: nonNegative,
      tries: positiveInt,
    }),
  }),
  scenery: woodcuttingScenerySchema,
  feel: woodcuttingFeelSchema,
});

/**
 * The Attack Run's feel: every number here is a debug slider. Distances are metres along the
 * track; times are seconds.
 */
const runnerFeelSchema = z.object({
  /** Forward speed while nothing blocks the squad (m/s). */
  runSpeed: positive,
  /** Fastest the squad can slide sideways (m/s). */
  steerSpeed: positive,
  /** How long the squad takes to catch up with the finger (s, time constant). */
  steerSmoothing: nonNegative,
  /** Sideways squad travel for a finger slide across the whole screen, in track widths. */
  dragScale: positive,
  /** How loose the crowd blob is: its radius is this × √count (m). */
  crowdSpread: positive,
  /** How far edge units trail the centre on turns (0 = rigid). */
  edgeLag: nonNegative,
  /**
   * Seconds between the first blows of a clash. The front soldier and the front enemy swap blows
   * until one falls; the next steps up.
   */
  tradeSeconds: positive,
  /** Each blow's gap is this share of the last, so big fights don't drag. */
  tradeSpeedup: z.number().positive().max(1),
  /** Fastest the blows get (s). */
  tradeMinSeconds: positive,
  /** Wall damage per second for each point of a unit's damage; the whole squad hits at once. */
  wallAttackRate: nonNegative,
  /** Gate labels and the result preview show this many seconds ahead. */
  gateReadSeconds: positive,
  /** Camera tilt down from level (degrees). */
  cameraAngle: z.number().min(5).max(85),
  /** Camera distance from the squad (m). */
  cameraDistance: positive,
  /** How far ahead of the squad the camera aims (m): more puts the squad lower on screen. */
  cameraLookAhead: nonNegative,
  /** Extra camera distance per metre of crowd radius, so big crowds fit. */
  cameraPullback: nonNegative,
  /** Spears in the run when Debug → Options → Runner spears is set to the slider. */
  spears: z.number().int().nonnegative(),
  /** Time runs at this speed for `slowMoSeconds` when the wall breaks. */
  slowMoScale: z.number().positive().max(1),
  /**
   * With the "Slow down" lift option, time runs at this speed while no finger is on the screen
   * (decided Nov 25: time to think without stalling a re-grip). Fights and the wall ignore it.
   */
  liftSlowMoScale: z.number().positive().max(1),
  slowMoSeconds: nonNegative,
  /** Vibration pulses (ms). */
  buzzGoodGateMs: nonNegative,
  buzzBadGateMs: nonNegative,
  buzzTradeMs: nonNegative,
  buzzWallHitMs: nonNegative,
  buzzVolleyMs: nonNegative,
  buzzWallBreakMs: nonNegative,
  buzzLoseMs: nonNegative,
});

export const runnerSchema = z.object({
  /** The skirmish the War tent plays (M7a has one). */
  level: id,
  /** Track width (m); a gate pair splits it into halves. */
  trackWidth: positive,
  /**
   * The track's length is the level's `durationSeconds` × this, so `durationSeconds` is the run time
   * at this speed. The run-speed slider changes how fast you run it, not how long it is.
   */
  trackMetersPerSecond: positive,
  /** How far in front of a guarded gate its guards stand (m). */
  guardGap: positive,
  /** Room to the side of the track the squad's centre can't enter (m). */
  edgeMargin: nonNegative,
  feel: runnerFeelSchema,
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
   * While the heap's out, the camera eases back this much further (world units) over
   * `heapCameraSeconds`, so the whole heap shows, and back in over the same for the next log.
   */
  heapCameraBack: nonNegative,
  heapCameraSeconds: positive,
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
  /**
   * Smoke off the points, as a share of the way to hardened: thin white wisps from `smokeWisps`,
   * thicker from `smokeThick`; thick grey once hardened (pull now), black once charring.
   */
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
  /** The payoff: spears plunged into the trough (seconds), then a wait before they pour in. */
  plungeSeconds: positive,
  pourDelaySeconds: nonNegative,
  hitStopMs: nonNegative,
  shakeStrength: nonNegative,
  /**
   * Vibration (ms): a log dropping onto a spot, laying the rack, the first point starting to char
   * (you're late), the pull, the plunge. Nothing buzzes when it's ready: reading the smoke is the
   * skill.
   */
  buzzLogMs: nonNegative,
  buzzLayMs: nonNegative,
  buzzCharMs: nonNegative,
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
  /**
   * The rack: staves over each fuel spot, and its sizes by Firemaking level (each a number of fuel
   * spots, opening at a level, the logs a spot holds, and how many logs a fire of that size takes
   * to even out). The biggest open size is the default; any smaller open one can be picked.
   */
  rack: z.object({
    stavesPerSpot: positiveInt,
    sizes: z
      .array(
        z.object({
          spots: positiveInt,
          level: positiveInt,
          logsPerSpot: positiveInt,
          answerLogs: z.object({ min: positiveInt, max: positiveInt }),
        }),
      )
      .min(1),
  }),
  /**
   * Stars count the staves (in a layer) that didn't harden: 3 for none, 2 for up to
   * `twoMissedShare` of the layer, else 1.
   */
  stars: z.object({ twoMissedShare: fraction }),
  /**
   * Bonus spears for 2 and 3 stars, as a share of the spears hardened (rounded), as at every
   * station: stars multiply output. XP is paid on the spears hardened, not the bonus.
   */
  starBonus: z.object({ two: nonNegative, three: nonNegative }),
  /**
   * Fires, from a seed, built backwards from a flat fire at `flat` heat so one always has a full
   * answer: a random answer of the rack size's `answerLogs` logs is taken off, plus `noise` (heat)
   * of lumps, and no coal under `minHeat`. A fire is made again (up to `tries` times) if it needs
   * no fuel, if filling every spot also hardens the whole rack, or if its answer's pull window is
   * under `minWindow` seconds. Racks of up to `searchSpots` spots also log every full-rack answer
   * (the search grows threefold a spot).
   */
  generator: z.object({
    flat: positive,
    noise: nonNegative,
    minHeat: positive,
    minWindow: nonNegative,
    tries: positiveInt,
    searchSpots: positiveInt,
  }),
  /**
   * Ash, banked with each rack: `perCharred` for every charred stave (instead of losing it), and
   * `perLog` for every fuel log burned (rounded over the rack).
   */
  ash: z.object({ item: id, perCharred: z.number().int().min(0), perLog: nonNegative }),
  /** Grass round the fire pit, trodden bare round the trench. */
  yard: z.object({ radius: positive, wear: fraction }),
  feel: firemakingFeelSchema,
});

/** Feel numbers for brewing. The debug menu can override them live. */
export const brewingFeelSchema = z.object({
  /**
   * Stirring: the share of every unstirred drop that blends in each full turn of the spoon, and
   * the most turns a second that count (stirring faster just splashes).
   */
  stirPerTurn: z.number().positive().max(1),
  maxTurnsPerSecond: positive,
  /** How far the drag has to sweep round the pot's middle before it counts as stirring (px). */
  stirDeadPx: nonNegative,
  /** Seconds a drop takes to fall from the shelf into the pot. */
  dropSeconds: positive,
  /** How fast unstirred swirls drift round on their own (turns a second). */
  swirlDrift: nonNegative,
  /** The map shows which star ring the pot is in once no more than this share is unstirred. */
  revealUnmixed: fraction,
  /** How wide an unstirred drop's blur is on the colour map (px, at full strength). */
  cloudPx: nonNegative,
  /**
   * Dragging an ingredient off the shelf: how far the finger moves before it lifts (less is a
   * tap, which does nothing), how long a miss takes to snap back to its tile (s), and how far past
   * the cauldron on screen still counts as dropping it in (px).
   */
  dragStartPx: nonNegative,
  snapBackSeconds: positive,
  dropPadPx: nonNegative,
  /** Vibration (ms): a drop going in, each quarter turn of stirring, bottling. */
  buzzDropMs: nonNegative,
  buzzStirMs: nonNegative,
  buzzBottleMs: nonNegative,
});

const brewReward = z.object({ potions: positiveInt, refunds: z.number().int().min(0) });

/**
 * Brewing at the cauldron: tap ingredients off the shelf into the pot, stir to see the true
 * colour, and bottle it when it matches the recipe card's target. Each drop adds its colour
 * weighted by its strength (mixed in OKLab, see src/stations/brewing/logic/color.ts). Water
 * lightens and ash darkens and dulls, both using fill; nothing comes back out but the ladle, which
 * scoops some of everything out (lost) to free fill.
 */
const brewingSchema = z.object({
  /** The most drops the pot holds, water included. */
  maxFill: positiveInt,
  /**
   * On the shelf: each ingredient item, its colour in the pot, and how much a drop counts. `tint`
   * names the way it pulls a colour ("red"), for saying which way a brew is off ("a touch too
   * red"); one without a tint is never named that way (water, which only lightens).
   */
  ingredients: z
    .array(z.object({ item: id, color: hexColor, strength: positive, tint: name.optional() }))
    .min(1),
  /** Water is free and never runs out (a tool, not an item). */
  water: z.object({ name, color: hexColor, strength: positive }),
  /**
   * Potions to brew: the recipe bottling runs (its outputs, once per potion, and its XP per brew),
   * and the potion's region of colour (OKLCh: lightness 0–1, chroma, hue in degrees; a hue range
   * may run past 360 to wrap). Each brew's target is picked anywhere in it (seeded), so it can't
   * be learned by heart. Every target in it must have a 3-star answer within the fill (checked at
   * startup), and no two potions' regions may overlap.
   */
  potions: z
    .array(
      z.object({
        recipe: id,
        region: z.object({
          L: rangeSchema,
          chroma: rangeSchema,
          hue: z.object({ min: z.number().min(0).max(360), max: z.number().min(0).max(720) }),
        }),
      }),
    )
    .min(1),
  /** Stars from the OKLab distance to the target: at most `three` for 3, and so on. Past `one` the brew spoils. */
  stars: z.object({ three: positive, two: positive, one: positive }),
  /** What each star count bottles: potions, and ingredients given back (picked from those put in). */
  rewards: z.object({ one: brewReward, two: brewReward, three: brewReward }),
  /**
   * The ladle: each use scoops `scoop` drops' worth out, evenly from everything in the pot (so its
   * colour stays), but never more than `most` of the pot (so something's left). `uses` a brew.
   */
  ladle: z.object({
    scoop: positive,
    most: z.number().positive().lt(1),
    uses: z.number().int().min(0),
  }),
  /** The colour map: OKLab a and b round every shelf colour, `margin` past the outermost. */
  map: z.object({ margin: nonNegative }),
  /**
   * Saying which way a brew is off (OKLab distances). Lightness or colour (hue and chroma) off by
   * no more than `spotOn` is spot on, and past `much` it's "much too light" or "too red" rather
   * than "a shade" or "a touch". The map badges a pot short of 3 stars "too light" or "too dark"
   * when lightness is at least `lightShare` of the error (squared, as distances add) and isn't
   * spot on.
   */
  advice: z.object({ spotOn: positive, much: positive, lightShare: fraction }),
  /**
   * The shelf's icons: drawn `px` square, with a sticker outline round the item's shape, `outline`
   * px of black and then `halo` px of white (in the picture's pixels), so it reads on any tile.
   */
  icons: z.object({ px: positiveInt, outline: nonNegative, halo: nonNegative }),
  /** Grass round the cauldron, trodden bare round its fire. */
  yard: z.object({ radius: positive, wear: fraction }),
  feel: brewingFeelSchema,
});

/** What the castle's parts are made of, as bodies. `kind` is how a part sounds as it's hit. */
const siegeMaterialSchema = z.object({
  id,
  kind: z.enum(['stone', 'wood']),
  /** kg per cubic metre. */
  density: positive,
  friction: nonNegative,
  /** Bounce, from 0 (none) to 1. */
  restitution: fraction,
});

/** A kind of castle part as a body: what it's made of and its hit points. */
const siegePartSchema = z.object({ material: id, hp: positive });

/**
 * What a siege asks for (each checked by one small rule): bring down the captain at one of the
 * keep's windows; break the spear rack; or bring down `kill` of the `guards` standing at `posts`
 * (guard paths and lookouts of the castle's anchors, named `name` on screen), each guard walking
 * his own stretch of a path about `slot` m long (or standing at a lookout). Later missions add
 * kinds here.
 */
export const siegeObjectiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('captain') }),
  z.object({ kind: z.literal('rack') }),
  z.object({
    kind: z.literal('guards'),
    name,
    guards: positiveInt,
    kill: positiveInt,
    posts: z.array(id).min(1),
    slot: positive,
  }),
]);

/**
 * A weapon: what shoots the spears. An aimed volley is `aimed.start` spears, `aimed.add` more
 * every `aimed.everyLevels` levels of `skill`; a barrage is `barrageTimes` as many. Every spear
 * leaves at `speed` m/s (one speed: there's no power to set), tilted from `tilt.min` to `tilt.max`
 * degrees. It turns and tilts about a pivot `pivotHeight` up from where it stands; spears leave
 * from its muzzle, `muzzle` along the bolt from the pivot, side by side `spacing` apart. The
 * ballista shoots flat and fast; arc weapons (a catapult, a trebuchet) come later.
 */
const siegeWeaponSchema = z.object({
  id,
  name,
  skill: id,
  aimed: z.object({ start: positiveInt, everyLevels: positiveInt, add: z.number().int().min(0) }),
  barrageTimes: z.number().int().min(2),
  speed: positive,
  tilt: z.object({ min: z.number().min(-80), max: z.number().max(80) }),
  pivotHeight: positive,
  muzzle: positive,
  spacing: nonNegative,
});

/** Feel numbers for the siege. The debug menu can override them live. */
export const siegeFeelSchema = z.object({
  /**
   * Aiming: the camera stays at the vantage point, the crosshair in the middle of the view, and a
   * drag turns the view (within the vantage point's `yaw` and `pitch`): what's under the finger
   * moves `aimPerPx` pixels for every pixel dragged (1: the view follows the finger). Fire aims
   * the shot at whatever is under the crosshair (or `aimFallback` metres out, if nothing is),
   * allowing for the drop: an aimed shot lands its middle spear right there.
   */
  aimPerPx: positive,
  aimFallback: positive,
  /**
   * The sight on screen: a ring `reticleSize` pixels across with ticks in to the middle (a
   * barrage's ring is as wide as its spread, if wider).
   */
  reticleSize: positive,
  /**
   * The two volleys. Aimed: tight (each spear strays up to `aimedSpread` degrees sideways,
   * `aimedTiltSpread` up or down, and `aimedSpeedStray` of its speed, at random). Barrage: three
   * times the spears, in waves `barrageStagger` seconds apart, strewn far wider. Within a wave the
   * spears leave `lineStagger` seconds apart, so it ripples.
   */
  aimedSpread: nonNegative,
  aimedTiltSpread: nonNegative,
  aimedSpeedStray: fraction,
  barrageSpread: nonNegative,
  barrageTiltSpread: nonNegative,
  barrageSpeedStray: fraction,
  barrageStagger: nonNegative,
  lineStagger: nonNegative,
  /**
   * After a shot, a solid line `ghostWidth` thick (at least `ghostPx` pixels on screen) along the
   * middle spear's real path, until the next shot (it can be turned off): learning the drop is
   * the skill.
   */
  ghostWidth: positive,
  ghostPx: positive,
  /** The spear's mass (kg): how hard it hits. */
  spearMass: positive,
  /** Seconds after a shot before the next, unless all its spears have already hit something. */
  reloadSeconds: nonNegative,
  /**
   * The kick of a shot: the view jolts back `kickBack` metres and up `kickTilt` degrees, and
   * settles over `kickSeconds`.
   */
  kickBack: nonNegative,
  kickTilt: nonNegative,
  kickSeconds: positive,
  /** A Sense potion shows every guard's outline in red through walls for `senseSeconds`. */
  senseSeconds: positive,
  /** The gold mark over each objective's targets, `markSize` metres tall. */
  markSize: positive,
  /**
   * The follow shot: after Fire the camera rides behind the shot's lead spear (`followBack` m
   * behind it, `followRise` above), getting there in `followInSeconds`, with time running at
   * `followSlowMo` while it flies; it holds `followHoldSeconds` (real seconds) on what the spear
   * hit, then eases back to the vantage point in `followReturnSeconds`. A kill or a collapse look
   * takes over from where it is (the camera goes back once that's done). A tap, a drag or the next
   * shot skips it.
   */
  followBack: positive,
  followRise: nonNegative,
  followInSeconds: positive,
  followSlowMo: z.number().min(0.05).max(1),
  followHoldSeconds: nonNegative,
  followReturnSeconds: positive,
  /**
   * The kill look: when a shot brings a guard down (the first of the shot), or a big collapse
   * (`collapseParts` parts breaking within `collapseWindowSeconds`), time freezes for
   * `killCamStopMs`, then runs at `killCamSlowMo` while the camera, still where it stands, turns
   * to it and zooms in to `killCamZoom` of its field of view, for `killCamSeconds` (real
   * seconds), easing there in `killCamInSeconds` and back in `killCamOutSeconds`. A tap skips it,
   * and so does the next shot. `buzzKillMs` is its buzz.
   */
  killCamSeconds: nonNegative,
  killCamSlowMo: z.number().min(0.05).max(1),
  killCamStopMs: nonNegative,
  killCamZoom: z.number().min(0.2).max(1),
  killCamInSeconds: positive,
  killCamOutSeconds: positive,
  collapseParts: positiveInt,
  collapseWindowSeconds: positive,
  buzzKillMs: nonNegative,
  /** A spear hitting: the freeze (ms), and from `heavyHitSpeed` m/s a longer one (and on breaks). */
  hitStopMs: nonNegative,
  heavyHitStopMs: nonNegative,
  heavyHitSpeed: positive,
  /** Multiplier for every screen shake. 0 turns shake off. */
  shakeStrength: nonNegative,
  /**
   * A part slamming into something: dust and a thud from this sudden a change of speed (m/s), at
   * most one a part every `thudGapSeconds`, so a chunk rattling to a stop isn't a drum roll.
   */
  thudSpeed: positive,
  thudGapSeconds: nonNegative,
  /** Dust puffs for a thud at `thudSpeed`; harder thuds puff more. */
  dust: nonNegative,
  /** As the last objective falls, time runs at `slowMo` for `slowMoSeconds` (real seconds). */
  slowMo: z.number().min(0.05).max(1),
  slowMoSeconds: nonNegative,
  /**
   * Vibration (ms): an aimed shot, a barrage, a spear hitting, a part's thud, a part breaking, a
   * guard going down, an objective done, every objective done.
   */
  buzzThrowMs: nonNegative,
  buzzBarrageMs: nonNegative,
  buzzHitMs: nonNegative,
  buzzThudMs: nonNegative,
  buzzBreakMs: nonNegative,
  buzzGuardMs: nonNegative,
  buzzObjectiveMs: nonNegative,
  buzzWinMs: nonNegative,
});

/** A model skinning a rules' box (see `skins`). */
const skinSchema = z.object({
  model: z.string().regex(/^models\/.+\.(glb|gltf)$/, 'A model under models/, .glb or .gltf'),
  fit: z.enum(['box', 'height']),
  turn: z.number(),
  node: z.string().optional(),
});

/** The characters' clips a guard (or the captain) plays (see `skins`). */
const guardClipsSchema = z.object({ stand: id, patrol: id, hit: id, down: id });

/**
 * The siege's looks on one graphics tier. `shadows`: the sun's real-time shadow map, or a blob
 * under each guard and loose part (it must match the castle's tier). A broken part bursts into
 * `debrisPieces` chunks that fly `debrisSeconds`, with at most `maxDebris` alive at once; dust
 * puffs are `dustShare` of the feel's `dust`, at most `maxPuffs` at once. Debris and dust are only
 * looks: the rules never see them.
 */
const siegeTierLookSchema = z.object({
  shadows: z.enum(['map', 'blob']),
  debrisPieces: z.number().int().nonnegative(),
  maxDebris: z.number().int().nonnegative(),
  debrisSeconds: positive,
  dustShare: fraction,
  maxPuffs: z.number().int().nonnegative(),
});

/**
 * The siege at the War tent, fought at the castle (`castle`): shoot the warchest's spears from its
 * vantage points at the round's objectives. The physics world (Rapier) is the rules, stepped at a
 * fixed rate and seeded, so the same shots always give the same result.
 */
const siegeSchema = z.object({
  /** The warchest item shot. */
  item: id,
  /** The item a Sense potion is: drunk, every guard shows through walls for a while. */
  potion: id,
  /** The weapons, and the one the siege uses (more, arc weapons, come later as unlocks). */
  weapons: z.array(siegeWeaponSchema).min(1),
  weapon: id,
  /**
   * Where the weapon stands at a vantage point: `ahead` m in front of the camera (along the
   * ground, toward what it looks at), its pivot `below` m under the camera.
   */
  mount: z.object({ ahead: nonNegative, below: nonNegative }),
  /**
   * The guards: each a box `size` (width, height, depth) of `density` kg per cubic metre and
   * `friction`, with `hp` hit points, hurt by spears. A guard is down at 0 hit points, once
   * knocked over past `downTilt` degrees, once what he stands on gives way, or once a falling part
   * hits him; one still standing is pushed over (his head sent back at `topple` m/s).
   */
  guard: z.object({
    size: z.tuple([positive, positive, positive]),
    density: positive,
    friction: nonNegative,
    hp: positive,
    downTilt: z.number().positive().max(90),
    topple: nonNegative,
  }),
  /**
   * The captain: a guard `scale` times as big, with `hp` hit points, standing in one of the keep's
   * captain windows with his middle `inset` m inside its face. Only what shows of him is hit: his
   * box starts `sill` m above his floor (the window's sill). If his window is in a storey that
   * comes apart, he goes down with the chunk he stands in.
   */
  captain: z.object({
    scale: positive,
    hp: positive,
    sill: nonNegative,
    inset: z.number(),
  }),
  materials: z.array(siegeMaterialSchema).min(1),
  /**
   * The castle's parts as bodies, by kind: what each is made of and its hit points (the spear
   * rack among them).
   */
  parts: z.object({
    wallChunk: siegePartSchema,
    battlement: siegePartSchema,
    towerChunk: siegePartSchema,
    gatehouseChunk: siegePartSchema,
    storeyChunk: siegePartSchema,
    merlon: siegePartSchema,
    gate: siegePartSchema,
    towerRoof: siegePartSchema,
    roof: siegePartSchema,
    bell: siegePartSchema,
    rack: siegePartSchema,
  }),
  /**
   * The castle's bodies: every part's body is `gap` m short of it on each side (so loose chunks
   * slide past their neighbours, never jam), the keep's `keepInset` m inside its walls (so the
   * captain stands in its windows), and what the castle's data marks solid (and the keep's lower
   * storeys, and the props) is made of `solid`, and never breaks. A round tower's row stays up
   * while at least `towerHold` of the wedges in the row under it still stand where they were
   * built: with fewer, everything above comes down.
   */
  bodies: z.object({
    gap: nonNegative,
    keepInset: nonNegative,
    solid: id,
    towerHold: positiveInt,
  }),
  /** Each round has `count` objectives, picked at random from `pool` (and placed at random). */
  objectives: z.object({ count: positiveInt, pool: z.array(siegeObjectiveSchema).min(1) }),
  /** A guard walks his stretch at `patrolSpeed` m/s, pausing `patrolPause` s at each end. */
  guardMoves: z.object({ patrolSpeed: positive, patrolPause: nonNegative }),
  /**
   * How the siege's things look: a model over a rules' box, only a skin (the physics stays the
   * box). `fit: box` stretches it to the box on every axis; `height` scales it evenly to the box's
   * height. `turn` turns it about the up axis first (degrees). `node` picks one part of the model by
   * name (the ballista's bolt, for the spear). The guards wear the characters' guard looks (one
   * each, picked from the round's seed: only a look), the captain his `character`; each is drawn
   * so the characters' body is `fill` of its box's height, and plays the characters' `clips`:
   * standing, patrolling, hit and still standing, and down.
   */
  skins: z.object({
    bolt: skinSchema,
    guard: z.object({ fill: z.number().positive().max(1), clips: guardClipsSchema }),
    captain: z.object({ character: id, clips: guardClipsSchema }),
  }),
  /**
   * How the siege draws on each graphics tier (see `graphics`). Only looks: the rules (parts,
   * guards, spears, hits) are the same on both.
   */
  looks: z.object({
    /**
     * Blob shadows, the cheap kind: a soft dark patch on the ground under each guard and loose
     * part, `spread` times its footprint, `opacity` dark, raised `lift` m off the ground. It
     * shrinks away as its thing rises, gone `fadeHeight` m up.
     */
    blobShadows: z.object({
      opacity: fraction,
      spread: positive,
      lift: positive,
      fadeHeight: positive,
    }),
    /**
     * A live objective's targets (the captain, the spear rack, the battlement's guards): each
     * glows `color` (`glow` of it, swelling and fading by `pulse` of that every `pulseSeconds`)
     * and has a mark in that colour over it; the guards and the captain glow only `figureGlow` of
     * that, so their outfits still show under it. Done, they lose both.
     */
    objective: z.object({
      color: hexColor,
      glow: fraction,
      pulse: fraction,
      pulseSeconds: positive,
      figureGlow: fraction,
    }),
    tiers: z.object({ high: siegeTierLookSchema, low: siegeTierLookSchema }),
  }),
  physics: z.object({
    /** Seconds per physics step, whatever the frame rate. */
    timestep: positive,
    gravity: positive,
    solverIterations: positiveInt,
    /** Steps at most per frame, so a slow frame can't snowball (the game slows instead). */
    maxStepsPerFrame: positiveInt,
    /** The field: its friction, and how far it reaches each way from the castle (metres). */
    groundFriction: nonNegative,
    groundReach: positive,
  }),
  /**
   * The spear as a body: a capsule `length` long (tip to tip) and `radius` thick. It flies nose
   * first, with continuous collision detection, until it first touches something; from then on
   * it tumbles as it will.
   */
  projectile: z.object({
    length: positive,
    radius: positive,
    friction: nonNegative,
    restitution: fraction,
    /**
     * Damping once it's down (linear, and turning): a round spear would otherwise roll across
     * the field for ever, and the round never settle.
     */
    landedDamping: nonNegative,
    landedSpinDamping: nonNegative,
    /**
     * The share of its speed a spear keeps after it first hits something: it's spent, so a
     * glancing one can't fly on across the castle and hit something it was never aimed at.
     */
    afterHit: fraction,
    /** What's left of its speed once it's hit a standing guard (who can't be knocked back). */
    inGuard: fraction,
  }),
  /**
   * A body is still once it moves slower than `speed` (m/s) and turns slower than `spin` (radians
   * a second). Everything has settled once all are still for `seconds`; after the last objective
   * the card waits for that, or `winSeconds` at most. A spear still for `spearSeconds` after it's
   * hit something stops being a body (it lies where it is, or stays stuck in the part it's in); a
   * loose part still for `partSeconds` is fixed where it lies, until something it rests on goes or
   * something knocks it.
   */
  settle: z.object({
    speed: positive,
    spin: positive,
    seconds: positive,
    winSeconds: positive,
    spearSeconds: positive,
    partSeconds: positive,
  }),
  /** A part counts as knocked down once it has dropped `drop` metres or tipped `tilt` degrees. */
  down: z.object({ drop: positive, tilt: z.number().positive().max(90) }),
  /**
   * Damage. A spear hitting a part or a guard deals `spearPerSpeed` for every m/s it hits at over
   * `spearMinSpeed` (so a glancing tap does nothing). A loose part whose speed changes suddenly
   * (it slams into the ground or another) takes `crashPerSpeed` for every m/s of that change over
   * `crashMinSpeed`, and a loose part slamming into a fixed one at `knockSpeed` m/s or more deals
   * it as much and knocks it loose. At 0 hit points a part breaks: it's gone, and whatever rested
   * on it comes loose.
   */
  damage: z.object({
    spearMinSpeed: nonNegative,
    spearPerSpeed: nonNegative,
    crashMinSpeed: positive,
    crashPerSpeed: nonNegative,
    knockSpeed: positive,
  }),
  /**
   * The throws a good player takes (a throw is one shot, aimed or barrage alike). Stars: 3 for
   * every objective in `par` throws or fewer, 2 for every objective, 1 for some. (Par stands in
   * for "no alarm bell" until the bell arrives.)
   */
  par: positiveInt,
  /** Bonus XP and recovered spears for 2 and 3 stars, as a share of each, as at every station. */
  starBonus: z.object({ two: nonNegative, three: nonNegative }),
  /**
   * Command XP for each part broken or knocked down, each guard brought down, each objective
   * done, and every objective (before stars).
   */
  rewards: z.object({
    xpPerPart: nonNegative,
    xpPerGuard: nonNegative,
    xpPerObjective: nonNegative,
    winXp: nonNegative,
  }),
  feel: siegeFeelSchema,
});

/** Feel numbers for the bird hunt. The debug menu can override them live. */
export const archeryFeelSchema = z.object({
  /**
   * The flight, fixed when a round starts (so sliders apply from the next round): gravity on the
   * arrows (field units a second, every second), every arrow kind's speed and every bird's speed
   * multiplied by `arrowSpeed` and `birdSpeed`, and every bird's hit radius by `hitRadius`. An
   * arrow that grazes a bird, passing within `graze` field units outside its hit radius (about a
   * bird's width), scares it.
   */
  gravity: positive,
  arrowSpeed: positive,
  birdSpeed: positive,
  hitRadius: positive,
  graze: positive,
  /**
   * The draw: dragging back `fullDrawPx` (CSS px) is a full draw, the bow's full power; less is
   * that share of it. A release under `minDraw` of a full draw lets the string down: no shot.
   */
  fullDrawPx: positive,
  minDraw: fraction,
  /** The aim preview: how much of the arrow's path shows while drawing, in seconds of flight. */
  previewSeconds: nonNegative,
  /** On a hit: the freeze (ms) and how hard the screen shakes. */
  hitStopMs: nonNegative,
  shakeStrength: nonNegative,
  /**
   * Vibration (ms): a tick as the draw passes each quarter, the release, a hit, and a scared
   * bird's poop.
   */
  buzzDrawMs: nonNegative,
  buzzReleaseMs: nonNegative,
  buzzHitMs: nonNegative,
  buzzPoopMs: nonNegative,
  /**
   * The release, only looks: the string snaps `snapOvershoot` of a full draw past rest and rings
   * out over `snapSeconds`; the view kicks up `kickDegrees` and settles over `kickSeconds`; a
   * streak `trailWidth` field units wide follows each arrow, as long as the last `trailSeconds` of
   * its flight (0 for none); and a whoosh at `whooshVolume` (0 for none).
   */
  snapOvershoot: nonNegative,
  snapSeconds: positive,
  kickDegrees: nonNegative,
  kickSeconds: positive,
  trailSeconds: nonNegative,
  trailWidth: nonNegative,
  whooshVolume: z.number().min(0).max(1),
});

/** The shapes of the code-built birds: a plump finch, a crested jay, a long crow. */
export const birdShapes = ['finch', 'jay', 'crow'] as const;

/** How a bird's height changes as it crosses: a bob up and down, or swooping dives. */
export const birdPaths = ['straight', 'swoop'] as const;

/** How the hunting stand draws on a graphics tier (only looks: the rules are the same on both). */
const archeryTierLookSchema = z.object({
  /** The most device pixels drawn per CSS pixel. */
  pixelRatio: positive,
  /** Clouds in the sky and trees along the forest edge. */
  clouds: z.number().int().nonnegative(),
  trees: z.number().int().nonnegative(),
  /** Feathers puffing out of a hit bird. */
  featherPuff: z.number().int().nonnegative(),
});

/**
 * The bird hunt at the hunting stand (2.5D): the world is 3D, but the play is on one flat field
 * facing the camera, `width` across and `height` up from the bow (field units). Flocks of birds
 * cross it; you draw the bow (drag back) and release, and the arrow flies in an arc in the same
 * plane. A hit downs the bird: its seeds, some feathers and (unless it broke) the arrow come back.
 * An arrow passing close scares a bird into dropping a seed. Stars come from points against par.
 */
const archerySchema = z.object({
  /**
   * The field: `width` × `height` field units, the bow at the middle of its bottom edge. Birds
   * enter and leave `margin` past its sides. The camera frames it with `frame` more below (the
   * bow), above (under the HUD) and each side, and fits that box to the screen.
   */
  field: z.object({ width: positive, height: positive, margin: nonNegative }),
  frame: z.object({ bottom: nonNegative, top: nonNegative, side: nonNegative }),
  /** Seconds per step of the rules, whatever the frame rate (so a round replays the same). */
  step: positive,
  /**
   * A round: `seconds` long, a flock setting off at each of `flockAt` (seconds in), its birds
   * entering `birdGap` seconds apart. It ends early once every bird has gone and no arrow flies,
   * or when the quiver's empty.
   */
  round: z.object({
    seconds: positive,
    flockAt: z.array(nonNegative).min(1),
    birdGap: rangeSchema,
  }),
  /**
   * The flocks, by Archery level: the last entry at or under the level is used. Each flock has
   * `birds` birds, each one's kind picked by the `mix` weights.
   */
  flocks: z
    .array(
      z.object({
        level: positiveInt,
        birds: countRange,
        mix: z.array(z.object({ bird: id, weight: positive })).min(1),
      }),
    )
    .min(1),
  /**
   * The birds. A hit one drops `seeds` of its `seed` item and pays `xp`. Its body is `radius`
   * field units round (the hit radius, and what the model is sized to); it flies at `speed`
   * (field units a second) at `altitude` (field units up), bobbing (`straight`) or swooping
   * (`swoop`: dives `amplitude` down and back up) at `hz`. `look` is only looks.
   */
  birds: z
    .array(
      z.object({
        id,
        name,
        seed: id,
        seeds: countRange,
        xp: nonNegative,
        radius: positive,
        speed: rangeSchema,
        altitude: rangeSchema,
        path: z.object({ kind: z.enum(birdPaths), amplitude: nonNegative, hz: nonNegative }),
        look: z.object({
          shape: z.enum(birdShapes),
          body: hexColor,
          wing: hexColor,
          belly: hexColor,
          beak: hexColor,
          /** Wing beats a second. */
          flapHz: positive,
        }),
      }),
    )
    .min(1),
  /** Feathers a hit bird drops, whatever its kind. */
  feathers: z.object({ item: id, count: countRange }),
  /**
   * A scared bird poops out `seeds` of its seed and flies on `speedUp` times as fast. It can be
   * scared again (even by the same arrow, on its way up and back down), but not within `cooldown`
   * seconds of the last time; each scare speeds it up again, to at most `maxSpeedUp` times its own
   * speed, so a bird scared again and again flees but never vanishes.
   */
  scare: z.object({
    seeds: positiveInt,
    speedUp: z.number().min(1),
    cooldown: nonNegative,
    maxSpeedUp: z.number().min(1),
  }),
  /**
   * The arrow kinds, best first: the quiver starts on the first you have. Each is the warchest
   * `item` it spends, and flies at `speed` (a full draw, field units a second), slowed by `drag`
   * (a share of its speed a second), and pushed sideways by `drift` (most, a steady push that's
   * different every shot) and a `wobble` (field units a second, every second) at `wobbleHz`. Only
   * looks: it visibly fishtails `fishtail` degrees as it wobbles. A hit arrow comes back with the
   * bird unless it breaks (`breakChance`); a miss is lost.
   */
  arrows: z
    .array(
      z.object({
        item: id,
        speed: positive,
        drag: nonNegative,
        drift: nonNegative,
        wobble: nonNegative,
        wobbleHz: nonNegative,
        fishtail: nonNegative,
        breakChance: fraction,
      }),
    )
    .min(1),
  /** The steepest and flattest shots, in degrees from the right (90 is straight up). */
  aim: z.object({ min: z.number().min(0).max(180), max: z.number().min(0).max(180) }),
  /** An arrow still flying after this long (seconds) is lost. */
  arrowSeconds: positive,
  /**
   * Stars from points against par (Brandon, Nov 27): a hit is a point and every scare is a point.
   * Par is every bird that flew by in the round, shot at or not. 3 stars at par or more, 2 from `two` of par, 1 from `one` of
   * it, else none.
   */
  stars: z.object({ one: fraction, two: fraction }),
  /** Bonus seeds for 2 and 3 stars, a share of the seeds the round earned, as at every station. */
  starBonus: z.object({ two: nonNegative, three: nonNegative }),
  /**
   * Looks. The camera stands `eyeHeight` up, tilted `pitch` degrees up into the sky; the field is
   * `distance` away, square on to it; the bow is `bowDistance` in front of it, `bowSize` across,
   * and a new arrow is on the string `reloadSeconds` after a shot. An arrow in flight is drawn
   * `arrowLength` field units long; birds are seen `birdTilt` degrees from below, so their wings
   * show as they beat.
   */
  looks: z.object({
    eyeHeight: positive,
    pitch: z.number().min(0).max(80),
    distance: positive,
    bowDistance: positive,
    bowSize: positive,
    reloadSeconds: nonNegative,
    arrowLength: positive,
    birdTilt: z.number().min(0).max(90),
    /** The forest edge: trees from `treeDistance.min` to `.max` away, `treeHeight` tall. */
    treeDistance: rangeSchema,
    treeHeight: rangeSchema,
    /** Seed for where the trees and clouds go: the same every round. */
    seed: z.number().int(),
    tiers: z.object({ high: archeryTierLookSchema, low: archeryTierLookSchema }),
  }),
  feel: archeryFeelSchema,
});

/** Feel numbers for fletching. The debug menu can override them live. */
export const fletchingFeelSchema = z.object({
  /**
   * The tar dip: while the shaft's held in the pot its tar level rises `tarFill` a second (1 is a
   * full coat), and lifting it with the level from `tarLow` to `tarHigh` (the green band) is just
   * right. Under it the feathers slide off; over it the tar globs. Dragging down `dipPx` (CSS px)
   * puts the shaft in the pot.
   */
  tarFill: positive,
  tarLow: fraction,
  tarHigh: fraction,
  dipPx: positive,
  /**
   * The feathers: the shaft turns `turnSpeed` degrees a second, its first mark reaching the top
   * `leadSeconds` after it's in the jig. A tap within `markWindowMs` of a mark's being at the top
   * slaps the feather on that mark; any later or earlier, it goes on crooked.
   */
  turnSpeed: positive,
  markWindowMs: nonNegative,
  leadSeconds: nonNegative,
  /** After an arrow's made, the next shaft is ready this long later (seconds). */
  finishSeconds: nonNegative,
  shakeStrength: nonNegative,
  /** Vibration (ms): the shaft going into the tar, a feather on its mark, one off it, the bucket. */
  buzzDipMs: nonNegative,
  buzzSlapMs: nonNegative,
  buzzMissMs: nonNegative,
  buzzBucketMs: nonNegative,
});

/** How the fletcher's bench draws on a graphics tier (only looks: the rules are the same on both). */
const fletchingTierLookSchema = z.object({
  /** The most device pixels drawn per CSS pixel, and whether the sun casts shadows. */
  pixelRatio: positive,
  shadows: z.boolean(),
  /** Feathers stuck on a duster, and heaped in the bucket; trees along the forest edge. */
  dusterFeathers: z.number().int().nonnegative(),
  bucketFeathers: z.number().int().nonnegative(),
  trees: z.number().int().nonnegative(),
  /** The textured grass round the bench (else plain green). */
  grass: z.boolean(),
});

/**
 * Fletching at the fletcher's bench: make arrows from shafts (a `stave` splits into
 * `shaftsPerStave` of them; a spare `shaft` waits in the warchest) and feathers, one at a time,
 * for a round of `round.seconds`. Each arrow: dip its back end in the tar, then either fletch it
 * carefully (`feathers.careful`, one on each of `marks` marks as it turns) or shove it in the
 * bucket (`feathers.bucket`, always a duster). Or skip the feathers for a bare arrow. Tar is free.
 */
const fletchingSchema = z.object({
  /** The workers' recipe: it must be a stave's worth of careful fletching (checked). */
  recipe: id,
  stave: id,
  shaft: id,
  shaftsPerStave: positiveInt,
  feather: id,
  feathers: z.object({ careful: positiveInt, bucket: positiveInt }),
  marks: positiveInt,
  /**
   * What comes out: a fletched arrow (tar in the band, every feather on its mark), a duster (the
   * bucket, too much tar, or feathers off their marks) or a bare one (no feathers, or too little
   * tar: they slide off and are lost). Each is an arrow kind of the bird hunt's, and pays `xp`.
   */
  arrows: z.object({
    fletched: z.object({ item: id, xp: nonNegative }),
    duster: z.object({ item: id, xp: nonNegative }),
    bare: z.object({ item: id, xp: nonNegative }),
  }),
  round: z.object({ seconds: positive }),
  /** Stars from fletched arrows made in the round: 1, 2 and 3 from these many. */
  stars: z.object({ one: positiveInt, two: positiveInt, three: positiveInt }),
  /** Bonus fletched arrows for 2 and 3 stars, a share of the fletched arrows made. */
  starBonus: z.object({ two: nonNegative, three: nonNegative }),
  /**
   * Looks. The camera fits `frameWidth` (metres) across the screen, looking down `pitch` degrees
   * from `distance` away, and moves in to `closeDistance` from the shaft's back end while the
   * feathers go on. The shaft is `shaftLength` long and `shaftRadius` round, and a full tar level
   * coats `tarLength` of it from the back end. Feathers are `featherLength` long. Trees stand
   * `treeDistance` away, `treeHeight` tall, placed from `seed`.
   */
  looks: z.object({
    frameWidth: positive,
    pitch: z.number().min(0).max(80),
    distance: positive,
    closeDistance: positive,
    shaftLength: positive,
    shaftRadius: positive,
    tarLength: positive,
    featherLength: positive,
    treeDistance: rangeSchema,
    treeHeight: rangeSchema,
    seed: z.number().int(),
    tiers: z.object({ high: fletchingTierLookSchema, low: fletchingTierLookSchema }),
  }),
  feel: fletchingFeelSchema,
});

/**
 * Workers: how many you have (`start` at level 1 of `skill`, one more every `everyLevels`), and
 * the job each does at a station: its recipe run `perMinute` times a minute (with `batches` and
 * `yield` as a played craft would), using up `extra` items too (e.g. fuel), for XP per item as if
 * played. They work while you play and while you're away (up to `awayCapMinutes`), and never use
 * an item below the minimum the player keeps back.
 */
const workersSchema = z.object({
  skill: id,
  start: z.number().int().nonnegative(),
  everyLevels: positiveInt,
  awayCapMinutes: positive,
  cardMinutes: nonNegative,
  minimumStep: positiveInt,
  pour: z.object({
    maxPieces: positiveInt,
    staggerSeconds: nonNegative,
    flightSeconds: positive,
    buzzMs: nonNegative,
  }),
  jobs: z
    .array(
      z.union([
        z.object({
          recipe: id,
          perMinute: positive,
          batches: positiveInt.default(1),
          yield: positiveInt.default(1),
          extra: z.array(z.object({ item: id, count: positiveInt })).default([]),
          /** Workers here in a new game. */
          start: z.number().int().nonnegative(),
        }),
        // The farm's: no recipe. Each worker tends `perMinute` plots a minute (src/core/farm.ts):
        // harvests a ripe one onto the pile and replants what was there.
        z.object({ plots: id, perMinute: positive, start: z.number().int().nonnegative() }),
      ]),
    )
    .min(1),
});

// The castle: the siege's next target, built from the Quaternius kits (Debug → Castle preview shows
// it). Metres, y up, the castle's middle at the origin and its front (the gate) facing +z, toward
// the player. castleLayout.ts lays it out and checks it holds together.

const castleTowerShape = z.enum(['round', 'square']);
const castlePoint = z.tuple([z.number(), z.number()]);
const castleVec3 = z.tuple([z.number(), z.number(), z.number()]);
/** A building's sides, as seen from outside: front faces +z (the gate), back −z, left −x, right +x. */
export const castleSides = ['front', 'back', 'left', 'right'] as const;

/**
 * One storey of a side of a building, left to right as seen from outside, one letter per kit
 * module: `-` a plain wall, `t` a thin window, `w` a wide window, `d` a door (ground floor only).
 */
const castleFacade = z.string().regex(/^[-twd]+$/, 'Use - t w d, one per module');

/** A piece of the kit (a node of its GLB), turned (degrees) and moved (m) from where it's placed. */
const castlePieceSchema = z.object({
  node: name,
  turn: z.number().default(0),
  offset: castleVec3.default([0, 0, 0]),
});

/**
 * A tower (round or square) or the gatehouse: a node of the curtain wall's ring. `size` is a round
 * tower's radius or half a square one's width; `height` its stonework's top; `top` a pointed tile
 * roof or battlements a guard can stand behind. A gatehouse is a square tower `depth` m deep with
 * an arched gate `gate` (width, height) through it, front to back.
 */
const castleTowerSchema = z.object({
  id,
  shape: castleTowerShape,
  at: castlePoint,
  size: positive,
  /** Half its depth (z), for a square tower that isn't square; its `size` otherwise. */
  depth: positive.optional(),
  height: positive,
  top: z.enum(['roof', 'battlements']),
  gate: z.object({ width: positive, height: positive }).optional(),
  /**
   * Stays whole when the siege breaks things. Otherwise a round tower comes apart in wedges
   * (`towerChunks`) and a gatehouse in blocks (`gatehouseChunks`).
   */
  solid: z.boolean().default(false),
});

/**
 * A stretch of curtain wall from one tower to another, straight along x or z. It comes apart in
 * chunks unless `solid` (its battlements come off either way).
 */
const castleWallSchema = z.object({ id, from: id, to: id, solid: z.boolean().default(false) });

/**
 * A building in the courtyard, built from the kit's wall modules: `modules` across (x) and deep
 * (z), `storeys` high, each side's storeys from the ground up (see `castleFacade`). Its roof is the
 * kit's `roof` piece, stretched to fit, with `gable` closing its ends.
 */
const castleBuildingSchema = z.object({
  id,
  name,
  at: castlePoint,
  modules: z.tuple([positiveInt, positiveInt]),
  storeys: positiveInt,
  facades: z.object({
    front: z.array(castleFacade),
    back: z.array(castleFacade),
    left: z.array(castleFacade),
    right: z.array(castleFacade),
  }),
  /**
   * Its top `storeys` come apart in the siege (the rest never do), each in blocks `across` (x) and
   * `deep` (z) modules wide: both must add up to its `modules`. The roof rests on the top ones.
   */
  chunks: z
    .object({
      storeys: positiveInt,
      across: z.array(positiveInt).min(1),
      deep: z.array(positiveInt).min(1),
    })
    .optional(),
});

/** A thing from the kit standing in the courtyard (the spear rack, barrels, a wagon). */
const castlePropSchema = z.object({
  id,
  piece: id,
  at: castlePoint,
  turn: z.number().default(0),
});

/**
 * Steps up the inside of a wall to its walk: starting `start` m along the wall (from its `from`
 * tower's middle) and climbing `run` m along it (negative: back toward `from`), `width` wide.
 */
const castleStairSchema = z.object({
  id,
  wall: id,
  start: z.number(),
  run: z.number().refine((run) => run !== 0, 'A stair must climb somewhere'),
  width: positive,
});

/**
 * A guard's way round the castle: on a wall's walk (`at` m along it from its `from` tower), on the
 * courtyard's ground, or up or down a stair. Walking from one to the next must stay on its level
 * (the same wall's walk; the ground clear of buildings), or change level by a stair.
 */
const castleWaypointSchema = z.union([
  z.object({ walk: id, at: z.number() }),
  z.object({ ground: castlePoint }),
  z.object({ stair: id }),
]);

/**
 * A place the player shoots from: the camera there, looking at `look` to start with, `fov`
 * degrees high. The player turns the view from there: up to `yaw` degrees left or right of
 * `look`, and from `pitch[0]` degrees under it to `pitch[1]` over it (far enough to see the whole
 * castle from each).
 */
const castleVantageSchema = z.object({
  id,
  name,
  at: castleVec3,
  look: castleVec3,
  fov: z.number().min(20).max(90),
  yaw: z.number().min(0).max(180),
  pitch: z.tuple([z.number().min(-80).max(0), z.number().min(0).max(80)]),
});

/**
 * How the castle draws on one graphics tier: with the sun's real-time shadows or none, its colour
 * maps `textureSize` px (each named in `textureSizes` its own size), and the trees round it (this
 * many of this model).
 */
const castleTierSchema = z.object({
  shadows: z.boolean(),
  textureSize: z.union([z.literal(256), z.literal(512), z.literal(1024)]),
  textureSizes: z.record(name, z.union([z.literal(256), z.literal(512), z.literal(1024)])),
  trees: z.object({ model: name, count: z.number().int().nonnegative() }),
});

/**
 * A kit material for the castle's own stonework: the kit's `material`, its texture repeating every
 * `tile` m. `band` keeps to one strip of a trim sheet (v from, v to): the RockTrim's capstones.
 */
const castleSkinSchema = z.object({
  material: name,
  tile: positive,
  band: z.tuple([fraction, fraction]).optional(),
});

export const castleSchema = z.object({
  /**
   * The kit's GLB (tools/castle/build.py). Its colour maps sit beside it in tex-1024/, tex-512/ and
   * tex-256/; each tier picks their sizes.
   */
  kit: name,
  /** Towers stand on this grid (m), so walls meet them square. */
  grid: positive,
  /** The curtain wall: its height to the walk, its thickness, and the parapet on its outer edge. */
  wall: z.object({
    height: positive,
    thickness: positive,
    /** The parapet: a low wall `height` high and `thickness` thick, merlons on top. */
    parapet: z.object({ height: positive, thickness: positive }),
    /** Merlons: `width` wide and `height` high, with crenels `gap` wide between them. */
    merlon: z.object({ width: positive, height: positive, gap: positive }),
    /** The wider foot: `height` high, standing `out` m proud of each face. */
    plinth: z.object({ height: positive, out: positive }),
    /** A band of trim stone round walls and towers at the walk's level, standing `out` m proud. */
    course: z.object({ height: positive, out: positive }),
    /**
     * A wall that comes apart does so in columns about `length` m long (two merlons on each), each
     * `rows` chunks high.
     */
    chunks: z.object({ length: positive, rows: positiveInt }),
  }),
  towers: z.array(castleTowerSchema).min(3),
  /** A round tower that comes apart: in `sectors` wedges round it, `rows` high. */
  towerChunks: z.object({ sectors: z.number().int().min(3), rows: positiveInt }),
  /**
   * A gatehouse that comes apart: its two piers (either side of the gate) and the stonework over
   * the gate, each in blocks `deep` front to back and `rows` high (the bottom row as high as the
   * gate, the rest sharing what's above it; the stonework over the gate has none in the bottom
   * row). Its top row carries the parapet, and its merlons stand on that.
   */
  gatehouseChunks: z.object({ rows: z.number().int().min(2), deep: positiveInt }),
  walls: z.array(castleWallSchema).min(3),
  /**
   * The kit's wall module (m): a building's walls are this wide, each storey `storey` high, a
   * window's middle `windowMiddle` above its storey's floor.
   */
  module: positive,
  storey: positive,
  windowMiddle: positive,
  /** The kit's pieces for each facade letter, the roof and its gables. */
  facadePieces: z.object({
    '-': z.array(castlePieceSchema).min(1),
    t: z.array(castlePieceSchema).min(1),
    w: z.array(castlePieceSchema).min(1),
    d: z.array(castlePieceSchema).min(1),
  }),
  roof: z.object({
    piece: castlePieceSchema,
    gable: castlePieceSchema,
    /** How far (m) the roof reaches past the walls, all round. */
    overhang: nonNegative,
  }),
  /**
   * The tile roof on a round tower: stretched to the tower, reaching `overhang` m past it, its
   * point `rise` times its width above its foot (the kit piece's own shape, for the siege's body).
   */
  towerRoof: z.object({ piece: castlePieceSchema, overhang: nonNegative, rise: positive }),
  /** A stone quoin at each corner of a building, this wide. */
  quoin: positive,
  /**
   * The stonework's small parts (m): sides round a round tower; the corbels a tower's top stands
   * out on (`out` and `height`); a merlon's capstone (`height`, and `out` past the merlon all
   * round); an arrow slit (width, height, depth) and the dark doorway from a walk into a tower
   * (width, height); the trim round a gate's arch (`width`, standing `proud` of the face); how far
   * the gate's leaves stand back in the passage, and the heights of their iron straps.
   */
  details: z.object({
    towerSides: z.number().int().min(6),
    corbel: z.object({ out: positive, height: positive }),
    cap: z.object({ height: positive, out: nonNegative }),
    slit: z.tuple([positive, positive, positive]),
    doorway: z.tuple([positive, positive]),
    archTrim: z.object({ width: positive, proud: positive }),
    gateSetBack: positive,
    straps: z.array(positive),
  }),
  buildings: z.array(castleBuildingSchema).min(1),
  /** Kit pieces that stand about: what each prop id draws. */
  pieces: z.record(id, z.array(castlePieceSchema).min(1)),
  /**
   * The box each prop's piece fills (m: its size, and its middle from where the prop stands, before
   * the prop's turn), from the kit piece's bounds: what the siege's spears hit.
   */
  boxes: z.record(id, z.object({ size: castleVec3, middle: castleVec3 })),
  props: z.array(castlePropSchema),
  /** The alarm bell: a timber frame `size` (width, height), its bell `bell` m across. */
  bell: z.object({
    id,
    at: castlePoint,
    turn: z.number().default(0),
    size: z.tuple([positive, positive]),
    bell: positive,
  }),
  stairs: z.array(castleStairSchema),
  /** Each step of a stair rises this much (m). */
  stairRise: positive,
  /**
   * What the siege plays with: the windows the captain shows at (a building's side, storey and
   * module, counted from 0 as its facade is), the places the spear rack may stand (props; a siege
   * picks one), the guards' ways round, and their lookouts on the towers (standing `at` m from a
   * tower's middle, on its top).
   */
  anchors: z.object({
    captainWindows: z
      .array(
        z.object({
          building: id,
          side: z.enum(castleSides),
          storey: z.number().int().nonnegative(),
          module: z.number().int().nonnegative(),
        }),
      )
      .min(1),
    spearRacks: z.array(id).min(1),
    guardPaths: z.array(
      z.object({ id, loop: z.boolean(), points: z.array(castleWaypointSchema).min(2) }),
    ),
    lookouts: z.array(z.object({ id, tower: id, at: castlePoint })).default([]),
  }),
  vantages: z.array(castleVantageSchema).min(1),
  /** The castle's own stonework (drawn in code) in the kit's materials. */
  skins: z.object({
    wall: castleSkinSchema,
    tower: castleSkinSchema,
    trim: castleSkinSchema,
    cap: castleSkinSchema,
    walk: castleSkinSchema,
    courtyard: castleSkinSchema,
    timber: castleSkinSchema,
  }),
  /**
   * Kit pieces dressing the stonework, anywhere (banners, torches): `at` is where the piece's
   * origin goes (m), `turn` degrees about y.
   */
  dressing: z.array(z.object({ piece: id, at: castleVec3, turn: z.number().default(0) })),
  /** Ivy on the walls' and towers' outer faces: `count` of the `pieces` hung by a seeded scatter. */
  vines: z.object({
    seed: z.number().int(),
    count: z.number().int().nonnegative(),
    pieces: z.array(id).min(1),
  }),
  colors: z.object({
    /** The dark inside a building, seen through its windows and door, and in the arrow slits. */
    inside: hexColor,
    bell: hexColor,
    sky: hexColor,
    /** The sky's light from above and the ground's from below, and the sun's. */
    skyLight: hexColor,
    groundLight: hexColor,
    sun: hexColor,
  }),
  /** The scene round it: haze, light, the meadow and the trees. */
  scene: z.object({
    fog: z.tuple([positive, positive]),
    hemisphere: positive,
    sun: z.object({ intensity: positive, from: castleVec3 }),
    shadowMap: z.object({
      size: positiveInt,
      halfWidth: positive,
      far: positive,
      bias: z.number(),
    }),
    ground: positive,
    /** The trodden road out of the gate: `width` wide, `length` long. */
    road: z.object({ width: positive, length: positive }),
    /** The courtyard's floor: one of the game's grounds. */
    yard: z.enum(['forestGrass', 'meadowGrass', 'troddenDirt']),
    trees: z.object({
      seed: z.number().int(),
      /** Trees stand between these distances (m) from the middle, `height` tall. */
      near: positive,
      far: positive,
      height: z.tuple([positive, positive]),
    }),
  }),
  tiers: z.object({ high: castleTierSchema, low: castleTierSchema }),
  /**
   * Debug → Castle preview: the orbit camera round `target`, starting at `yaw` and `pitch`
   * (degrees) and `distance` (m), dragged `dragDegrees` a screen width, zoomed `zoomStep` a wheel
   * notch or pinched; and how long (s) it flies to a vantage point.
   */
  preview: z.object({
    target: castleVec3,
    yaw: z.number(),
    pitch: z.object({ start: z.number(), min: z.number(), max: z.number() }),
    distance: z.object({ start: positive, min: positive, max: positive }),
    fov: z.number().min(20).max(90),
    dragDegrees: positive,
    zoomStep: positive,
    flySeconds: positive,
  }),
});

/** A regular expression's source, checked to compile. */
const pattern = z.string().refine(
  (source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Not a valid regular expression' },
);

/**
 * The graphics tier, high or low, picked for this phone (Debug → Graphics can force either). On
 * Auto a phone starts on low if its GPU's name matches one of `lowGpus` (budget phone GPUs, and
 * software rendering), or if it says it has `lowMemoryGb` of memory or less. Otherwise it starts
 * on high and is watched in play: after `sampleFrames` calm frames (aiming, nothing falling), a
 * median frame time over `slowFrameMs` moves it to low for good.
 */
export const graphicsSchema = z.object({
  lowGpus: z.array(pattern),
  lowMemoryGb: positive,
  sampleFrames: positiveInt,
  slowFrameMs: positive,
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
  newGame: newGameSchema,
  woodcutting: woodcuttingSchema,
  splitting: splittingSchema,
  firemaking: firemakingSchema,
  brewing: brewingSchema,
  archery: archerySchema,
  fletching: fletchingSchema,
  farming: farmingSchema,
  siege: siegeSchema,
  runner: runnerSchema,
  warchest: warchestSchema,
  workers: workersSchema,
  tuning: tuningSchema,
  graphics: graphicsSchema,
  castle: castleSchema,
  characters: charactersSchema,
});

export type GameDataInput = z.input<typeof gameDataShape>;
export type GameData = z.output<typeof gameDataShape>;
export type Skill = GameData['skills'][number];
export type Item = GameData['items'][number];
export type ItemLook = Item['look'];
export type ItemStack = z.output<typeof itemStackSchema>;
export type Station = GameData['stations'][number];
export type Recipe = GameData['recipes'][number];
export type Unit = GameData['units'][number];
export type Enemy = GameData['enemies'][number];
export type Level = GameData['levels'][number];
export type Tuning = GameData['tuning'];
export type Graphics = GameData['graphics'];
export type Castle = GameData['castle'];
export type CastleSide = (typeof castleSides)[number];
export type CastleTower = Castle['towers'][number];
export type CastleWall = Castle['walls'][number];
export type CastleBuilding = Castle['buildings'][number];
export type CastleWaypoint = Castle['anchors']['guardPaths'][number]['points'][number];
export type CastleVantage = Castle['vantages'][number];
export type CastlePiece = Castle['roof']['piece'];
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
export type Workers = GameData['workers'];
export type WorkerJob = Workers['jobs'][number];
/** A worker job that runs a recipe (every station's but the farm's). */
export type RecipeJob = Extract<WorkerJob, { recipe: string }>;
/** The farm's worker job: tending its plots. */
export type PlotJob = Extract<WorkerJob, { plots: string }>;
export type Firemaking = GameData['firemaking'];
export type FiremakingFeel = Firemaking['feel'];
export type Brewing = GameData['brewing'];
export type BrewingFeel = Brewing['feel'];
export type BrewPotion = Brewing['potions'][number];
export type Archery = GameData['archery'];
export type ArcheryFeel = Archery['feel'];
export type ArcheryBird = Archery['birds'][number];
export type ArrowKind = Archery['arrows'][number];
export type BirdShape = (typeof birdShapes)[number];
export type Fletching = GameData['fletching'];
export type FletchingFeel = Fletching['feel'];
export type Farming = GameData['farming'];
export type FarmingFeel = Farming['feel'];
export type Crop = Farming['crops'][number];
export type CropShape = Crop['look']['shape'];
export type WoodcuttingForage = GameData['woodcutting']['forage'];
export type WoodcuttingFellRest = GameData['woodcutting']['fellRest'];
export type Gate = z.output<typeof gateSchema>;
export type Roll = z.output<typeof rollSchema>;
export type GateOp = Gate['op'];
export type LevelEvent = Level['events'][number];
export type RunnerData = GameData['runner'];
export type Siege = GameData['siege'];
export type SiegeFeel = Siege['feel'];
export type SiegeObjective = Siege['objectives']['pool'][number];
export type SiegePartKind = keyof Siege['parts'];
export type SiegeWeapon = Siege['weapons'][number];
export type SiegeMaterial = Siege['materials'][number];
export type RunnerFeel = RunnerData['feel'];
