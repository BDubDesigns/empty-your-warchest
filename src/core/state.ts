import type { GameData } from '../data';
import type { Stack } from './inventory';
import { startingCrew, type WorkState } from './workers';

/** Everything that gets saved. */
export interface GameState {
  inventory: Stack[];
  /** Total XP per skill id. */
  skills: Record<string, number>;
  /** When the player was last in the game: time away counts from here. */
  lastSeenAt: number;
  /** The workers: where they are, what they're owed, and what they keep back. */
  work: WorkState;
  /** One-time things the player has done, e.g. 'tutorial.woodcutting'. */
  done: string[];
}

export function newGameState(data: GameData, now: number): GameState {
  return {
    inventory: data.newGame.inventory.map((stack) => ({ ...stack })),
    skills: Object.fromEntries(data.skills.map((skill) => [skill.id, 0])),
    lastSeenAt: now,
    work: { crew: startingCrew(data), carry: {}, minimums: {}, piles: {}, xp: {} },
    done: [],
  };
}
