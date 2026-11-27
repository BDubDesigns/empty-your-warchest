import { z } from 'zod';
import { gameDataShape, type GameData, type SiegeObjective, type SiegePosition } from './schema';

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
  if (!itemIds.has(firemaking.ash.item)) {
    issue(['firemaking', 'ash', 'item'], `Unknown item "${firemaking.ash.item}"`);
  }

  // Brewing (the answer check, with the colour maths, runs at boot: see checkBrews).
  const brewing = data.brewing;
  const shelf = new Set<string>();
  brewing.ingredients.forEach((ingredient, index) => {
    if (!itemIds.has(ingredient.item)) {
      issue(['brewing', 'ingredients', index, 'item'], `Unknown item "${ingredient.item}"`);
    }
    if (shelf.has(ingredient.item)) issue(['brewing', 'ingredients', index, 'item'], 'Twice');
    shelf.add(ingredient.item);
  });
  brewing.potions.forEach((potion, index) => {
    const recipe = data.recipes.find((entry) => entry.id === potion.recipe);
    if (!recipe)
      issue(['brewing', 'potions', index, 'recipe'], `Unknown recipe "${potion.recipe}"`);
    else if (recipe.inputs.length > 0) {
      issue(['brewing', 'potions', index, 'recipe'], 'A brew takes what went into the pot');
    }
  });
  const span = (range: { min: number; max: number }) => range.min <= range.max;
  const overlap = (one: { min: number; max: number }, other: { min: number; max: number }) =>
    one.min <= other.max && other.min <= one.max;
  brewing.potions.forEach((potion, index) => {
    for (const key of ['L', 'chroma', 'hue'] as const) {
      if (!span(potion.region[key])) {
        issue(['brewing', 'potions', index, 'region', key], 'min must not be more than max');
      }
    }
    if (potion.region.L.max > 1) {
      issue(['brewing', 'potions', index, 'region', 'L'], 'Lightness runs 0–1');
    }
    brewing.potions.slice(0, index).forEach((other, before) => {
      const hue = (range: { min: number; max: number }, turn: number) => ({
        min: range.min + turn,
        max: range.max + turn,
      });
      const hues = [-360, 0, 360].some((turn) =>
        overlap(potion.region.hue, hue(other.region.hue, turn)),
      );
      if (
        hues &&
        overlap(potion.region.L, other.region.L) &&
        overlap(potion.region.chroma, other.region.chroma)
      ) {
        issue(
          ['brewing', 'potions', index, 'region'],
          `Overlaps potion ${String(before)}'s region`,
        );
      }
    });
  });
  if (!(brewing.stars.three <= brewing.stars.two && brewing.stars.two <= brewing.stars.one)) {
    issue(['brewing', 'stars'], 'Bands must widen from three stars to one');
  }
  if (brewing.advice.much < brewing.advice.spotOn) {
    issue(['brewing', 'advice', 'much'], 'Must not be less than spotOn');
  }
  if ((brewing.icons.outline + brewing.icons.halo) * 4 > brewing.icons.px) {
    issue(['brewing', 'icons'], 'The outline would leave no room for the item');
  }
  data.newGame.inventory.forEach((stack, index) => {
    if (!itemIds.has(stack.item)) {
      issue(['newGame', 'inventory', index, 'item'], `Unknown item "${stack.item}"`);
    }
  });

  // Foraging in woodcutting.
  const forage = data.woodcutting.forage;
  for (const key of ['mossyTrees', 'mushroomTrees', 'mossyBoulders', 'patches'] as const) {
    const entry = forage[key];
    if (!itemIds.has(entry.item)) {
      issue(['woodcutting', 'forage', key, 'item'], `Unknown item "${entry.item}"`);
    }
    if (entry.count.min > entry.count.max) {
      issue(['woodcutting', 'forage', key, 'count'], 'min must not be more than max');
    }
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

  checkSiege(data, issue);
  checkArchery(data, itemIds, issue);

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

/** Blocks closer than this (metres) count as touching: data is typed by hand. */
const TOUCH = 1e-6;

/**
 * The siege's forts must stand on their own: every block rests on the ground or on blocks
 * directly under it, with its middle over what holds it up (or it would tip), and no two blocks
 * overlap (the physics would push them apart the moment the round starts).
 */
function checkSiege(data: GameData, issue: (path: Path, message: string) => void): void {
  const siege = data.siege;
  if (!data.items.some((item) => item.id === siege.item)) {
    issue(['siege', 'item'], `Unknown item "${siege.item}"`);
  }
  const weapons = new Set<string>();
  siege.weapons.forEach((weapon, index) => {
    const path = ['siege', 'weapons', index];
    if (weapons.has(weapon.id)) issue([...path, 'id'], `Duplicate id "${weapon.id}"`);
    weapons.add(weapon.id);
    if (!data.skills.some((skill) => skill.id === weapon.skill)) {
      issue([...path, 'skill'], `Unknown skill "${weapon.skill}"`);
    }
    const { tilt } = weapon;
    if (tilt.min >= tilt.max || tilt.start < tilt.min || tilt.start > tilt.max) {
      issue([...path, 'tilt'], 'Needs min under max, and start between them');
    }
  });
  if (!weapons.has(siege.weapon)) issue(['siege', 'weapon'], `Unknown weapon "${siege.weapon}"`);
  const materials = new Set<string>();
  siege.materials.forEach((material, index) => {
    if (materials.has(material.id)) {
      issue(['siege', 'materials', index, 'id'], `Duplicate id "${material.id}"`);
    }
    materials.add(material.id);
  });
  const forts = new Set<string>();
  siege.forts.forEach((fort, fortIndex) => {
    const path = ['siege', 'forts', fortIndex];
    if (forts.has(fort.id)) issue([...path, 'id'], `Duplicate id "${fort.id}"`);
    forts.add(fort.id);
    fort.pieces.forEach((piece, pieceIndex) => {
      const at = [...path, 'pieces', pieceIndex];
      if (piece.kind === 'wall') {
        piece.windows.forEach((window, windowIndex) => {
          if (
            window.from + window.width > piece.length ||
            window.sill + window.courses >= piece.courses
          ) {
            issue(
              [...at, 'windows', windowIndex],
              'A window must fit in its wall, with a course over it for the lintel',
            );
          }
        });
      }
      if ('watch' in piece && piece.watch === 'patrol' && piece.kind !== 'walkway') {
        issue([...at, 'watch'], 'Only a guard on a walkway can patrol');
      }
      if ('material' in piece && !materials.has(piece.material)) {
        issue([...at, 'material'], `Unknown material "${piece.material}"`);
      }
      if ('guard' in piece && piece.guard !== undefined && piece.guard >= fort.positions.length) {
        issue([...at, 'guard'], `No position ${String(piece.guard)} to guard`);
      }
    });
    const banners = fort.blocks.filter((block) => block.banner);
    if (banners.length > 1) issue([...path, 'blocks'], 'A fort has one banner at most');
    const banner = banners[0];
    const last = fort.positions.length - 1;
    if (fort.positions[last]?.objective.kind !== 'banner_down') {
      issue([...path, 'positions', last, 'objective'], 'The last position brings the banner down');
    }
    // Each kind of objective checks what it needs.
    const objectives: {
      [K in SiegeObjective['kind']]: (
        objective: Extract<SiegeObjective, { kind: K }>,
        position: SiegePosition,
        at: Path,
      ) => void;
    } = {
      guards_down: (_, position, at) => {
        if (position.guards.length === 0) issue(at, 'Bringing the guards down needs guards');
      },
      banner_down: (objective, _, at) => {
        const height = objective.height ?? siege.banner.winHeight;
        if (!banner) issue(at, 'Bringing the banner down needs a banner');
        else if (banner.at[1] <= height) issue(at, 'The banner must start above the win height');
      },
    };
    fort.positions.forEach((position, positionIndex) => {
      const at = [...path, 'positions', positionIndex];
      objectives[position.objective.kind](position.objective as never, position, [
        ...at,
        'objective',
      ]);
    });

    type Box = { min: number[]; max: number[] };
    const overlap = (a: Box, b: Box, axis: number) =>
      Math.min(a.max[axis] ?? 0, b.max[axis] ?? 0) - Math.max(a.min[axis] ?? 0, b.min[axis] ?? 0);
    const boxes: Box[] = fort.blocks.map((block) => ({
      min: block.at.map((value, axis) => value - (block.size[axis] ?? 0) / 2),
      max: block.at.map((value, axis) => value + (block.size[axis] ?? 0) / 2),
    }));
    /** Why a box can't stand where it is, if it can't: floating, or overhanging what holds it. */
    const unsupported = (own: Box): string | undefined => {
      const bottom = own.min[1] ?? 0;
      if (Math.abs(bottom) <= TOUCH) return undefined;
      // What it stands on: blocks whose tops meet its bottom, under part of it.
      const under = boxes.filter(
        (other) =>
          Math.abs((other.max[1] ?? 0) - bottom) <= TOUCH &&
          overlap(own, other, 0) > TOUCH &&
          overlap(own, other, 2) > TOUCH,
      );
      if (under.length === 0) return 'Floats: it must rest on the ground or on a block';
      const span = (axis: number) => ({
        min: Math.min(...under.map((other) => Math.max(other.min[axis] ?? 0, own.min[axis] ?? 0))),
        max: Math.max(...under.map((other) => Math.min(other.max[axis] ?? 0, own.max[axis] ?? 0))),
      });
      const middle = (axis: number) => ((own.min[axis] ?? 0) + (own.max[axis] ?? 0)) / 2;
      const x = span(0);
      const z = span(2);
      if (middle(0) < x.min || middle(0) > x.max || middle(2) < z.min || middle(2) > z.max) {
        return 'Overhangs: its middle must be over what holds it up';
      }
      return undefined;
    };
    fort.blocks.forEach((block, index) => {
      const blockPath = [...path, 'blocks', index];
      if (!materials.has(block.material)) {
        issue([...blockPath, 'material'], `Unknown material "${block.material}"`);
      }
      const own = boxes[index];
      if (!own) return;
      boxes.forEach((other, otherIndex) => {
        if (otherIndex <= index) return;
        if ([0, 1, 2].every((axis) => overlap(own, other, axis) > TOUCH)) {
          issue(blockPath, `Overlaps block ${String(otherIndex)}`);
        }
      });
      const problem = unsupported(own);
      if (problem) issue(blockPath, problem);
    });
    // Guards stand on the ground or on blocks, clear of every block and each other.
    const [width, height, depth] = siege.guard.size;
    const guards = fort.positions.flatMap((position, positionIndex) =>
      position.guards.map((guard, guardIndex) => ({
        path: [...path, 'positions', positionIndex, 'guards', guardIndex],
        box: {
          min: [guard.at[0] - width / 2, guard.at[1], guard.at[2] - depth / 2],
          max: [guard.at[0] + width / 2, guard.at[1] + height, guard.at[2] + depth / 2],
        },
      })),
    );
    guards.forEach((guard, index) => {
      const hits = [...boxes, ...guards.slice(index + 1).map((other) => other.box)].some((other) =>
        [0, 1, 2].every((axis) => overlap(guard.box, other, axis) > TOUCH),
      );
      if (hits) issue(guard.path, 'Overlaps a block or another guard');
      const problem = unsupported(guard.box);
      if (problem) issue(guard.path, problem);
    });
  });
  if (siege.stars.three > siege.stars.two) {
    issue(['siege', 'stars'], 'Three stars must not allow more throws than two');
  }
}

/** The bird hunt: its birds, flocks and arrows point at real things, and its ranges make sense. */
function checkArchery(
  data: GameData,
  itemIds: ReadonlySet<string>,
  issue: (path: Path, message: string) => void,
): void {
  const archery = data.archery;
  const range = (path: Path, value: { min: number; max: number }) => {
    if (value.min > value.max) issue(path, 'min must not be more than max');
  };
  const birds = new Set<string>();
  archery.birds.forEach((bird, index) => {
    const path = ['archery', 'birds', index];
    if (birds.has(bird.id)) issue([...path, 'id'], `Duplicate id "${bird.id}"`);
    birds.add(bird.id);
    if (!itemIds.has(bird.seed)) issue([...path, 'seed'], `Unknown item "${bird.seed}"`);
    range([...path, 'seeds'], bird.seeds);
    range([...path, 'speed'], bird.speed);
    range([...path, 'altitude'], bird.altitude);
    if (bird.altitude.max > archery.field.height) {
      issue([...path, 'altitude', 'max'], 'Above the field');
    }
    if (bird.speed.min <= 0) issue([...path, 'speed', 'min'], 'A bird must move');
  });
  archery.flocks.forEach((flock, index) => {
    const path = ['archery', 'flocks', index];
    const before = archery.flocks[index - 1];
    if (before && flock.level <= before.level)
      issue([...path, 'level'], 'Flocks must be in level order');
    range([...path, 'birds'], flock.birds);
    flock.mix.forEach((entry, mixIndex) => {
      if (!birds.has(entry.bird)) {
        issue([...path, 'mix', mixIndex, 'bird'], `Unknown bird "${entry.bird}"`);
      }
    });
  });
  if (archery.flocks[0]?.level !== 1) {
    issue(['archery', 'flocks'], 'The first flock must be open from level 1');
  }
  const arrows = new Set<string>();
  archery.arrows.forEach((arrow, index) => {
    const path = ['archery', 'arrows', index, 'item'];
    if (!itemIds.has(arrow.item)) issue(path, `Unknown item "${arrow.item}"`);
    if (arrows.has(arrow.item)) issue(path, 'Twice');
    arrows.add(arrow.item);
  });
  if (!itemIds.has(archery.feathers.item)) {
    issue(['archery', 'feathers', 'item'], `Unknown item "${archery.feathers.item}"`);
  }
  range(['archery', 'feathers', 'count'], archery.feathers.count);
  range(['archery', 'round', 'birdGap'], archery.round.birdGap);
  range(['archery', 'looks', 'treeDistance'], archery.looks.treeDistance);
  range(['archery', 'looks', 'treeHeight'], archery.looks.treeHeight);
  archery.round.flockAt.forEach((at, index) => {
    const before = archery.round.flockAt[index - 1];
    if (before !== undefined && at < before) {
      issue(['archery', 'round', 'flockAt', index], 'Flocks must set off in order');
    }
    if (at >= archery.round.seconds) {
      issue(['archery', 'round', 'flockAt', index], 'After the round is over');
    }
  });
  if (archery.aim.min >= archery.aim.max) issue(['archery', 'aim'], 'min must be under max');
  const { one, two, three } = archery.stars;
  if (one > two || two > three) issue(['archery', 'stars'], 'More stars must not need less');
  // The trees stand behind the field, so they never hide a bird or an arrow.
  if (archery.looks.treeDistance.min <= archery.looks.distance) {
    issue(['archery', 'looks', 'treeDistance', 'min'], 'The trees must stand behind the field');
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
