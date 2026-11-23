import { byId, type GameData } from '../../../data';

type WoodcuttingData = GameData['woodcutting'];
export type WoodcuttingUnlock = WoodcuttingData['unlocks'][number];

/** How random clearings are made at a woodcutting level: the generator, changed by every unlock reached. */
export function forestAt(woodcutting: WoodcuttingData, level: number) {
  let { trees, forkedShare } = woodcutting.generator;
  for (const unlock of woodcutting.unlocks) {
    if (unlock.level > level) break;
    trees = unlock.trees ?? trees;
    forkedShare = unlock.forkedShare ?? forkedShare;
  }
  return { trees, forkedShare };
}

/** Whether the fast-fall switch is unlocked at this level. */
export function fastFallUnlocked(woodcutting: WoodcuttingData, level: number): boolean {
  return woodcutting.unlocks.some((unlock) => unlock.fastFall && unlock.level <= level);
}

/** Unlocks reached going from level `from` up to `to` (e.g. after a level-up), in order. */
export function unlocksBetween(
  woodcutting: WoodcuttingData,
  from: number,
  to: number,
): WoodcuttingUnlock[] {
  return woodcutting.unlocks.filter((unlock) => unlock.level > from && unlock.level <= to);
}

/** The skill woodcutting trains: the felling recipe's station's skill. */
export function woodcuttingSkill(data: GameData): string {
  const recipe = byId(data.recipes, data.woodcutting.recipe);
  return byId(data.stations, recipe.station).skill;
}
