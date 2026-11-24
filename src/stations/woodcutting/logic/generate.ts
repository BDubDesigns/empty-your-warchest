import { Rng } from '../../../core';
import type { Clearing, ClearingTree, GameData } from '../../../data';
import { afterChain, hitsCabin, resolveFall, type BoulderRules } from './chain';
import { chainLogs } from './score';
import { forestAt } from './unlocks';

type WoodcuttingData = GameData['woodcutting'];

/** A round's clearing, with the par its stars are judged against. */
export interface ClearingPlan {
  clearing: Clearing;
  par: number;
  /** Seed the clearing was generated from; none for the hand-made tutorial. */
  seed?: number;
  tutorial: boolean;
}

export interface BestChain {
  tree: string;
  angle: number;
  /** Trees in the chain. */
  length: number;
}

/**
 * The longest chain any standing tree can start, trying `samples` fall directions each. A chain
 * only counts at the length it keeps with the aim one step off either way, as a solid (not
 * pixel-perfect) player would find it. A chain into the cabin counts for nothing.
 */
export function bestChain(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  samples: number,
  rules: BoulderRules,
): BestChain | undefined {
  let best: BestChain | undefined;
  for (const tree of clearing.trees) {
    if (!standing.has(tree.id)) continue;
    const angles = Array.from({ length: samples }, (_, index) => (index / samples) * Math.PI * 2);
    const lengths = angles.map((angle) => {
      const chain = resolveFall(clearing, standing, tree.id, angle, rules);
      return hitsCabin(chain) ? 0 : chain.steps.length;
    });
    lengths.forEach((length, index) => {
      const before = lengths[(index + samples - 1) % samples] ?? length;
      const after = lengths[(index + 1) % samples] ?? length;
      const steady = Math.min(before, length, after);
      if (!best || steady > best.length) {
        best = { tree: tree.id, angle: angles[index] ?? 0, length: steady };
      }
    });
  }
  return best;
}

/**
 * Par: the logs a solid player banks by always taking the biggest chain they can find. Not the
 * true best (that would need every felling order), so it's reachable and can be beaten.
 */
export function clearingPar(
  clearing: Clearing,
  exponent: number,
  samples: number,
  rules: BoulderRules,
): number {
  const standing = new Set(clearing.trees.map((tree) => tree.id));
  // Boulders stay where they roll, so each chain plays on the clearing the last one left.
  let field = clearing;
  let logs = 0;
  while (standing.size > 0) {
    const best = bestChain(field, standing, samples, rules);
    // Whatever's left can only reach the cabin: a solid player leaves it standing.
    if (!best || best.length === 0) break;
    const chain = resolveFall(field, standing, best.tree, best.angle, rules);
    for (const step of chain.steps) standing.delete(step.tree);
    field = afterChain(field, chain);
    logs += chainLogs(chain.steps.length, exponent);
  }
  return logs;
}

/** How boulders roll, from the feel numbers in data (live tuning doesn't change par). */
export function boulderRules(woodcutting: {
  feel: Pick<WoodcuttingData['feel'], 'boulderRoll' | 'boulderBounce'>;
}): BoulderRules {
  return { roll: woodcutting.feel.boulderRoll, bounce: woodcutting.feel.boulderBounce };
}

/** The hand-made first clearing, with its par. */
export function tutorialPlan(woodcutting: WoodcuttingData): ClearingPlan {
  const clearing = tutorialClearing(woodcutting);
  const { chainExponent, generator } = woodcutting;
  return {
    clearing,
    par: clearingPar(clearing, chainExponent, generator.aimSamples, boulderRules(woodcutting)),
    tutorial: true,
  };
}

/**
 * A random clearing from `seed` for a woodcutting `level` (higher levels unlock bigger, more
 * forked clearings): the same seed and level always give the same clearing. Layouts are rerolled
 * until one has a chain of at least `minBestChain` trees (or the attempts run out, and the best
 * one found is used).
 */
export function generateClearing(
  woodcutting: WoodcuttingData,
  seed: number,
  level = 1,
): ClearingPlan {
  const { generator, chainExponent } = woodcutting;
  const rng = new Rng(seed);
  const forest = forestAt(woodcutting, level);
  const rules = boulderRules(woodcutting);
  let chosen: { clearing: Clearing; chain: number } | undefined;
  for (let attempt = 0; attempt < generator.attempts; attempt++) {
    const clearing = layout(woodcutting, forest, rng, `random-${String(seed)}`);
    const all = new Set(clearing.trees.map((tree) => tree.id));
    const chain = bestChain(clearing, all, generator.aimSamples, rules)?.length ?? 0;
    if (!chosen || chain > chosen.chain) chosen = { clearing, chain };
    if (chain >= generator.minBestChain) break;
  }
  if (!chosen) throw new Error('The clearing generator made no attempts');
  return {
    clearing: chosen.clearing,
    par: clearingPar(chosen.clearing, chainExponent, generator.aimSamples, rules),
    seed,
    tutorial: false,
  };
}

