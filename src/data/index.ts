// Single source of truth: skills, items, recipes, stations, units, levels, tuning.
// Code reads these; it never repeats them.

import { camp } from './camp';
import { firemaking } from './firemaking';
import { items } from './items';
import { levels } from './levels';
import { recipes } from './recipes';
import { runner } from './runner';
import { splitting } from './splitting';
import type { GameData, GameDataInput } from './schema';
import { siege } from './siege';
import { skills } from './skills';
import { stations } from './stations';
import { tuning } from './tuning';
import { enemies, units } from './units';
import { warchest } from './warchest';
import { woodcutting } from './woodcutting';
import { workers } from './workers';
import { parseGameData } from './validate';

export * from './schema';
export { GameDataError, parseGameData } from './validate';
export * from './siegePieces';

export const rawGameData: GameDataInput = {
  skills,
  items,
  stations,
  recipes,
  units,
  enemies,
  levels,
  camp,
  woodcutting,
  runner,
  splitting,
  firemaking,
  siege,
  warchest,
  workers,
  tuning,
};

/** The validated game data. Throws a GameDataError if anything in src/data is wrong. */
export function loadGameData(): GameData {
  return parseGameData(rawGameData);
}

/** Looks up an entry by id, throwing if it doesn't exist. */
export function byId<T extends { id: string }>(list: readonly T[], id: string): T {
  const entry = list.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown id "${id}"`);
  return entry;
}
