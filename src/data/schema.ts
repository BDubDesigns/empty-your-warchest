import { z } from 'zod';
import { buildFort } from './siegePieces';

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
 * (woad).
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

/** What a fort's blocks are made of. `kind` is how a block looks and sounds. */
const siegeMaterialSchema = z.object({
  id,
  kind: z.enum(['stone', 'wood', 'glass']),
  /** kg per cubic metre. */
  density: positive,
  friction: nonNegative,
  /** Bounce, from 0 (none) to 1. */
  restitution: fraction,
  /** Hit points: a block breaks once hits and crashes have dealt this much damage. */
  hp: positive,
});

/**
 * What a position is won by, each checked by one small function in the siege's rules: bring
 * down every guard at the position, or bring the banner down (its middle below `height` metres,
 * or the siege's `banner.winHeight`). Later missions add kinds here.
 */
const siegeObjectiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('guards_down') }),
  z.object({ kind: z.literal('banner_down'), height: positive.optional() }),
]);

/** Where a piece stands: its middle on the ground (x across, z toward the ballista). */
const placeSchema = z.tuple([z.number(), z.number()]);
/** The position (by index) a guard on a piece guards. */
const guardForSchema = z.number().int().min(0);
/**
 * How a guard keeps watch until something alerts him: standing still, walking up and down (on a
 * walkway only), or asleep (woken by noise).
 */
const watchSchema = z.enum(['stand', 'patrol', 'sleep']).default('stand');

/**
 * The prebuilt structures forts are assembled from, each placed at its middle: forts are lists of
 * these (and one day, assembled at random). Every piece faces the ballista (along x). Their parts'
 * sizes are the siege's `parts`.
 */
export const siegePieceSchema = z.discriminatedUnion('kind', [
  /**
   * A run of wall `length` stones across and `courses` high, laid like brickwork, with a merlon
   * on every stone of the top course (unless `merlons` is false).
   */
  z.object({
    kind: z.literal('wall'),
    at: placeSchema,
    length: positiveInt,
    courses: positiveInt,
    material: id,
    merlons: z.boolean().default(true),
    /**
     * Windows through it: an opening `width` stones across from stone `from` (counting from its
     * left end), from course `sill` up `courses` courses, glazed with a pane of `glass`, and a
     * beam of `lintel` across the course above it, resting on the stones either side.
     */
    windows: z
      .array(
        z.object({
          from: z.number().int().min(0),
          width: positiveInt,
          sill: z.number().int().min(0),
          courses: positiveInt,
          glass: id,
          lintel: id,
        }),
      )
      .default([]),
  }),
  /** A gate: two door leaves, `width` across between them and `height` tall, quick to break. */
  z.object({
    kind: z.literal('gate'),
    at: placeSchema,
    width: positive,
    height: positive,
    material: id,
  }),
  /** A squat tower: a stack of `courses` square blocks, with a guard on top if `guard` is set. */
  z.object({
    kind: z.literal('tower'),
    at: placeSchema,
    courses: positiveInt,
    material: id,
    guard: guardForSchema.optional(),
    watch: watchSchema,
  }),
  /**
   * The wooden keep with the banner on top: a storey for each of `storeys` (its posts' height), a
   * post at every corner of a `width` × `depth` floor and a plank floor on them. Storey `weak`
   * stands on two thin front posts (the weak point) and a wall of material `back` behind.
   */
  z.object({
    kind: z.literal('keep'),
    at: placeSchema,
    storeys: z.array(positive).min(1),
    weak: z.number().int().min(0),
    back: id,
    width: positive,
    depth: positive,
  }),
  /** A watch platform: four posts `height` tall and a floor, a guard on it if `guard` is set. */
  z.object({
    kind: z.literal('platform'),
    at: placeSchema,
    height: positive,
    guard: guardForSchema.optional(),
    watch: watchSchema,
  }),
  /** A guard post: a guard standing on the ground. */
  z.object({
    kind: z.literal('post'),
    at: placeSchema,
    guard: guardForSchema,
    watch: watchSchema,
  }),
  /**
   * A walkway behind a wall: `segments` timber blocks in a row along x, `height` tall (the guard's
   * floor), so a guard on it stands behind the battlements, half covered. A guard on watch here
   * walks up and down it; alerted, any guard on it paces, ducking behind the wall and leaning out.
   */
  z.object({
    kind: z.literal('walkway'),
    at: placeSchema,
    segments: positiveInt,
    height: positive,
    guard: guardForSchema.optional(),
    watch: watchSchema,
  }),
  /** A low wall `length` stones across, two courses high: cover a guard can duck behind. */
  z.object({ kind: z.literal('cover'), at: placeSchema, length: positiveInt, material: id }),
]);

