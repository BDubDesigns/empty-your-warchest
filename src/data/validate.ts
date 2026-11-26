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
  const skills = ids('skills', data.skills);
  const itemIds = ids('items', data.items);
  const stations = ids('stations', data.stations);
  ids('recipes', data.recipes);
  const units = ids('units', data.units);
  const enemies = ids('enemies', data.enemies);
  ids('levels', data.levels);

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
        if (!itemIds.has(stack.item)) issue([...path, 'item'], `Unknown item "${stack.item}"`);
      });
    }
  });

  data.units.forEach((unit, index) => {
    const path = ['units', index, 'weapon'];
    if (!itemIds.has(unit.weapon.item)) {
      issue([...path, 'item'], `Unknown item "${unit.weapon.item}"`);
    }
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
          const guards = gate.guards;
          if (!guards) continue;
          if (!enemies.has(guards.enemy)) {
            issue([...eventPath, side, 'guards', 'enemy'], `Unknown enemy "${guards.enemy}"`);
          }
        }
      }
    });
    const walls = level.events.filter((event) => event.type === 'wall').length;
    if (walls !== 1 || level.events.at(-1)?.type !== 'wall') {
      issue([...path, 'events'], 'A level needs exactly one wall, as its last event');
    }
  });

  const workers = data.workers;
  if (!skills.has(workers.skill)) issue(['workers', 'skill'], `Unknown skill "${workers.skill}"`);
  const jobStations = new Set<string>();
  workers.jobs.forEach((job, index) => {
    const path = ['workers', 'jobs', index];
    const recipe = data.recipes.find((entry) => entry.id === job.recipe);
    if (!recipe) {
      issue([...path, 'recipe'], `Unknown recipe "${job.recipe}"`);
      return;
    }
    // One job per station: the station's workers are its crew.
    if (jobStations.has(recipe.station)) issue([...path, 'recipe'], 'One job per station');
    jobStations.add(recipe.station);
    job.extra.forEach((stack, stackIndex) => {
      if (!itemIds.has(stack.item)) {
        issue([...path, 'extra', stackIndex, 'item'], `Unknown item "${stack.item}"`);
      }
    });
  });
  const crew = workers.jobs.reduce((sum, job) => sum + job.start, 0);
  if (crew > workers.start) issue(['workers', 'jobs'], 'More workers start on jobs than you have');

  const firemaking = data.firemaking;
  if (!data.recipes.some((recipe) => recipe.id === firemaking.recipe)) {
    issue(['firemaking', 'recipe'], `Unknown recipe "${firemaking.recipe}"`);
  }
  if (!itemIds.has(firemaking.fuel)) {
    issue(['firemaking', 'fuel'], `Unknown item "${firemaking.fuel}"`);
  }
  const sizes = firemaking.rack.sizes;
  if (!sizes.some((size) => size.level === 1)) {
    issue(['firemaking', 'rack', 'sizes'], 'At least one rack size must be open from level 1');
  }
  sizes.forEach((size, index) => {
    const before = sizes[index - 1];
    if (before && (size.spots <= before.spots || size.level < before.level)) {
      issue(['firemaking', 'rack', 'sizes', index], 'Sizes must grow, in level order');
    }
    if (size.answerLogs.min > size.answerLogs.max) {
      issue(['firemaking', 'rack', 'sizes', index, 'answerLogs'], 'min must not be more than max');
    }
    if (size.answerLogs.max > size.spots * size.logsPerSpot) {
      issue(
        ['firemaking', 'rack', 'sizes', index, 'answerLogs', 'max'],
        'More logs than the spots can hold',
      );
    }
  });
  if (firemaking.generator.minHeat >= firemaking.generator.flat) {
    issue(['firemaking', 'generator', 'minHeat'], 'Must be under the flat fire');
  }
  if (firemaking.feel.smokeWisps >= firemaking.feel.smokeThick) {
    issue(['firemaking', 'feel', 'smokeWisps'], 'Wisps must come before thick smoke');
  }

  const splitting = data.splitting;
  if (!data.recipes.some((recipe) => recipe.id === splitting.recipe)) {
    issue(['splitting', 'recipe'], `Unknown recipe "${splitting.recipe}"`);
  }
  const counts = new Set<number>();
  splitting.cutters.forEach((cutter, index) => {
    if (counts.has(cutter.count)) {
      issue(['splitting', 'cutters', index, 'count'], `Duplicate head ${String(cutter.count)}`);
    }
    counts.add(cutter.count);
  });
  if (!splitting.cutters.some((cutter) => cutter.level === 1)) {
    issue(['splitting', 'cutters'], 'At least one head must be open from level 1');
  }
  const steps = 360 / splitting.turnStep;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) {
    issue(['splitting', 'turnStep'], 'Must go into 360 a whole number of times');
  }
  if (splitting.feel.pumpsFew > splitting.feel.pumpsMany) {
    issue(['splitting', 'feel', 'pumpsFew'], 'The fewest-piece head must not need more strokes');
  }
  if (splitting.stars.one > splitting.stars.two || splitting.stars.two > splitting.stars.three) {
    issue(['splitting', 'stars'], 'More stars must not need less');
  }
  const kinds = new Set<string>();
  splitting.grainKinds.forEach((kind, index) => {
    if (kinds.has(kind.id))
      issue(['splitting', 'grainKinds', index, 'id'], `Duplicate id "${kind.id}"`);
    kinds.add(kind.id);
  });
  splitting.tutorialLog.grains.forEach((grain, index) => {
    if (!kinds.has(grain.kind)) {
      issue(['splitting', 'tutorialLog', 'grains', index, 'kind'], `Unknown grain "${grain.kind}"`);
    }
  });
  const splittingGenerator = splitting.generator;
  for (const key of [
    'radius',
    'height',
    'rings',
    'good',
    'bad',
    'knots',
    'knotWidth',
    'nearGap',
  ] as const) {
    if (splittingGenerator[key].min > splittingGenerator[key].max) {
      issue(['splitting', 'generator', key], 'min must not be more than max');
    }
  }
  // A grain wider than the fewest-piece head's wedges could never be kept.
  const widest = 360 / Math.min(...splitting.cutters.map((cutter) => cutter.count));
  splitting.grainKinds.forEach((kind, index) => {
    if (kind.width.min > kind.width.max) {
      issue(['splitting', 'grainKinds', index, 'width'], 'min must not be more than max');
    }
    if (kind.width.max >= widest) {
      issue(['splitting', 'grainKinds', index, 'width', 'max'], 'Too wide for any head to keep');
    }
  });
  if (
    splittingGenerator.good.max > 0 &&
    !splitting.grainKinds.some((kind) => kind.multiplier > 1)
  ) {
    issue(['splitting', 'generator', 'good'], 'Good grains need a kind with a multiplier over 1');
  }
  if (splittingGenerator.bad.max > 0 && !splitting.grainKinds.some((kind) => kind.multiplier < 1)) {
    issue(['splitting', 'generator', 'bad'], 'Bad grains need a kind with a multiplier under 1');
  }

  const runner = data.runner;
  if (!data.levels.some((level) => level.id === runner.level)) {
    issue(['runner', 'level'], `Unknown level "${runner.level}"`);
  }
  data.enemies.forEach((enemy, index) => {
    if (!units.has(enemy.unit)) issue(['enemies', index, 'unit'], `Unknown unit "${enemy.unit}"`);
  });
  if (runner.feel.tradeMinSeconds > runner.feel.tradeSeconds) {
    issue(['runner', 'feel', 'tradeMinSeconds'], 'Must not be more than tradeSeconds');
  }

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
    clearing.boulders.forEach((boulder, boulderIndex) => {
      if (treeIds.has(boulder.id))
        issue([...path, 'boulders', boulderIndex, 'id'], `Duplicate id "${boulder.id}"`);
      treeIds.add(boulder.id);
      if (boulder.x > clearing.width || boulder.y > clearing.height) {
        issue(
          [...path, 'boulders', boulderIndex],
          `Boulder "${boulder.id}" is outside the clearing`,
        );
      }
    });
    const cabin = clearing.cabin;
    if (
      cabin &&
      (cabin.x - cabin.width / 2 < 0 ||
        cabin.y - cabin.depth / 2 < 0 ||
        cabin.x + cabin.width / 2 > clearing.width ||
        cabin.y + cabin.depth / 2 > clearing.height)
    ) {
      issue([...path, 'cabin'], 'The cabin is outside the clearing');
    }
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
  if (generator.boulders.count.min > generator.boulders.count.max) {
    issue(['woodcutting', 'generator', 'boulders', 'count'], 'min must not be more than max');
  }
  let lastUnlock = 0;
  woodcutting.unlocks.forEach((unlock, index) => {
    const path = ['woodcutting', 'unlocks', index];
    if (unlock.level < lastUnlock) issue([...path, 'level'], 'Unlocks must be in level order');
    if (unlock.level > data.tuning.xpCurve.maxLevel) {
      issue([...path, 'level'], `Level ${String(unlock.level)} is past the max level`);
    }
    if (unlock.trees && unlock.trees.min > unlock.trees.max) {
      issue([...path, 'trees'], 'min must not be more than max');
    }
    lastUnlock = unlock.level;
  });
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
  // The scenery is laid out round the tutorial clearing (every clearing shares its size).
  const scenery = woodcutting.scenery;
  const size = woodcutting.clearings.find((entry) => entry.id === woodcutting.tutorialClearing);
  scenery.plants.forEach((plant, index) => {
    if (plant.height.min > plant.height.max) {
      issue(['woodcutting', 'scenery', 'plants', index, 'height'], 'min must not be more than max');
    }
  });
  for (const key of ['forest', 'birds'] as const) {
    const range = key === 'forest' ? scenery.forest.height : scenery.birds.flock;
    if (range.min > range.max)
      issue(['woodcutting', 'scenery', key], 'min must not be more than max');
  }
  if (size) {
    const outside = (x: number, y: number, reach: number) =>
      x + reach < 0 || y + reach < 0 || x - reach > size.width || y - reach > size.height;
    const { woodpile, block, track } = scenery;
    if (!outside(woodpile.x, woodpile.y, woodpile.length / 2)) {
      issue(['woodcutting', 'scenery', 'woodpile'], 'The woodpile must be outside the fence');
    }
    if (!outside(block.x, block.y, block.radius)) {
      issue(['woodcutting', 'scenery', 'block'], 'The chopping block must be outside the fence');
    }
    if (track.x - track.width / 2 < 0 || track.x + track.width / 2 > size.width) {
      issue(['woodcutting', 'scenery', 'track'], 'The track must meet the fence');
    }
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
