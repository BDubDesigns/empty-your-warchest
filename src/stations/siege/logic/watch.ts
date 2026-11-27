import type { Rng } from '../../../core';
import type { Siege, SiegeGuard } from '../../../data';

// How a guard keeps watch, and what he does once something alerts him: pure rules, stepped with
// the round's fixed steps and its seeded random numbers, so a round replays exactly.

/**
 * On watch: standing, walking his walkway, or asleep. Woken: standing and looking round a moment.
 * Alerted: on a walkway, pacing from cover to cover; anywhere else, standing ready.
 */
export type GuardMode = 'stand' | 'patrol' | 'sleep' | 'waking' | 'alert';

/** A guard's feet along his walkway (x), and what he's about. */
export interface Walker {
  mode: GuardMode;
  x: number;
  /** Which way he's walking (patrol): +1 or -1. */
  heading: 1 | -1;
  /** Seconds left of what he's doing now: a pause at the end of his walk, waking, ducking … */
  timer: number;
  /** Alerted on a walkway: dashing to `to`, ducked behind the wall, or leaning out. */
  step: 'dash' | 'duck' | 'lean';
  to: number;
  /** How far down he's ducked (0 standing, 1 all the way). */
  ducked: number;
}

type Moves = Siege['guardMoves'];

/** How fast a guard ducks down or stands up (of the way a second). */
const DUCK_RATE = 5;
/** The least an alerted guard dashes before ducking again (m). */
const LEAST_DASH = 1.5;

/** A guard as he starts the round: where the fort puts him, a walker heading either way. */
export function startWalker(mode: GuardMode, x: number, rng: Rng): Walker {
  return {
    mode,
    // Where the fort puts him, so the fort's checks see him as the round starts.
    x,
    heading: rng.next() < 0.5 ? -1 : 1,
    timer: 0,
    step: 'dash',
    to: x,
    ducked: 0,
  };
}

/** Whether the walker moves under his own steam (walking or pacing his walkway). */
export function walking(walker: Walker, walk: [number, number] | undefined): boolean {
  return walk !== undefined && (walker.mode === 'patrol' || walker.mode === 'alert');
}

/** He's heard something: a sleeper wakes, anyone on watch is alerted. Returns whether he was. */
export function alert(walker: Walker, moves: Moves): boolean {
  if (walker.mode === 'sleep') {
    walker.mode = 'waking';
    walker.timer = moves.wakeSeconds;
    return true;
  }
  if (walker.mode === 'stand' || walker.mode === 'patrol') {
    // A beat where he is, looking out, before he moves.
    walker.mode = 'alert';
    walker.step = 'lean';
    walker.to = walker.x;
    walker.timer = moves.alertLean;
    return true;
  }
  return false;
}

/** One step (`dt` seconds) of what the guard does. */
export function stepWalker(
  walker: Walker,
  guard: Pick<SiegeGuard, 'walk' | 'cover' | 'gap'>,
  moves: Moves,
  dt: number,
  rng: Rng,
): void {
  const { walk } = guard;
  if (walker.mode === 'waking') {
    walker.timer -= dt;
    if (walker.timer <= 0) {
      walker.mode = 'alert';
      walker.step = 'lean';
      walker.to = walker.x;
      walker.timer = 0;
    }
  } else if (walker.mode === 'patrol' && walk) {
    if (walker.timer > 0) walker.timer -= dt;
    else {
      walker.x += walker.heading * moves.patrolSpeed * dt;
      const [from, to] = walk;
      if (walker.x <= from || walker.x >= to) {
        walker.x = Math.min(Math.max(walker.x, from), to);
        walker.heading = walker.heading === 1 ? -1 : 1;
        walker.timer = moves.patrolPause;
      }
    }
  } else if (walker.mode === 'alert' && walk) {
    const [from, to] = walk;
    const stride = moves.alertSpeed * dt;
    // Toward where he's going, at a dash; true once he's there.
    const go = () => {
      const gap = walker.to - walker.x;
      if (Math.abs(gap) <= stride) {
        walker.x = walker.to;
        return true;
      }
      walker.x += Math.sign(gap) * stride;
      return false;
    };
    if (walker.step === 'dash') {
      // Into cover behind a merlon, then down.
      if (go()) {
        walker.step = 'duck';
        walker.timer = moves.alertPause;
      }
    } else if (walker.step === 'duck') {
      walker.timer -= dt;
      if (walker.timer <= 0) {
        // Up, and a step out into the gap beside the merlon, for a look (and a shot at him).
        walker.step = 'lean';
        walker.timer = moves.alertLean;
        const side = guard.gap ?? 0;
        const out = walker.x + (rng.next() < 0.5 ? -side : side);
        walker.to = out < from || out > to ? walker.x - (out - walker.x) : out;
        walker.to = Math.min(Math.max(walker.to, from), to);
      }
    } else {
      go();
      walker.timer -= dt;
      if (walker.timer <= 0) {
        // Off to other cover, a fair way along.
        walker.step = 'dash';
        const cover = (guard.cover ?? []).filter((x) => Math.abs(x - walker.x) >= LEAST_DASH);
        const pick = cover.length > 0 ? cover[Math.floor(rng.next() * cover.length)] : undefined;
        walker.to = pick ?? Math.min(Math.max(rng.range(from, to), from), to);
      }
    }
  }
  const down = walker.mode === 'alert' && walker.step === 'duck' ? 1 : 0;
  walker.ducked +=
    Math.sign(down - walker.ducked) * Math.min(Math.abs(down - walker.ducked), DUCK_RATE * dt);
}