/**
 * One position of a siege: where the ballista can stand (2 or 3 spots, x and z on the ground; you
 * tap to move between them) and what wins it. Its guards are the pieces' guards that name it. Win
 * it and the ballista rolls on to the next.
 */
const siegePositionSchema = z.object({
  name,
  spots: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .max(3),
  /** Points on the ground the weapon rolls through on its way in (through a gate, say). */
  approach: z.array(z.tuple([z.number(), z.number()])).default([]),
  objective: siegeObjectiveSchema,
});

/**
 * A fort: the pieces it's built from, the positions you take it in, in order (the last one brings
 * the banner down), the throws a good player takes over all of them (`par`), and the Command XP
 * it pays. Its blocks must stand on their own, and it must be fair (checked at startup).
 */
const siegeFortSchema = z.object({
  id,
  name,
  par: positiveInt,
  /**
   * `all`: every guard can be seen from a spot of his position as the round starts (through a
   * gap or a window), checked at startup; for the first forts. `some`: some may hide.
   */
  guardsVisible: z.enum(['all', 'some']).default('some'),
  /** XP for each block knocked down, each guard brought down, and winning (before stars). */
  rewards: z.object({ xpPerBlock: nonNegative, xpPerGuard: nonNegative, winXp: nonNegative }),
  pieces: z.array(siegePieceSchema).min(1),
  positions: z.array(siegePositionSchema).min(1),
});

/**
 * A weapon: what shoots the spears. An aimed volley is `aimed.start` spears, `aimed.add` more
 * every `aimed.everyLevels` levels of `skill`; a barrage is `barrageTimes` as many. Every spear
 * leaves at `speed` m/s (one speed: there's no power to set), tilted from `tilt.min` to `tilt.max`
 * degrees (`tilt.start` to begin with). It turns and tilts about a pivot `pivotHeight` up; spears
 * leave from its muzzle, `muzzle` along the bolt from the pivot, side by side `spacing` apart.
 * `size` (width, height, length) is only how big it's drawn. The ballista shoots flat and fast;
 * arc weapons (a catapult, a trebuchet) come later.
 */
const siegeWeaponSchema = z.object({
  id,
  name,
  skill: id,
  aimed: z.object({ start: positiveInt, everyLevels: positiveInt, add: z.number().int().min(0) }),
  barrageTimes: z.number().int().min(2),
  speed: positive,
  tilt: z.object({ min: z.number(), max: z.number().max(80), start: z.number() }),
  pivotHeight: positive,
  muzzle: positive,
  spacing: nonNegative,
  size: z.tuple([positive, positive, positive]),
});

