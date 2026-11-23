import { z } from 'zod';
import { gameDataShape, type GameData } from './schema';

type Path = (string | number)[];

/** Checks that every reference between data files points at something that exists. */
function checkReferences(data: GameData, ctx: z.RefinementCtx): void {
  const issue = (path: Path, message: string): void => {
    ctx.addIssue({ code: 'custom', path, message });
  };

  const ids = (key: keyof GameData, list: readonly { id: string }[]) => {
    const seen = new Set<string>();
    list.forEach((entry, index) => {
      if (seen.has(entry.id)) issue([key, index, 'id'], `Duplicate id "${entry.id}"`);
      seen.add(entry.id);
    });
    return seen;
  };
  const qualities = ids('qualities', data.qualities);
  const skills = ids('skills', data.skills);
  const itemIds = ids('items', data.items);
  const stations = ids('stations', data.stations);
  ids('recipes', data.recipes);
  const units = ids('units', data.units);
  const enemies = ids('enemies', data.enemies);
  ids('levels', data.levels);

  const tiered = new Set(data.items.filter((item) => item.tiered).map((item) => item.id));

  const coversAllQualities = (path: Path, record: Record<string, number>): void => {
    for (const quality of qualities) {
      if (!(quality in record)) issue(path, `Missing a value for quality "${quality}"`);
    }
    for (const key of Object.keys(record)) {
      if (!qualities.has(key)) issue(path, `Unknown quality "${key}"`);
    }
  };

  data.stations.forEach((station, index) => {
    if (!skills.has(station.skill)) {
      issue(['stations', index, 'skill'], `Unknown skill "${station.skill}"`);
    }
  });

  data.recipes.forEach((recipe, index) => {
    if (!stations.has(recipe.station)) {
      issue(['recipes', index, 'station'], `Unknown station "${recipe.station}"`);
    }
    for (const side of ['inputs', 'outputs'] as const) {
      recipe[side].forEach((stack, stackIndex) => {
        const path = ['recipes', index, side, stackIndex];
        if (!itemIds.has(stack.item)) {
          issue([...path, 'item'], `Unknown item "${stack.item}"`);
          return;
        }
        if (stack.quality !== undefined) {
          if (!tiered.has(stack.item)) {
            issue([...path, 'quality'], `"${stack.item}" has no quality tiers`);
          } else if (!qualities.has(stack.quality)) {
            issue([...path, 'quality'], `Unknown quality "${stack.quality}"`);
          }
        } else if (side === 'inputs' && tiered.has(stack.item)) {
          issue([...path, 'quality'], `Tiered input "${stack.item}" needs a quality`);
        }
      });
    }
  });

  data.units.forEach((unit, index) => {
    const path = ['units', index, 'weapon'];
    if (!itemIds.has(unit.weapon.item)) {
      issue([...path, 'item'], `Unknown item "${unit.weapon.item}"`);
    } else if (!tiered.has(unit.weapon.item)) {
      issue([...path, 'item'], `Weapon "${unit.weapon.item}" must be a tiered item`);
    }
    coversAllQualities([...path, 'damageByQuality'], unit.weapon.damageByQuality);
  });

  data.levels.forEach((level, index) => {
    const path = ['levels', index];
    if (!units.has(level.unit)) issue([...path, 'unit'], `Unknown unit "${level.unit}"`);
    let previousAt = -1;
    level.events.forEach((event, eventIndex) => {
      const eventPath = [...path, 'events', eventIndex];
      if (event.at < previousAt) issue([...eventPath, 'at'], 'Events must be in track order');
      previousAt = event.at;
      if (event.type === 'enemies' && !enemies.has(event.enemy)) {
        issue([...eventPath, 'enemy'], `Unknown enemy "${event.enemy}"`);
      }
      if (event.type === 'gates') {
        for (const side of ['left', 'right'] as const) {
          const gate = event[side];
          if (gate.flippable && (gate.op === 'add' || gate.op === 'multiply')) {
            issue([...eventPath, side], 'Only negative gates (subtract, divide) can be flippable');
          }
        }
      }
    });
    const walls = level.events.filter((event) => event.type === 'wall').length;
    if (walls !== 1 || level.events.at(-1)?.type !== 'wall') {
      issue([...path, 'events'], 'A level needs exactly one wall, as its last event');
    }
  });

  coversAllQualities(['tuning', 'weaponRecoveryOnWin'], data.tuning.weaponRecoveryOnWin);

  const woodcutting = data.woodcutting;
  if (!data.recipes.some((recipe) => recipe.id === woodcutting.recipe)) {
    issue(['woodcutting', 'recipe'], `Unknown recipe "${woodcutting.recipe}"`);
  }
  woodcutting.clearings.forEach((clearing, index) => {
    const path = ['woodcutting', 'clearings', index];
    const treeIds = new Set<string>();
    clearing.trees.forEach((tree, treeIndex) => {
      if (treeIds.has(tree.id))
        issue([...path, 'trees', treeIndex, 'id'], `Duplicate tree "${tree.id}"`);
      treeIds.add(tree.id);
      if (tree.x > clearing.width || tree.y > clearing.height) {
        issue([...path, 'trees', treeIndex], `Tree "${tree.id}" is outside the clearing`);
      }
    });
  });
  if (!woodcutting.clearings.some((clearing) => clearing.id === woodcutting.tutorialClearing)) {
    issue(
      ['woodcutting', 'tutorialClearing'],
      `Unknown clearing "${woodcutting.tutorialClearing}"`,
    );
  }
  const generator = woodcutting.generator;
  for (const key of ['trees', 'height', 'forkSpread'] as const) {
    if (generator[key].min > generator[key].max) {
      issue(['woodcutting', 'generator', key], 'min must not be more than max');
    }
  }
  if (woodcutting.stars.two > woodcutting.stars.three) {
    issue(['woodcutting', 'stars'], 'Two stars must not need more than three');
  }
  const feel = woodcutting.feel;
  if (feel.perfectWindow > feel.timingWindow) {
    issue(
      ['woodcutting', 'feel', 'perfectWindow'],
      'The perfect window must fit inside the timing window',
    );
  }
  if (feel.perfectWindowLight > feel.timingWindow) {
    issue(
      ['woodcutting', 'feel', 'perfectWindowLight'],
      'The yellow zone must fit inside the green one',
    );
  }
  if (feel.timingWindow >= 1) {
    issue(['woodcutting', 'feel', 'timingWindow'], 'The green zone must be narrower than the bar');
  }
}

export const gameDataSchema = gameDataShape.superRefine(checkReferences);

export class GameDataError extends Error {
  override name = 'GameDataError';
}

/** Validates raw game data. Bad data throws with every problem listed, so it fails loudly at startup. */
export function parseGameData(raw: unknown): GameData {
  const result = gameDataSchema.safeParse(raw);
  if (!result.success) {
    throw new GameDataError(`Game data is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