function tutorialClearing(woodcutting: WoodcuttingData): Clearing {
  const clearing = woodcutting.clearings.find((entry) => entry.id === woodcutting.tutorialClearing);
  if (!clearing) throw new Error(`No clearing "${woodcutting.tutorialClearing}" in data`);
  return clearing;
}

/**
 * Lays out a clearing on the tutorial clearing's ground: the cabin at one edge, then boulders,
 * then trees, all kept apart and away from the edges.
 */
function layout(
  woodcutting: WoodcuttingData,
  forest: ReturnType<typeof forestAt>,
  rng: Rng,
  id: string,
): Clearing {
  const shape = tutorialClearing(woodcutting);
  const { generator } = woodcutting;
  const cabin = placeCabin(shape, generator.cabin, rng);
  const toCabin = (x: number, y: number) =>
    Math.hypot(
      Math.max(Math.abs(x - cabin.x) - cabin.width / 2, 0),
      Math.max(Math.abs(y - cabin.y) - cabin.depth / 2, 0),
    );
  const spot = () => ({
    x: Math.round(rng.range(generator.margin, shape.width - generator.margin)),
    y: Math.round(rng.range(generator.margin, shape.height - generator.margin)),
  });
  const boulders: Clearing['boulders'] = [];
  const { radius, gap } = generator.boulders;
  const boulderCount = rng.int(generator.boulders.count.min, generator.boulders.count.max);
  for (let index = 0; index < boulderCount; index++) {
    for (let tries = 0; tries < 100; tries++) {
      const { x, y } = spot();
      if (toCabin(x, y) < radius + generator.cabin.gap) continue;
      if (boulders.some((other) => Math.hypot(other.x - x, other.y - y) < radius * 2 + gap))
        continue;
      boulders.push({ id: `b${String(index + 1)}`, x, y, radius });
      break;
    }
  }
  const count = rng.int(forest.trees.min, forest.trees.max);
  const trees: ClearingTree[] = [];
  for (let index = 0; index < count; index++) {
    for (let tries = 0; tries < 100; tries++) {
      const { x, y } = spot();
      if (trees.some((tree) => Math.hypot(tree.x - x, tree.y - y) < generator.spacing)) continue;
      if (toCabin(x, y) < shape.trunkRadius + generator.cabin.gap) continue;
      const clear = shape.trunkRadius + gap;
      if (boulders.some((other) => Math.hypot(other.x - x, other.y - y) < other.radius + clear))
        continue;
      const step = generator.heightStep;
      const height =
        Math.round(rng.range(generator.height.min, generator.height.max) / step) * step;
      const tree: ClearingTree = { id: `t${String(index + 1)}`, x, y, height };
      if (rng.chance(forest.forkedShare)) {
        const spread = Math.round(rng.range(generator.forkSpread.min, generator.forkSpread.max));
        tree.forks = [-spread, spread];
      }
      trees.push(tree);
      break;
    }
  }
  return { ...shape, id, trees, boulders, cabin };
}

/** The cabin, along the top, left or right edge (never the bottom, in front of the camera). */
function placeCabin(
  shape: Clearing,
  cabin: WoodcuttingData['generator']['cabin'],
  rng: Rng,
): NonNullable<Clearing['cabin']> {
  const edge = rng.pick(['top', 'left', 'right'] as const);
  const { width, depth, height, edgeInset } = cabin;
  if (edge === 'top') {
    return {
      x: Math.round(rng.range(width / 2 + edgeInset, shape.width - width / 2 - edgeInset)),
      y: depth / 2 + edgeInset,
      width,
      depth,
      height,
    };
  }
  // Long side along the edge.
  const x = edge === 'left' ? depth / 2 + edgeInset : shape.width - depth / 2 - edgeInset;
  return {
    x,
    y: Math.round(rng.range(width / 2 + edgeInset, shape.height - width / 2 - edgeInset)),
    width: depth,
    depth: width,
    height,
  };
}