/** Feel numbers for the siege. The debug menu can override them live. */
export const siegeFeelSchema = z.object({
  /**
   * Aiming, looking down the sights: the crosshair stays in the middle of the screen, on the
   * bolt's line, and a drag turns the view (and the weapon with it) `lookYawPerPx` degrees for
   * every pixel across and tilts it `lookTiltPerPx` for every pixel up or down. It turns up to
   * `maxAim` degrees either way, and stops at the weapon's tilt limits, so the crosshair never
   * points where the bolt can't go.
   */
  lookYawPerPx: positive,
  lookTiltPerPx: positive,
  maxAim: z.number().min(0).max(90),
  /**
   * Fire aims the shot at whatever is under the crosshair (or `aimFallback` metres out, if
   * nothing is), allowing for the drop: an aimed shot lands its middle spear right there.
   */
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
   * After a shot, a solid line `ghostWidth` thick along the middle spear's real path, until the
   * next shot (it can be turned off): learning the drop is the skill.
   */
  ghostWidth: positive,
  /** The spear's mass (kg): how hard it hits. */
  spearMass: positive,
  /** Seconds after a shot before the next, unless all its spears have already hit something. */
  reloadSeconds: nonNegative,
  /**
   * Moving: the weapon takes `spotSeconds` to move to another spot, and once a position is won,
   * waits `advanceDelaySeconds` (to watch it fall) and rolls on to the next in `advanceSeconds`.
   */
  spotSeconds: positive,
  advanceDelaySeconds: nonNegative,
  advanceSeconds: positive,
  /**
   * The view down the sights: the eye sits on the bolt's line, `sightBack` metres behind the
   * pivot, with a field of view `sightFov` degrees high.
   */
  sightFov: z.number().min(10).max(100),
  sightBack: nonNegative,
  /** Nothing nearer the eye than this is drawn (m): a spear or a stone lying at its feet. */
  sightNear: positive,
  /**
   * The kick of a shot: the view jolts back `kickBack` metres and up `kickTilt` degrees, and
   * settles over `kickSeconds`.
   */
  kickBack: nonNegative,
  kickTilt: nonNegative,
  kickSeconds: positive,
  /**
   * Guards' marks: a sleeper's "Z z z" `zzzSize` metres tall over his head, and an alerted guard's
   * "!" `markSize` tall for `markSeconds`.
   */
  zzzSize: positive,
  /**
   * Each Z floats up `zzzRise` metres from a sleeper's head over `zzzSeconds`, drifting `zzzDrift`
   * either way, fading in and out, one after another.
   */
  zzzRise: positive,
  zzzSeconds: positive,
  zzzDrift: nonNegative,
  /** A Sense potion shows every guard in red through walls for `senseSeconds`. */
  senseSeconds: positive,
  /** The last shot's line is at least `ghostPx` pixels wide on screen, however far off. */
  ghostPx: positive,
  markSize: positive,
  markSeconds: nonNegative,
  /**
   * The flyover as a fort first opens: the camera sweeps over each position in turn and the keep,
   * `flyoverHeight` metres up and `flyoverBack` short of what it looks at, over `flyoverSeconds`
   * in all. A tap skips it.
   */
  flyoverSeconds: positive,
  flyoverHeight: positive,
  flyoverBack: nonNegative,
  /** How far short of a wall a camera looking at something (a kill, a collapse) stops (m). */
  cameraClearance: nonNegative,
  /**
   * Scouting: the camera rises over `scoutSeconds` to look down on the whole fort from
   * `scoutHeight` metres up, `scoutBack` metres short of its middle (a high three-quarter view).
   * No shooting while scouting.
   */
  scoutHeight: positive,
  scoutBack: nonNegative,
  scoutSeconds: positive,
  /**
   * The bolt cam: after a shot the camera cuts over in `boltCamInSeconds` to ride `boltCamBack`
   * metres behind the middle spear and `boltCamRise` above it until it hits something, holds there
   * `boltCamHoldSeconds`, then eases back to the sights over `boltCamReturnSeconds`. A tap sends
   * it back early. A kill cam cuts in as fast.
   */
  boltCamBack: nonNegative,
  boltCamRise: nonNegative,
  boltCamInSeconds: positive,
  boltCamHoldSeconds: nonNegative,
  boltCamReturnSeconds: positive,
  /**
   * The kill cam: when a shot brings a guard down (the first of the shot), or a big collapse
   * (`collapseBlocks` blocks breaking within `collapseWindowSeconds`), time freezes for
   * `killCamStopMs`, then runs at `killCamSlowMo` while the camera looks at it from
   * `killCamDistance` metres off and `killCamRise` up, for `killCamSeconds` (real seconds). A tap
   * skips it, and so does the next shot. `buzzKillMs` is its buzz.
   */
  killCamSeconds: nonNegative,
  killCamSlowMo: z.number().min(0.05).max(1),
  killCamStopMs: nonNegative,
  killCamDistance: positive,
  /** How far off a collapse cam (a big collapse, the keep) looks from (m). */
  collapseCamDistance: positive,
  killCamRise: nonNegative,
  collapseBlocks: positiveInt,
  collapseWindowSeconds: positive,
  buzzKillMs: nonNegative,
  /** A spear hitting: the freeze (ms), and from `heavyHitSpeed` m/s a longer one (and on breaks). */
  hitStopMs: nonNegative,
  heavyHitStopMs: nonNegative,
  heavyHitSpeed: positive,
  /** Multiplier for every screen shake. 0 turns shake off. */
  shakeStrength: nonNegative,
  /**
   * A block slamming into something: dust and a thud from this sudden a change of speed (m/s), at
   * most one a block every `thudGapSeconds`, so a block rattling to a stop isn't a drum roll.
   */
  thudSpeed: positive,
  thudGapSeconds: nonNegative,
  /** Dust puffs for a thud at `thudSpeed`; harder thuds puff more. */
  dust: nonNegative,
  /** As the banner falls, time runs at `slowMo` for `slowMoSeconds` (real seconds). */
  slowMo: z.number().min(0.05).max(1),
  slowMoSeconds: nonNegative,
  /**
   * Vibration (ms): an aimed shot, a barrage, a spear hitting, a block thud, a block breaking, a
   * guard going down, the banner falling.
   */
  buzzThrowMs: nonNegative,
  buzzBarrageMs: nonNegative,
  buzzHitMs: nonNegative,
  buzzThudMs: nonNegative,
  buzzBreakMs: nonNegative,
  buzzGuardMs: nonNegative,
  buzzBannerMs: nonNegative,
});

