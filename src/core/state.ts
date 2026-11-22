import type { GameData } from '../data';
import type { Stack } from './inventory';

/** Everything that gets saved. */
export interface GameState {
  inventory: Stack[];
  /** Total XP per skill id. */
  skills: Record<string, number>;
  /** When the player was last in the game. Idle progress (M6) counts from here. */
  lastSeenAt: number;
}

export function newGameState(data: GameData, now: number): GameState {
  return {
    inventory: [],
    skills: Object.fromEntries(data.skills.map((skill) => [skill.id, 0])),
    lastSeenAt: now,
  };
}
