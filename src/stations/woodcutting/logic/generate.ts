import { Rng } from '../../../core';
import type { Clearing, ClearingTree, GameData } from '../../../data';
import { resolveChain } from './chain';
import { chainLogs } from './score';

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
 * pixel-perfect) player would find it.
 */
export function bestChain(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  samples: number,
): BestChain | undefined {
  let best: BestChain | undefined;
  for (const tree of clearing.trees) {
    if (!standing.has(tree.id)) continue;
    const angles = Array.from({ length: samples }, (_, index) => (index / samples) * Math.PI * 2);
    const lengths = angles.map((angle) => resolveChain(clearing, standing, tree.id, angle).length);
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
export function clearingPar(clearing: Clearing, exponent: number, samples: number): number {
  const standing = new Set(clearing.trees.map((tree) => tree.id));
  let logs = 0;
  while (standing.size > 0) {
    const best = bestChain(clearing, standing, samples);
    if (!best) break;
    const steps = resolveChain(clearing, standing, best.tree, best.angle);
    for (const step of steps) standing.delete(step.tree);
    logs += chainLogs(steps.length, exponent);
  }
  return logs;
}

/** The hand-made first clearing, with its par. */
export function tutorialPlan(woodcutting: WoodcuttingData): ClearingPlan {
  const clearing = tutorialClearing(woodcutting);
  const { chainExponent, generator } = woodcutting;
  return {
    clearing,
    par: clearingPar(clearing, chainExponent, generator.aimSamples),
    tutorial: true,
  };
}

/**
 * A random clearing from `seed`: the same seed always gives the same clearing. Layouts are
 * rerolled until one has a chain of at least `minBestChain` trees (or the attempts run out, and
 * the best one found is used).
 */
export function generateClearing(woodcutting: WoodcuttingData, seed: number): ClearingPlan {
  const { generator, chainExponent } = woodcutting;
  const rng = new Rng(seed);
  let chosen: { clearing: Clearing; chain: number } | undefined;
  for (let attempt = 0; attempt < generator.attempts; attempt++) {
    const clearing = layout(woodcutting, rng, `random-${String(seed)}`);
    const all = new Set(clearing.trees.map((tree) => tree.id));
    const chain = bestChain(clearing, all, generator.aimSamples)?.length ?? 0;
    if (!chosen || chain > chosen.chain) chosen = { clearing, chain };
    if (chain >= generator.minBestChain) break;
  }
  if (!chosen) throw new Error('The clearing generator made no attempts');
  return {
    clearing: chosen.clearing,
    par: clearingPar(chosen.clearing, chainExponent, generator.aimSamples),
    seed,
    tutorial: false,
  };
}

function tutorialClearing(woodcutting: WoodcuttingData): Clearing {
  const clearing = woodcutting.clearings.find((entry) => entry.id === woodcutting.tutorialClearing);
  if (!clearing) throw new Error(`No clearing "${woodcutting.tutorialClearing}" in data`);
  return clearing;
}

/** Scatters trees over the tutorial clearing's ground, kept apart and away from the edges. */
function layout(woodcutting: WoodcuttingData, rng: Rng, id: string): Clearing {
  const shape = tutorialClearing(woodcutting);
  const { generator } = woodcutting;
  const count = rng.int(generator.trees.min, generator.trees.max);
  const trees: ClearingTree[] = [];
  for (let index = 0; index < count; index++) {
    for (let tries = 0; tries < 100; tries++) {
      const x = Math.round(rng.range(generator.margin, shape.width - generator.margin));
      const y = Math.round(rng.range(generator.margin, shape.height - generator.margin));
      if (trees.some((tree) => Math.hypot(tree.x - x, tree.y - y) < generator.spacing)) continue;
      const step = generator.heightStep;
      const height =
        Math.round(rng.range(generator.height.min, generator.height.max) / step) * step;
      const tree: ClearingTree = { id: `t${String(index + 1)}`, x, y, height };
      if (rng.chance(generator.forkedShare)) {
        const spread = Math.round(rng.range(generator.forkSpread.min, generator.forkSpread.max));
        tree.forks = [-spread, spread];
      }
      trees.push(tree);
      break;
    }
  }
  return { ...shape, id, trees };
}