/** A model skinning a rules' box (see `skins`). */
const skinSchema = z.object({
  model: z.string().regex(/^models\/.+\.(glb|gltf)$/, 'A model under models/, .glb or .gltf'),
  fit: z.enum(['box', 'height']),
  turn: z.number(),
  node: z.string().optional(),
});

/**
 * The parts pieces are built from, in metres: wall stones (`stone`, the `halfStone` that squares
 * off every other course, the `merlon` on top), a tower's square block (`towerBlock` across, a
 * stone's height), a keep's corner `post`, its `thinPost` (the weak point) and its floors
 * `slab` thick, a watch platform's floor (`platform` across, `platformSlab` thick), a gate's
 * leaves `gateDepth` thick, the banner's `pole`. And the hit points of the parts that don't take
 * their material's: a gate leaf, a weak post, the keep's other posts, the banner (which never
 * breaks: it has to fall).
 */
const siegePartsSchema = z.object({
  stone: z.tuple([positive, positive, positive]),
  halfStone: z.tuple([positive, positive, positive]),
  merlon: z.tuple([positive, positive, positive]),
  towerBlock: positive,
  post: positive,
  thinPost: positive,
  slab: positive,
  platform: positive,
  platformSlab: positive,
  gateDepth: positive,
  pole: z.tuple([positive, positive, positive]),
  /** A window's pane of glass: this thick. */
  pane: positive,
  /** A walkway segment: `walkway` long (along it) and `walkwayWidth` across. */
  walkway: positive,
  walkwayWidth: positive,
  gateHp: positive,
  weakHp: positive,
  keepPostHp: positive,
  bannerHp: positive,
});

/**
 * The siege at the War tent: shoot the warchest's spears at a fort, position by position, until
 * its banner comes down. The physics world (Rapier) is the rules, stepped at a fixed rate and
 * seeded, so the same shots always give the same result.
 */
