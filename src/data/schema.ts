import { z } from 'zod';

/** lower_snake_case id used to reference one piece of data from another. */
const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use a lower_snake_case id');
const name = z.string().min(1);
const fraction = z.number().min(0).max(1);
const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const nonNegative = z.number().nonnegative();

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
