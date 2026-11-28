import { z } from 'zod';
import { castleProblems, layoutCastle, postSlots } from './castleLayout';
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
  checkFletching(data, itemIds, issue);
  // The castle holds together: its wall closes round the courtyard, its anchors are where they say.
  for (const problem of castleProblems(data.castle)) issue(problem.path, problem.message);

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

/**
 * The siege: what it shoots and drinks, its weapon, what the castle's parts are made of, and its
 * objectives (each one possible at this castle: its posts are the castle's, with room for its
 * guards). Its tiers draw shadows as the castle's do.
 */
function checkSiege(data: GameData, issue: (path: Path, message: string) => void): void {
  const siege = data.siege;
  for (const key of ['item', 'potion'] as const) {
    if (!data.items.some((item) => item.id === siege[key])) {
      issue(['siege', key], `Unknown item "${siege[key]}"`);
    }
  }
  const weapons = new Set<string>();
  siege.weapons.forEach((weapon, index) => {
    const path = ['siege', 'weapons', index];
    if (weapons.has(weapon.id)) issue([...path, 'id'], `Duplicate id "${weapon.id}"`);
    weapons.add(weapon.id);
    if (!data.skills.some((skill) => skill.id === weapon.skill)) {
      issue([...path, 'skill'], `Unknown skill "${weapon.skill}"`);
    }
    if (weapon.tilt.min >= weapon.tilt.max) issue([...path, 'tilt'], 'Needs min under max');
  });
  if (!weapons.has(siege.weapon)) issue(['siege', 'weapon'], `Unknown weapon "${siege.weapon}"`);
  const materials = new Set<string>();
  siege.materials.forEach((material, index) => {
    if (materials.has(material.id)) {
      issue(['siege', 'materials', index, 'id'], `Duplicate id "${material.id}"`);
    }
    materials.add(material.id);
  });
  for (const [kind, part] of Object.entries(siege.parts)) {
    if (!materials.has(part.material)) {
      issue(['siege', 'parts', kind, 'material'], `Unknown material "${part.material}"`);
    }
  }
  if (!materials.has(siege.bodies.solid)) {
    issue(['siege', 'bodies', 'solid'], `Unknown material "${siege.bodies.solid}"`);
  }
  for (const tier of ['high', 'low'] as const) {
    const map = siege.looks.tiers[tier].shadows === 'map';
    if (map !== data.castle.tiers[tier].shadows) {
      issue(
        ['siege', 'looks', 'tiers', tier, 'shadows'],
        'Shadows as the castle draws them on this tier: a map with its shadows, blobs without',
      );
    }
  }
  // The guards' and the captain's looks are characters, playing the characters' clips, and the
  // body each is drawn with fits in his box.
  const { characters } = data;
  const { skins } = siege;
  if (!characters.models.some((model) => model.id === skins.captain.character)) {
    issue(
      ['siege', 'skins', 'captain', 'character'],
      `Unknown character "${skins.captain.character}"`,
    );
  }
  for (const who of ['guard', 'captain'] as const) {
    for (const [use, clip] of Object.entries(skins[who].clips)) {
      if (!characters.clips.some((entry) => entry.id === clip)) {
        issue(['siege', 'skins', who, 'clips', use], `Unknown clip "${clip}"`);
      }
    }
  }
  const drawn = (siege.guard.size[1] * skins.guard.fill) / characters.body[1];
  for (const axis of [0, 2] as const) {
    if (characters.body[axis] * drawn > siege.guard.size[axis]) {
      issue(['siege', 'guard', 'size', axis], 'Too small for the body the characters draw in it');
    }
  }
  const { objectives } = siege;
  if (objectives.count > objectives.pool.length) {
    issue(['siege', 'objectives', 'count'], 'Pick no more objectives than the pool has');
  }
  // Where guards can stand needs the castle laid out: only if it holds together.
  const layout = castleProblems(data.castle).length === 0 ? layoutCastle(data.castle) : undefined;
  const posts = new Set([
    ...data.castle.anchors.guardPaths.map((path) => path.id),
    ...data.castle.anchors.lookouts.map((lookout) => lookout.id),
  ]);
  objectives.pool.forEach((objective, index) => {
    const path = ['siege', 'objectives', 'pool', index];
    if (objective.kind !== 'guards') return;
    if (objective.kill > objective.guards) {
      issue([...path, 'kill'], 'Kill no more guards than there are');
    }
    objective.posts.forEach((post, postIndex) => {
      if (!posts.has(post)) issue([...path, 'posts', postIndex], `Unknown post "${post}"`);
    });
    if (!layout || objective.posts.some((post) => !posts.has(post))) return;
    const room = objective.posts.flatMap((post) => postSlots(layout, post, objective.slot)).length;
    if (room < objective.guards) {
      issue(
        [...path, 'guards'],
        `Room for ${String(room)} guards ${String(objective.slot)} m apart at its posts`,
      );
    }
  });
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
  if (archery.scare.maxSpeedUp < archery.scare.speedUp) {
    issue(['archery', 'scare', 'maxSpeedUp'], 'Must not be under one scare’s speed-up');
  }
  const { one, two } = archery.stars;
  if (one > two) issue(['archery', 'stars'], 'More stars must not need less');
  // The trees stand behind the field, so they never hide a bird or an arrow.
  if (archery.looks.treeDistance.min <= archery.looks.distance) {
    issue(['archery', 'looks', 'treeDistance', 'min'], 'The trees must stand behind the field');
  }
}

