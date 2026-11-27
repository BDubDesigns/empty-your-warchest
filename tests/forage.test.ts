import { describe, expect, it } from 'vitest';
import type { Stack } from '../src/core';
import type { Clearing } from '../src/data';
import { ashFor } from '../src/stations/firemaking';
import {
  WoodcuttingRound,
  forageChain,
  generateClearing,
  rollRunsOver,
  seedForage,
  treeLandsOn,
  type BoulderRoll,
  type Chain,
  type FallStep,
  type Forage,
} from '../src/stations/woodcutting';
import { data, testLogger } from './helpers';

const rules = data.woodcutting.forage;
const tutorial = data.woodcutting.clearings[0] as Clearing;
/** The tutorial clearing with a boulder in it. */
const clearing: Clearing = {
  ...tutorial,
  boulders: [{ id: 'b1', x: 300, y: 200, radius: 20 }],
};

function step(tree: string, angle: number): FallStep {
  return { tree, angle, trunks: [angle], paths: [{ angle }], depth: 0 };
}

function roll(boulder: string, path: { x: number; y: number }[]): BoulderRoll {
  const from = path[0] ?? { x: 0, y: 0 };
  const to = path.at(-1) ?? from;
  return {
    boulder,
    from,
    to,
    path,
    angle: 0,
    distance: 100,
    natural: 100,
    hitBy: 'a1',
    byBoulder: false,
    hitAt: 50,
    depth: 1,
    cabin: false,
  };
}

describe('seeding the forage', () => {
  it('is the same for a seed, and differs between seeds', () => {
    const a = seedForage(clearing, rules, 3);
    expect(seedForage(clearing, rules, 3)).toEqual(a);
    const others = [4, 5, 6, 7].map((seed) => seedForage(clearing, rules, seed));
    expect(
      others.some((other) => JSON.stringify([...other.trees]) !== JSON.stringify([...a.trees])),
    ).toBe(true);
  });

  it('makes about the shares in data mossy and mushroom trees, over many rounds', () => {
    let trees = 0;
    let mossy = 0;
    let mushrooms = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const forage = seedForage(clearing, rules, seed);
      trees += clearing.trees.length;
      for (const drop of forage.trees.values()) {
        if (drop.moss > 0) mossy += 1;
        if (drop.mushrooms > 0) mushrooms += 1;
        expect(drop.moss).toBeLessThanOrEqual(rules.mossyTrees.count.max);
      }
    }
    expect(mossy / trees).toBeCloseTo(rules.mossyTrees.share, 1);
    expect(mushrooms / trees).toBeCloseTo(rules.mushroomTrees.share, 1);
  });

  it('puts mushroom patches on open ground, clear of trunks, boulders and the cabin', () => {
    const generated = generateClearing(data.woodcutting, 77).clearing;
    for (let seed = 1; seed <= 50; seed++) {
      const forage = seedForage(generated, rules, seed);
      expect(forage.patches.length).toBeGreaterThanOrEqual(rules.patches.count.min);
      for (const patch of forage.patches) {
        for (const tree of generated.trees) {
          expect(Math.hypot(tree.x - patch.x, tree.y - patch.y)).toBeGreaterThanOrEqual(
            generated.trunkRadius + patch.radius,
          );
        }
        for (const boulder of generated.boulders) {
          expect(Math.hypot(boulder.x - patch.x, boulder.y - patch.y)).toBeGreaterThanOrEqual(
            boulder.radius + patch.radius,
          );
        }
      }
    }
  });
});

