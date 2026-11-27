import { Rng } from '../../../core';
import type { Archery, ArcheryBird } from '../../../data';

/** One bird of a round, planned from the round's seed: when it comes, which way, how high. */
export interface BirdPlan {
  /** Its number in the round, from 0. */
  index: number;
  /** The flock it's in, from 0. */
  flock: number;
  bird: ArcheryBird;
  /** Seconds into the round it enters the field. */
  enterAt: number;
  /** 1 flies left to right, -1 right to left (a flock flies one way). */
  dir: 1 | -1;
  /** Its height (field units) before any bob or swoop. */
  altitude: number;
  /** Field units a second, before the feel's `birdSpeed`. */
  speed: number;
  /** Where in its bob or swoop it starts (radians). */
  phase: number;
}

/** The flock for an Archery level: the last one in the data at or under it. */
export function flockFor(rules: Pick<Archery, 'flocks'>, level: number): Archery['flocks'][number] {
  let found = rules.flocks[0];
  for (const flock of rules.flocks) if (flock.level <= level) found = flock;
  if (!found) throw new Error('No flocks in the archery data');
  return found;
}

/** A bird kind picked by the flock's weights. */
function pickBird(rng: Rng, rules: Pick<Archery, 'birds'>, mix: Archery['flocks'][number]['mix']) {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.range(0, total);
  let picked = mix[mix.length - 1]?.bird;
  for (const entry of mix) {
    roll -= entry.weight;
    if (roll < 0) {
      picked = entry.bird;
      break;
    }
  }
  const bird = rules.birds.find((entry) => entry.id === picked);
  if (!bird) throw new Error(`Unknown bird "${String(picked)}"`);
  return bird;
}

/**
 * Every bird of a round, from its seed and the Archery level: a flock at each of the round's
 * `flockAt`, its size and kinds from the level's flock, each bird entering a little after the
 * last, all from one side.
 */
export function planBirds(
  rules: Pick<Archery, 'round' | 'flocks' | 'birds'>,
  level: number,
  seed: number,
): BirdPlan[] {
  const rng = new Rng(`${String(seed)}:flocks`);
  const flock = flockFor(rules, level);
  const plans: BirdPlan[] = [];
  rules.round.flockAt.forEach((at, flockIndex) => {
    const count = rng.int(flock.birds.min, flock.birds.max);
    const dir = rng.chance(0.5) ? 1 : -1;
    let enterAt = at;
    for (let index = 0; index < count; index++) {
      const bird = pickBird(rng, rules, flock.mix);
      plans.push({
        index: plans.length,
        flock: flockIndex,
        bird,
        enterAt,
        dir,
        altitude: rng.range(bird.altitude.min, bird.altitude.max),
        speed: rng.range(bird.speed.min, bird.speed.max),
        phase: rng.range(0, Math.PI * 2),
      });
      enterAt += rng.range(rules.round.birdGap.min, rules.round.birdGap.max);
    }
  });
  return plans;
}

/**
 * A bird's height `age` seconds after it entered: bobbing round its altitude (`straight`), or
 * swooping down from it and back up (`swoop`).
 */
export function heightAt(plan: BirdPlan, age: number): number {
  const { kind, amplitude, hz } = plan.bird.path;
  const turn = Math.PI * hz * age + plan.phase;
  if (kind === 'swoop') return plan.altitude - amplitude * Math.sin(turn) ** 2;
  return plan.altitude + amplitude * Math.sin(2 * turn);
}