const siegeShape = z.object({
  /** The warchest item shot. */
  item: id,
  /** The item a Sense potion is: drunk, every guard shows through walls for a while. */
  potion: id,
  /** The weapons, and the one the siege uses (more, arc weapons, come later as unlocks). */
  weapons: z.array(siegeWeaponSchema).min(1),
  weapon: id,
  /**
   * The guards: each a box `size` (width, height, depth) of `density` kg per cubic metre and
   * `friction`, with `hp` hit points, damaged by spears and crashes as blocks are. A guard is down
   * at 0 hit points, or once knocked over past `downTilt` degrees; one still standing is pushed over
   * (its head sent back at `topple` m/s) and lies there.
   */
  guard: z.object({
    size: z.tuple([positive, positive, positive]),
    density: positive,
    friction: nonNegative,
    hp: positive,
    downTilt: z.number().positive().max(90),
    topple: nonNegative,
  }),
  parts: siegePartsSchema,
  /**
   * How the siege's things look: a model over a rules' box, only a skin (the physics stays the
   * box). `fit: box` stretches it to the box on every axis (like the trees); `height` scales it
   * evenly to the box's height. `turn` turns it about the up axis first (degrees). `node` picks one
   * part of the model by name (the ballista's bolt, for the spear). Guards play the named `clips`
   * of their model for what they're about.
   */
  skins: z.object({
    gate: skinSchema,
    tower: skinSchema,
    banner: skinSchema,
    ballista: skinSchema,
    bolt: skinSchema,
    guard: skinSchema.extend({
      clips: z.object({
        stand: name,
        patrol: name,
        sleep: name,
        waking: name,
        dash: name,
        duck: name,
        lean: name,
        down: name,
      }),
    }),
  }),
  /**
   * How guards move (m/s and s). On watch a guard on a walkway walks it at `patrolSpeed`, pausing
   * `patrolPause` at each end. Alerted, he paces at `alertSpeed` to a new place, ducks `duck`
   * metres behind the wall for `alertPause`, then leans out (stands) for `alertLean`, and again. A
   * woken sleeper stands and looks round for `wakeSeconds` first.
   */
  guardMoves: z.object({
    patrolSpeed: positive,
    patrolPause: nonNegative,
    alertSpeed: positive,
    alertPause: nonNegative,
    alertLean: positive,
    duck: nonNegative,
    wakeSeconds: nonNegative,
  }),
  /**
   * Noise: how far (m) each thing is heard. The ballista firing; a spear hitting stone, wood or a
   * guard; a stone or wooden block breaking. A crash (a block slamming into something) is heard
   * `crashShare` as far as a spear hit on its material. A guard on watch who hears it is
   * alerted; a sleeper wakes only if it's within `sleepShare` of its reach.
   */
  noise: z.object({
    fire: nonNegative,
    hit: z.object({
      stone: nonNegative,
      wood: nonNegative,
      glass: nonNegative,
      guard: nonNegative,
    }),
    break: z.object({ stone: nonNegative, wood: nonNegative, glass: nonNegative }),
    crashShare: fraction,
    sleepShare: fraction,
  }),
  physics: z.object({
    /** Seconds per physics step, whatever the frame rate. */
    timestep: positive,
    gravity: positive,
    solverIterations: positiveInt,
    /** Steps at most per frame, so a slow frame can't snowball (the game slows instead). */
    maxStepsPerFrame: positiveInt,
    /** The field: its friction, and how far it reaches each way from the start (metres). */
    groundFriction: nonNegative,
    groundReach: positive,
  }),
  /**
   * The spear as a body: a capsule `length` long (tip to tip) and `radius` thick. It flies nose
   * first until it first touches something; from then on it tumbles as it will.
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
     * glancing one can't fly on across the fort and hit something it was never aimed at.
     */
    afterHit: fraction,
  }),
  /**
   * Everything has settled once no body moves faster than `speed` (m/s) or turns faster than
   * `spin` (radians a second) for `seconds`. After a win the card waits for that, or `winSeconds`
   * at most, so the fort is seen to fall.
   */
  settle: z.object({ speed: positive, spin: positive, seconds: positive, winSeconds: positive }),
  /** A block counts as knocked down once it has dropped `drop` metres or tipped `tilt` degrees. */
  down: z.object({ drop: positive, tilt: z.number().positive().max(90) }),
  /**
   * Damage. A spear hitting a block or a guard deals `spearPerSpeed` for every m/s it hits at over
   * `spearMinSpeed` (so a glancing tap does nothing). A body whose speed changes suddenly (it
   * slams into the ground or another, or one slams into it) takes `crashPerSpeed` for every m/s
   * of that change over `crashMinSpeed`, so collapses chain. At 0 hit points a block breaks: it's
   * gone, and whatever it held up falls.
   */
  damage: z.object({
    spearMinSpeed: nonNegative,
    spearPerSpeed: nonNegative,
    crashMinSpeed: positive,
    crashPerSpeed: nonNegative,
  }),
  /**
   * The banner: a `banner_down` position is won once its middle is below `winHeight` metres
   * (unless the objective says otherwise). It counts as falling, for the slow motion, once it has
   * tipped `fallTilt` degrees.
   */
  banner: z.object({ winHeight: positive, fallTilt: z.number().positive().max(90) }),
  /**
   * Stars for a win, measured `by` throws (a throw is one shot, aimed or barrage alike, over every
   * position) against the fort's par: 3 up to `three` × par, 2 up to `two` × par, else 1. Not by
   * spears, or thrift would be the best play when the game wants spears spent; not by time, as
   * stopping to aim on a phone shouldn't cost stars. Only `throws` so far.
   */
  stars: z.object({ by: z.enum(['throws']), three: positive, two: positive }),
  /** Bonus XP and recovered spears for 2 and 3 stars, as a share of each, as at every station. */
  starBonus: z.object({ two: nonNegative, three: nonNegative }),
  materials: z.array(siegeMaterialSchema).min(1),
  /** In order: each one opens once the one before it has been won. */
  forts: z.array(siegeFortSchema).min(1),
  feel: siegeFeelSchema,
});