describe('foraging a chain', () => {
  const forage: Forage = {
    trees: new Map([
      ['a1', { moss: 2, mushrooms: 0 }],
      ['a2', { moss: 0, mushrooms: 1 }],
    ]),
    boulders: new Map([['b1', 2]]),
    patches: [{ id: 'patch1', x: 200, y: 600, radius: 18 }],
  };
  const total = (drops: Stack[], item: string) =>
    drops.find((stack) => stack.item === item)?.count ?? 0;

  it('drops what the felled trees carry, and moss off a boulder the first time it’s hit', () => {
    const paid = new Set<string>();
    const chain: Chain = {
      steps: [step('a1', 0), step('a2', 0)],
      rolls: [
        roll('b1', [
          { x: 300, y: 200 },
          { x: 330, y: 100 },
        ]),
      ],
    };
    const found = forageChain(clearing, chain, forage, rules, paid);
    expect(found.trees).toEqual(['a1', 'a2']);
    expect(found.boulders).toEqual(['b1']);
    expect(total(found.drops, 'moss')).toBe(4);
    expect(total(found.drops, 'red_cap')).toBe(1);
    // Hit again, the boulder is a plain boulder: nothing more.
    const again = forageChain(
      clearing,
      {
        steps: [],
        rolls: [
          roll('b1', [
            { x: 330, y: 100 },
            { x: 340, y: 60 },
          ]),
        ],
      },
      forage,
      rules,
      paid,
    );
    expect(again.drops).toEqual([]);
  });

  it('pays a patch once, when a tree lands on it or a boulder rolls over it', () => {
    const patch = forage.patches[0];
    if (!patch) throw new Error('No patch');
    // c4 stands at (170, 560): falling down-right reaches the patch at (200, 600).
    const angle = Math.atan2(600 - 560, 200 - 170);
    expect(treeLandsOn(clearing, 'c4', angle, patch)).toBe(true);
    expect(treeLandsOn(clearing, 'c4', angle + Math.PI, patch)).toBe(false);
    expect(
      rollRunsOver(
        [
          { x: 100, y: 600 },
          { x: 300, y: 600 },
        ],
        20,
        patch,
      ),
    ).toBe(true);
    expect(
      rollRunsOver(
        [
          { x: 100, y: 500 },
          { x: 300, y: 500 },
        ],
        20,
        patch,
      ),
    ).toBe(false);
    const paid = new Set<string>();
    const byTree = forageChain(
      clearing,
      { steps: [step('c4', angle)], rolls: [] },
      forage,
      rules,
      paid,
    );
    expect(byTree.patches).toEqual(['patch1']);
    expect(total(byTree.drops, 'red_cap')).toBe(rules.patches.yield);
    const byBoulder = forageChain(
      clearing,
      {
        steps: [],
        rolls: [
          roll('b1', [
            { x: 100, y: 600 },
            { x: 300, y: 600 },
          ]),
        ],
      },
      forage,
      rules,
      paid,
    );
    expect(byBoulder.patches).toEqual([]);
  });

  it('banks a chain’s drops with its logs, and logs them', async () => {
    const { logger } = testLogger();
    const banked: Stack[] = [];
    const round = new WoodcuttingRound(
      tutorial,
      {
        logger,
        feel: () => data.woodcutting.feel,
        bank: (batches) => batches,
        forage: { ...rules, mossyTrees: { ...rules.mossyTrees, share: 1 } },
        bankDrops: (drops) => banked.push(...drops),
        view: 'test',
      },
      9,
    );
    // Every tree is mossy: felling one banks its moss.
    round.touchTree('d3');
    round.aimTo(0);
    round.tick(0.5);
    round.releaseAim();
    round.chop();
    for (let i = 0; i < 200 && round.phase.kind === 'chop'; i++) {
      round.grab();
      round.setPull(1);
      round.tick(0.2);
      round.releaseAxe();
      round.tick(1);
    }
    for (let i = 0; i < 400 && round.phase.kind === 'falling'; i++) round.tick(0.05);
    expect(total(banked, 'moss')).toBeGreaterThanOrEqual(1);
    expect(round.drops).toEqual(banked);
    const types = (await logger.readAll()).map((event) => event.type);
    expect(types).toContain('woodcutting.forage');
  });
});

describe('ash from the fire pit', () => {
  it('turns each charred stave to ash, and leaves a share of each fuel log', () => {
    const fire = data.firemaking;
    expect(ashFor(fire, 0, 0)).toBe(0);
    expect(ashFor(fire, 2, 0)).toBe(2 * fire.ash.perCharred);
    expect(ashFor(fire, 0, 4)).toBe(Math.round(4 * fire.ash.perLog));
  });
});