/**
 * The fletcher's bench: its items exist, every arrow it makes is one the bird hunt can shoot, and
 * the workers' recipe is a stave's worth of the same careful fletching.
 */
function checkFletching(
  data: GameData,
  itemIds: ReadonlySet<string>,
  issue: (path: Path, message: string) => void,
): void {
  const fletching = data.fletching;
  for (const key of ['stave', 'feather'] as const) {
    if (!itemIds.has(fletching[key])) issue(['fletching', key], `Unknown item "${fletching[key]}"`);
  }
  const shootable = new Set(data.archery.arrows.map((arrow) => arrow.item));
  const made = new Set<string>();
  for (const kind of ['fletched', 'duster', 'bare'] as const) {
    const path = ['fletching', 'arrows', kind, 'item'];
    const item = fletching.arrows[kind].item;
    if (!itemIds.has(item)) issue(path, `Unknown item "${item}"`);
    else if (!shootable.has(item)) issue(path, `"${item}" isn't an arrow kind of the bird hunt`);
    if (made.has(item)) issue(path, 'Twice');
    made.add(item);
  }
  const sizes = fletching.batch.sizes;
  if (sizes[0]?.level !== 1) {
    issue(['fletching', 'batch', 'sizes'], 'The first batch size must be open from level 1');
  }
  sizes.forEach((size, index) => {
    const before = sizes[index - 1];
    if (before && (size.arrows <= before.arrows || size.level <= before.level)) {
      issue(['fletching', 'batch', 'sizes', index], 'Sizes must grow, in level order');
    }
  });
  // A feather on its mark is always near it.
  if (fletching.stars.nearTapMs < fletching.feel.markWindowMs) {
    issue(['fletching', 'stars', 'nearTapMs'], 'A near miss must reach past the mark window');
  }
  if (fletching.feel.tarLow >= fletching.feel.tarHigh) {
    issue(['fletching', 'feel', 'tarLow'], 'The green band must start under where it ends');
  }
  const station = data.stations.find((entry) => entry.mechanic === 'fletching');
  const recipe = data.recipes.find((entry) => entry.id === fletching.recipe);
  if (!recipe) {
    issue(['fletching', 'recipe'], `Unknown recipe "${fletching.recipe}"`);
    return;
  }
  if (recipe.station !== station?.id) {
    issue(['fletching', 'recipe'], 'Must be made at the fletching station');
  }
  // A stave's worth of careful fletching: its arrows, each with its feathers, for their XP.
  const shafts = fletching.arrowsPerStave;
  const count = (stacks: readonly { item: string; count: number }[], item: string) =>
    stacks.filter((stack) => stack.item === item).reduce((sum, stack) => sum + stack.count, 0);
  const expected = [
    count(recipe.inputs, fletching.stave) === 1 && recipe.inputs.length === 2,
    count(recipe.inputs, fletching.feather) === shafts * fletching.feathers.careful,
    count(recipe.outputs, fletching.arrows.fletched.item) === shafts && recipe.outputs.length === 1,
    recipe.xp === shafts * fletching.arrows.fletched.xp,
  ];
  if (!expected.every(Boolean)) {
    issue(
      ['fletching', 'recipe'],
      `"${recipe.id}" must take 1 stave and ${String(shafts * fletching.feathers.careful)} ` +
        `feathers for ${String(shafts)} fletched arrows and their XP`,
    );
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
