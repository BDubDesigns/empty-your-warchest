import { Rng } from '../../../core';
import type { Firemaking, FiremakingFeel } from '../../../data';

/**
 * The fire under a rack: how hot the coals are under each stave (heat units, `generator.flat` is
 * the even fire), before any fuel.
 */
export interface Fire {
  seed: number;
  base: number[];
  /** Logs per spot that even it out (one answer; there may be others). */
  answer: number[];
}

/** How a stave comes out of the fire. */
export type Finish = 'under' | 'hardened' | 'charred';

/** A plan's best pull: when, what each stave comes out as, and how many harden. */
export interface BestPull {
  /** Seconds after the rack goes on. */
  at: number;
  finishes: Finish[];
  hardened: number;
  /** Seconds the whole rack is hardened together, if it ever is (0 if not). */
  window: number;
}

type Rules = Pick<Firemaking, 'rack' | 'generator'>;
type Heat = Pick<FiremakingFeel, 'heatPerLog' | 'spill'>;
type Cook = Pick<FiremakingFeel, 'cookSeconds' | 'charRatio'>;

/** The staves (by index along the rack) over spot `spot`. */
export function stavesOver(rules: Pick<Firemaking, 'rack'>, spot: number): number[] {
  const per = rules.rack.staves / rules.rack.spots;
  return Array.from({ length: per }, (_, index) => spot * per + index);
}

/**
 * The heat fuel adds under each stave: a spot's logs heat its own staves by `heatPerLog` each and
 * spill `spill` each onto the nearest stave either side (the next spot's edge), so warming one spot
 * warms its neighbours a little and the whole fire has to be planned.
 */
export function fuelHeat(rules: Pick<Firemaking, 'rack'>, heat: Heat, logs: readonly number[]) {
  const added = new Array<number>(rules.rack.staves).fill(0);
  logs.forEach((count, spot) => {
    if (count <= 0) return;
    const own = stavesOver(rules, spot);
    for (const index of own) added[index] = (added[index] ?? 0) + count * heat.heatPerLog;
    const first = own[0] ?? 0;
    const last = own[own.length - 1] ?? 0;
    for (const index of [first - 1, last + 1]) {
      if (index >= 0 && index < added.length) {
        added[index] = (added[index] ?? 0) + count * heat.spill;
      }
    }
  });
  return added;
}

/** The heat under each stave with `logs` in the spots. */
export function heatWith(
  rules: Pick<Firemaking, 'rack'>,
  heat: Heat,
  fire: Pick<Fire, 'base'>,
  logs: readonly number[],
): number[] {
  const added = fuelHeat(rules, heat, logs);
  return fire.base.map((value, index) => value + (added[index] ?? 0));
}

/**
 * Seconds a stave at `heat` takes to harden: hotter cooks faster. It chars at `charRatio` times
 * that, so its pull window is shorter the hotter it is.
 */
export function hardenAt(rules: Pick<Firemaking, 'generator'>, cook: Cook, heat: number): number {
  return (rules.generator.flat * cook.cookSeconds) / heat;
}

/** How far along a stave at `heat` is after `seconds`: 1 is hardened, `charRatio` charred. */
export function doneness(
  rules: Pick<Firemaking, 'generator'>,
  cook: Cook,
  heat: number,
  seconds: number,
): number {
  return seconds / hardenAt(rules, cook, heat);
}

export function finishOf(cook: Cook, done: number): Finish {
  if (done < 1) return 'under';
  return done < cook.charRatio ? 'hardened' : 'charred';
}

/**
 * The best moment to pull a rack whose staves have `heats`: the one that hardens the most staves
 * (the earliest such moment, while the coldest of them has just hardened). Staves harden
 * together when their heats are within `charRatio` of each other, so the fire is even enough for a
 * full rack when its hottest stave is under `charRatio` times its coldest.
 */
