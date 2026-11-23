import { describe, expect, it } from 'vitest';
import type { Clearing } from '../src/data';
import {
  fallPath,
  hitsCabin,
  previewFall,
  resolveChain,
} from '../src/stations/woodcutting/logic/chain';
import { generateClearing } from '../src/stations/woodcutting/logic/generate';
import { WoodcuttingRound, type RoundEvent } from '../src/stations/woodcutting';
import { data, testLogger } from './helpers';

const RIGHT = 0;
const degrees = (radians: number) => (radians * 180) / Math.PI;

/** Canopies of radius 20 from the base up, trunks of 5, rocks of 6. */
function clearing(
  trees: Clearing['trees'],
  hazards: Pick<Clearing, 'rocks'> & Partial<Pick<Clearing, 'cabin'>>,
): Clearing {
  return {
    id: 'test',
    width: 500,
    height: 500,
    canopyRadius: 20,
    trunkRadius: 5,
    canopyStart: 0,
    maxRockTurn: 40,
    trees,
    ...hazards,
  };
}

const rock = (y: number) => ({ id: 'rock', x: 50, y, radius: 6, height: 10 });
const all = (c: Clearing) => new Set(c.trees.map((tree) => tree.id));
const ids = (steps: { tree: string }[]) => steps.map((step) => step.tree);

describe('rocks', () => {
  const trees = [
    { id: 'a', x: 0, y: 100, height: 100 },
    // Straight on past the rock.
    { id: 'behind', x: 95, y: 100, height: 100 },
    // On the line the tree slides onto, turned about 17° up off the rock.
    { id: 'bank', x: 91, y: 72, height: 100 },
  ];

  it('a clipped rock turns the tree away just enough to slide off, onto a bank shot', () => {
    const c = clearing(trees, { rocks: [rock(112)] });
    const a = trees[0] as Clearing['trees'][number];
    const { path } = fallPath(c, all(c), a, RIGHT);
    expect(path.rock?.id).toBe('rock');
    expect(path.stop).toBeUndefined();
    // The rock is below the line (clockwise on screen), so the tree turns counter-clockwise.
    expect(degrees(path.landAngle)).toBeCloseTo(-16.9, 0);
    const steps = resolveChain(c, all(c), 'a', RIGHT);
    expect(ids(steps)).toContain('bank');
    expect(ids(steps)).not.toContain('behind');
  });

  it('a dead-on rock stops the tree, and nothing past it is hit', () => {
    const c = clearing(trees, { rocks: [rock(102)] });
    const steps = resolveChain(c, all(c), 'a', RIGHT);
    expect(ids(steps)).toEqual(['a']);
    const path = steps[0]?.paths[0];
    expect(path?.stop).toMatchObject({ on: 'rock', id: 'rock' });
    // It rests on the rock, not flat on the ground.
    expect(path?.stop?.tilt).toBeLessThan(Math.PI / 2);
    expect(path?.landAngle).toBe(RIGHT);
  });

  it('the aim guide shows the slide and where it lands', () => {
    const c = clearing(trees, { rocks: [rock(112)] });
    const preview = previewFall(c, all(c), trees[0] as Clearing['trees'][number], RIGHT);
    expect(preview.path.rock?.id).toBe('rock');
    expect(preview.hit?.tree).toBe('bank');
    expect(preview.danger).toBe(false);
  });
});