/** The siege, its forts built: each fort's pieces laid out as blocks, and its guards placed. */
const siegeSchema = siegeShape.transform((siege) => ({
  ...siege,
  forts: siege.forts.map((fort) => {
    const built = buildFort(fort.pieces, fort.positions.length, siege.parts);
    return {
      ...fort,
      blocks: built.blocks,
      positions: fort.positions.map((position, index) => ({
        ...position,
        guards: built.guards[index] ?? [],
      })),
    };
  }),
}));

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
      z.object({
        recipe: id,
        perMinute: positive,
        batches: positiveInt.default(1),
        yield: positiveInt.default(1),
        extra: z.array(z.object({ item: id, count: positiveInt })).default([]),
        /** Workers here in a new game. */
        start: z.number().int().nonnegative(),
      }),
    )
    .min(1),
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
  siege: siegeSchema,
  runner: runnerSchema,
  warchest: warchestSchema,
  workers: workersSchema,
  tuning: tuningSchema,
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
export type Firemaking = GameData['firemaking'];
export type FiremakingFeel = Firemaking['feel'];
export type Brewing = GameData['brewing'];
export type BrewingFeel = Brewing['feel'];
export type BrewPotion = Brewing['potions'][number];
export type WoodcuttingForage = GameData['woodcutting']['forage'];
export type Gate = z.output<typeof gateSchema>;
export type Roll = z.output<typeof rollSchema>;
export type GateOp = Gate['op'];
export type LevelEvent = Level['events'][number];
export type RunnerData = GameData['runner'];
export type Siege = GameData['siege'];
export type SiegeFeel = Siege['feel'];
export type SiegeFort = Siege['forts'][number];
export type SiegeBlock = SiegeFort['blocks'][number];
export type SiegePosition = SiegeFort['positions'][number];
export type SiegeObjective = SiegePosition['objective'];
export type SiegeGuard = SiegePosition['guards'][number];
export type SiegePiece = z.output<typeof siegePieceSchema>;
export type SiegeParts = z.output<typeof siegePartsSchema>;
export type SiegeWeapon = Siege['weapons'][number];
export type SiegeMaterial = Siege['materials'][number];
export type RunnerFeel = RunnerData['feel'];
