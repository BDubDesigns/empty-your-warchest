import { Rng } from '../../core/rng';
import type { GateOp, Level, Roll } from '../../data';

/** A gate as rolled for one run. */
export interface RolledGate {
  op: GateOp;
  value: number;
  guards?: { enemy: string; count: number; armed: number };
}

/** A level event as rolled for one run: every number fixed. */
export type RolledEvent =
  | { type: 'gates'; at: number; left: RolledGate; right: RolledGate }
  | {
      type: 'enemies';
      at: number;
      enemy: string;
      count: number;
      armed: number;
      lane: 'both' | 'left' | 'right';
    }
  | {
      type: 'wall';
      at: number;
      hp: number;
      archers: { volleySeconds: number; perVolley: number };
    };

/** The largest value a roll can give at a Command level. */
export function rollMax(roll: Roll, level: number): number {
  if (typeof roll === 'number') return roll;
  return roll.min + Math.floor(roll.perLevel * Math.max(0, level - 1));
}

/** A whole number from the roll's min to its max at this level. */
export function rollValue(roll: Roll, level: number, rng: Rng): number {
  if (typeof roll === 'number') return roll;
  return rng.int(roll.min, rollMax(roll, level));
}

/**
 * Rolls a level template for one run: the same seed and Command level always give the same track.
 * Gate pairs marked `shuffle` swap sides at random, so the greedy side isn't always the same.
 */
export function rollLevel(
  level: Level,
  commandLevel: number,
  seed: number | string,
): RolledEvent[] {
  const rng = new Rng(seed);
  const roll = (value: Roll): number => rollValue(value, commandLevel, rng);
  const armedOf = (count: number, share: number): number =>
    Math.min(count, Math.round(count * share));
  return level.events.map((event): RolledEvent => {
    switch (event.type) {
      case 'gates': {
        const gate = (side: Level['events'][number] & { type: 'gates' }, key: 'left' | 'right') => {
          const base = side[key];
          const rolled: RolledGate = { op: base.op, value: roll(base.value) };
          if (base.guards) {
            const count = roll(base.guards.count);
            rolled.guards = {
              enemy: base.guards.enemy,
              count,
              armed: armedOf(count, base.guards.armedShare),
            };
          }
          return rolled;
        };
        const left = gate(event, 'left');
        const right = gate(event, 'right');
        const swap = event.shuffle && rng.chance(0.5);
        return {
          type: 'gates',
          at: event.at,
          left: swap ? right : left,
          right: swap ? left : right,
        };
      }
      case 'enemies': {
        const count = roll(event.count);
        return {
          type: 'enemies',
          at: event.at,
          enemy: event.enemy,
          count,
          armed: armedOf(count, event.armedShare),
          lane: event.lane,
        };
      }
      case 'wall':
        return { type: 'wall', at: event.at, hp: roll(event.hp), archers: event.archers };
    }
  });
}