describe('the cabin', () => {
  const cabin = { x: 80, y: 100, width: 20, depth: 40, height: 30 };
  const trees = [
    { id: 'a', x: 0, y: 100, height: 100 },
    { id: 'safe', x: 140, y: 100, height: 100 },
  ];

  it('stops a tree that reaches it, and the chain is marked as a crash', () => {
    const c = clearing(trees, { rocks: [], cabin });
    const steps = resolveChain(c, all(c), 'a', RIGHT);
    expect(ids(steps)).toEqual(['a']);
    expect(steps[0]?.paths[0]?.stop?.on).toBe('cabin');
    expect(hitsCabin(steps)).toBe(true);
    expect(hitsCabin(resolveChain(c, all(c), 'a', Math.PI))).toBe(false);
  });

  it('turns the aim guide red', () => {
    const c = clearing(trees, { rocks: [], cabin });
    const a = trees[0] as Clearing['trees'][number];
    expect(previewFall(c, all(c), a, RIGHT).danger).toBe(true);
    expect(previewFall(c, all(c), a, Math.PI).danger).toBe(false);
  });

  it('loses the chain: no logs banked, and the round ends', async () => {
    const c = clearing(trees, { rocks: [], cabin });
    const { logger } = testLogger();
    const events: RoundEvent[] = [];
    let banked = 0;
    const feel = data.woodcutting.feel;
    const round = new WoodcuttingRound(
      c,
      {
        logger,
        feel: () => feel,
        chainExponent: 2,
        bank: (batches) => {
          banked += batches;
          return batches;
        },
        onEvent: (event) => events.push(event),
        view: 'test',
      },
      1,
    );
    round.touchTree('a');
    round.aimTo(RIGHT);
    round.tick(0.5);
    round.releaseAim();
    round.chop();
    while (round.phase.kind === 'chop') {
      const phase = round.phase;
      round.grab();
      round.setPull(1);
      round.tick(phase.target / feel.meterSpeed);
      round.releaseAxe();
      round.tick(feel.swingSeconds);
    }
    for (let i = 0; i < 200 && round.phase.kind === 'falling'; i++) round.tick(0.05);
    expect(round.phase.kind).toBe('crashed');
    expect(banked).toBe(0);
    expect(round.logs).toBe(0);
    expect(round.lostLogs).toBe(1);
    expect(events.map((event) => event.type)).toContain('crash');
    expect(events).toContainEqual({ type: 'lost', trees: 1, logs: 1 });
    expect((await logger.readAll()).map((entry) => entry.type)).toContain('woodcutting.cabinHit');
  });
});

describe('random clearings with hazards', () => {
  it('always have a cabin at the top, left or right edge, rocks, and trees clear of both', () => {
    const { generator } = data.woodcutting;
    for (let seed = 1; seed <= 15; seed++) {
      const { clearing: c } = generateClearing(data.woodcutting, seed);
      const cabin = c.cabin;
      if (!cabin) throw new Error('No cabin');
      const nearEdge =
        cabin.y - cabin.depth / 2 <= generator.cabin.edgeInset ||
        cabin.x - cabin.width / 2 <= generator.cabin.edgeInset ||
        cabin.x + cabin.width / 2 >= c.width - generator.cabin.edgeInset;
      expect(nearEdge).toBe(true);
      expect(cabin.y + cabin.depth / 2).toBeLessThan(c.height - generator.cabin.edgeInset);
      expect(c.rocks.length).toBeGreaterThanOrEqual(generator.rocks.count.min);
      expect(c.rocks.length).toBeLessThanOrEqual(generator.rocks.count.max);
      for (const tree of c.trees) {
        for (const r of c.rocks) {
          expect(Math.hypot(tree.x - r.x, tree.y - r.y)).toBeGreaterThanOrEqual(
            r.radius + c.trunkRadius + generator.rocks.gap,
          );
        }
        const toCabin = Math.hypot(
          Math.max(Math.abs(tree.x - cabin.x) - cabin.width / 2, 0),
          Math.max(Math.abs(tree.y - cabin.y) - cabin.depth / 2, 0),
        );
        expect(toCabin).toBeGreaterThanOrEqual(c.trunkRadius + generator.cabin.gap);
      }
    }
  });

  it('the same seed gives the same hazards', () => {
    const one = generateClearing(data.woodcutting, 42).clearing;
    const two = generateClearing(data.woodcutting, 42).clearing;
    expect(two.cabin).toEqual(one.cabin);
    expect(two.rocks).toEqual(one.rocks);
  });
});