export function bestPull(
  rules: Pick<Firemaking, 'generator'>,
  cook: Cook,
  heats: readonly number[],
): BestPull {
  let best: BestPull | undefined;
  for (const heat of heats) {
    const at = hardenAt(rules, cook, heat);
    const finishes = heats.map((other) => finishOf(cook, doneness(rules, cook, other, at)));
    const hardened = finishes.filter((finish) => finish === 'hardened').length;
    if (!best || hardened > best.hardened || (hardened === best.hardened && at < best.at)) {
      best = { at, finishes, hardened, window: 0 };
    }
  }
  if (!best) throw new Error('A rack needs at least one stave');
  const hottest = Math.max(...heats);
  const coldest = Math.min(...heats);
  best.window = Math.max(
    hardenAt(rules, cook, hottest) * cook.charRatio - hardenAt(rules, cook, coldest),
    0,
  );
  return best;
}

/** Every way to fill the spots (0 to `maxLogs` logs each). */
export function allFuelings(rules: Pick<Firemaking, 'rack'>): number[][] {
  const { spots, maxLogs } = rules.rack;
  let result: number[][] = [[]];
  for (let spot = 0; spot < spots; spot++) {
    result = result.flatMap((logs) =>
      Array.from({ length: maxLogs + 1 }, (_, count) => [...logs, count]),
    );
  }
  return result;
}

/**
 * The fuelings that harden the whole rack, with the pull window each gives, longest first. Used
 * to check fires and for the log.
 */
export function fullRackAnswers(
  rules: Rules,
  feel: Heat & Cook,
  fire: Pick<Fire, 'base'>,
): { logs: number[]; window: number }[] {
  return allFuelings(rules)
    .map((logs) => {
      const pull = bestPull(rules, feel, heatWith(rules, feel, fire, logs));
      return { logs, window: pull.hardened === fire.base.length ? pull.window : 0 };
    })
    .filter((answer) => answer.window > 0)
    .sort((a, b) => b.window - a.window);
}

/**
 * A fire from `seed`, built backwards from an even one so it always has a full-rack answer: a
 * random answer's worth of fuel heat is taken off the even fire, with small lumps on top. One that
 * would harden a full rack with no fuel or with every spot filled, or whose answer leaves too
 * short a pull window, is made again. The same seed and feel always give the same fire.
 */
export function generateFire(rules: Rules, feel: Heat & Cook, seed: number): Fire {
  // Hashed, so fires from nearby seeds (racks a moment apart) don't start out alike.
  const rng = new Rng(`fire:${String(seed)}`);
  const { generator, rack } = rules;
  const fullUp = new Array<number>(rack.spots).fill(rack.maxLogs);
  let made: Fire | undefined;
  for (let attempt = 0; attempt < generator.tries; attempt++) {
    const answer = randomAnswer(rules, rng);
    const added = fuelHeat(rules, feel, answer);
    const base = added.map(
      (value) => generator.flat - value + rng.range(-generator.noise, generator.noise),
    );
    if (base.some((value) => value < generator.minHeat)) continue;
    const fire = { seed, base, answer };
    made ??= fire;
    // It must need fuel, and not just every spot filled: planning is the puzzle.
    if (bestPull(rules, feel, base).hardened === rack.staves) continue;
    if (bestPull(rules, feel, heatWith(rules, feel, fire, fullUp)).hardened === rack.staves) {
      continue;
    }
    const window = bestPull(rules, feel, heatWith(rules, feel, fire, answer)).window;
    if (window >= generator.minWindow) return fire;
  }
  // Every try fell short (only with extreme tuning): the first fair-heat one still has its answer.
  if (made) return made;
  const answer = new Array<number>(rack.spots).fill(0);
  return { seed, base: new Array<number>(rack.staves).fill(generator.flat), answer };
}

/** A random fueling with between `answerLogs.min` and `answerLogs.max` logs, spots capped. */
function randomAnswer(rules: Rules, rng: Rng): number[] {
  const { rack, generator } = rules;
  const logs = new Array<number>(rack.spots).fill(0);
  const total = rng.int(generator.answerLogs.min, generator.answerLogs.max);
  for (let placed = 0; placed < total;) {
    const spot = rng.int(0, rack.spots - 1);
    if ((logs[spot] ?? 0) >= rack.maxLogs) continue;
    logs[spot] = (logs[spot] ?? 0) + 1;
    placed += 1;
  }
  return logs;
}
