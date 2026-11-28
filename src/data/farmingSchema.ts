import { z } from 'zod';

// The farm (Farming): its own file, like the characters', so the shared schema stays small.

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use a lower_snake_case id');
const name = z.string().min(1);
const fraction = z.number().min(0).max(1);
const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const nonNegative = z.number().nonnegative();
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour');
const rangeSchema = z.object({ min: nonNegative, max: nonNegative });

/** How a crop is drawn as it grows: a rosette of leaves (woad) or a tall stalk with a head. */
export const cropShapes = ['rosette', 'stalk'] as const;

/**
 * A crop: planted from a `seed` (an item, from the bird hunt), it grows for `growMinutes` of the
 * workers' time (playing, and away up to their cap) and gives `yield` of `item` a plot, times the
 * watering's multiplier, for `xp` each. Open from `level` of Farming, with `starter` seeds then.
 * Its thirst is the soil gauge's target `band` (0 dry to 1 soaked): woad's is high, sunflowers'
 * lower.
 */
const cropSchema = z.object({
  id,
  name,
  seed: id,
  item: id,
  level: positiveInt,
  starter: z.number().int().nonnegative(),
  growMinutes: positive,
  yield: positiveInt,
  xp: nonNegative,
  band: z.object({ low: fraction, high: fraction }),
  look: z.object({
    shape: z.enum(cropShapes),
    /** Leaves, the stalk, and the flower or head that shows once it's ripe. */
    leaf: hexColor,
    stem: hexColor,
    flower: hexColor,
    /** The sunflower's dark middle (a rosette's flowers have none: the same as `flower`). */
    centre: hexColor,
    /** Plants in a plot, and how tall one is when grown (m). */
    plants: positiveInt,
    height: positive,
  }),
});

/** Feel numbers for watering. The debug menu can override them live. */
export const farmingFeelSchema = z.object({
  /** The can pours `pourRate` of a gauge a second while it's held over a plot. */
  pourRate: positive,
  /** The spout pours `liftPx` (CSS px) above the finger, so the stream isn't under it. */
  liftPx: nonNegative,
  /** After the can runs dry, the watering ends this long later (seconds). */
  dryEndSeconds: nonNegative,
  shakeStrength: nonNegative,
  /** Vibration (ms): a seed planted, a plot reaching its band, one turning to mud, a harvest. */
  buzzPlantMs: nonNegative,
  buzzBandMs: nonNegative,
  buzzMudMs: nonNegative,
  buzzHarvestMs: nonNegative,
});

/** How the farm draws on a graphics tier (only looks: the rules are the same on both). */
const farmingTierLookSchema = z.object({
  /** The most device pixels drawn per CSS pixel, and whether the sun casts shadows. */
  pixelRatio: positive,
  shadows: z.boolean(),
  /** The textured grass round the plots (else plain green), and furrowed, textured soil. */
  grass: z.boolean(),
  furrows: z.boolean(),
  /** Trees along the edge of the field, and drops in the can's stream. */
  trees: z.number().int().nonnegative(),
  drops: z.number().int().nonnegative(),
});

/**
 * Farming at the farm: plant any crop in any empty plot (drag a seed across them), water once per
 * planting (the mini game: a soil gauge per plot with its crop's band, a can of limited water,
 * stars from the plots in their band), wait on real time, and harvest with one swipe. Nothing
 * ever dies: an unwatered crop gives its base yield, a ripe one waits.
 */
export const farmingSchema = z.object({
  /** Plots open from each Farming level: the most whose `level` is reached. */
  plots: z.array(z.object({ level: positiveInt, count: positiveInt })).min(1),
  crops: z.array(cropSchema).min(1),
  watering: z.object({
    /** The round ends after this long, if the can or the player hasn't ended it. */
    seconds: positive,
    /** Each plot's soil starts this dry (0 to 1), picked by the seeded RNG. */
    start: z.object({ min: fraction, max: fraction }),
    /** The can holds `perPlot` of a gauge for each plot the farm has. */
    can: z.object({ perPlot: positive }),
    /** Stars from the share of the plots watered that end in their band. */
    stars: z.object({ one: fraction, two: fraction, three: fraction }),
    /**
     * What a plot in its band gives at harvest, times its crop's yield, by the watering's stars.
     * A plot left dry or turned to mud, or never watered, gives the yield itself (never less).
     */
    multiplier: z.object({ one: positive, two: positive, three: positive }),
    /** Extra seeds at 3 stars: this share of each crop's plots watered, rounded down. */
    seedBonus: z.object({ three: nonNegative }),
  }),
  /**
   * A worker on the farm: `perMinute` plots tended a minute each, harvesting a ripe one onto the
   * farm's pile and replanting what was there (or replanting an empty plot that had a crop),
   * watered at `stars`.
   */
  worker: z.object({ stars: z.number().int().min(0).max(3) }),
  /**
   * Looks. Plots are `plotSize` square (m), `plotGap` apart, in `columns`; the soil is raised
   * `bedHeight`. The camera looks down `pitch` degrees with a `fov`, fitting the field and
   * `margin` round it. Growth stages are shares of the growing time: a sprout from `sprout`, young
   * from `young`, grown from `grown`. Soil colours: dry, wet (at the top of a band) and mud.
   */
  looks: z.object({
    plotSize: positive,
    plotGap: nonNegative,
    columns: positiveInt,
    bedHeight: positive,
    pitch: z.number().min(10).max(89),
    fov: z.number().min(10).max(100),
    margin: nonNegative,
    stages: z.object({ sprout: fraction, young: fraction, grown: fraction }),
    soil: z.object({ dry: hexColor, wet: hexColor, mud: hexColor }),
    treeDistance: rangeSchema,
    treeHeight: rangeSchema,
    seed: z.number().int(),
    tiers: z.object({ high: farmingTierLookSchema, low: farmingTierLookSchema }),
  }),
  feel: farmingFeelSchema,
});
