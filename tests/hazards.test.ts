import { describe, expect, it } from 'vitest';
import type { Clearing } from '../src/data';
import {
  afterChain,
  boulderKnock,
  hitsCabin,
  previewFall,
  previewFelling,
  resolveFall,
  rollBoulder,
} from '../src/stations/woodcutting/logic/chain';
import { rollDistance, rollTime } from '../src/stations/woodcutting/logic/fall';
import { generateClearing } from '../src/stations/woodcutting/logic/generate';
import { WoodcuttingRound, type RoundEvent } from '../src/stations/woodcutting';
import { data, testLogger } from './helpers';

const RIGHT = 0;
const DOWN = Math.PI / 2;

/** Canopies of radius 20 from the base up, trunks of 5, boulders of 10 that roll 150. */
const ROLL = { roll: 150, bounce: 0.5 };
function clearing(
  trees: Clearing['trees'],
  hazards: Partial<Pick<Clearing, 'boulders' | 'cabin'>> = {},
): Clearing {
  return {
    id: 'test',
    width: 500,
    height: 500,
    canopyRadius: 20,
    trunkRadius: 5,
    canopyStart: 0,
    trees,
    boulders: [],
    ...hazards,
  };
}

const all = (c: Clearing) => new Set(c.trees.map((tree) => tree.id));
const ids = (steps: { tree: string }[]) => steps.map((step) => step.tree);

describe('boulders', () => {
  // A tree falls right into a boulder; trees stand far down the boulder's line, out of any
  // tree's reach from the chopped one.
  const trees = [
    { id: 'a', x: 100, y: 100, height: 60 },
    { id: 'far', x: 260, y: 100, height: 60 },
    { id: 'side', x: 100, y: 300, height: 60 },
  ];
  const boulder = { id: 'b', x: 150, y: 100, radius: 10 };

  it('a falling tree knocks a boulder rolling, and it knocks over trees past the tree’s reach', () => {
    const c = clearing(trees, { boulders: [boulder] });
    const chain = resolveFall(c, all(c), 'a', RIGHT, ROLL);
    expect(chain.rolls).toHaveLength(1);
    const [roll] = chain.rolls;
    expect(roll?.boulder).toBe('b');
    // Dead on: it carries straight on.
    expect(roll?.angle).toBeCloseTo(RIGHT, 5);
    expect(ids(chain.steps)).toEqual(['a', 'far']);
    const far = chain.steps[1];
    expect(far?.hitBy).toBe('b');
    expect(far?.byBoulder).toBe(true);
    // It stays where it stopped.
    const moved = afterChain(c, chain).boulders[0];
    expect(moved?.x).toBeCloseTo(300, 0);
  });

  it('turns the roll with the aim, even for a boulder right beside the stump', () => {
    const c = clearing([{ id: 'a', x: 100, y: 100, height: 60 }], {
      boulders: [{ id: 'b', x: 135, y: 100, radius: 10 }],
    });
    const rollAt = (angle: number) => resolveFall(c, all(c), 'a', angle, ROLL).rolls[0]?.angle;
    const straight = rollAt(RIGHT);
    expect(straight).toBeCloseTo(RIGHT, 5);
    const nudged = rollAt(RIGHT - 0.2);
    // Aimed a little up past it, it's clipped on its lower side and goes off further down.
    expect(nudged).toBeDefined();
    expect(nudged).not.toBeCloseTo(straight ?? 0, 2);
    expect(nudged ?? 0).toBeGreaterThan(RIGHT - 0.2);
  });

  it('a forked tree whose trunks both reach a boulder shows only the roll that happens', () => {
    const c = clearing([{ id: 'a', x: 100, y: 100, height: 80, forks: [-20, 20] }], {
      boulders: [{ id: 'b', x: 160, y: 100, radius: 12 }],
    });
    const a = c.trees[0] as Clearing['trees'][number];
    // Aimed a touch off-centre so one trunk reaches it first.
    const angle = 0.05;
    const raw = [-20, 20].map((fork) =>
      previewFall(c, all(c), a, angle + (fork * Math.PI) / 180, ROLL),
    );
    expect(raw.filter((preview) => preview.roll)).toHaveLength(2);
    const previews = previewFelling(c, all(c), a, angle, ROLL);
    const rolls = previews.flatMap((preview) => (preview.roll ? [preview.roll] : []));
    expect(rolls).toHaveLength(1);
    const chain = resolveFall(c, all(c), 'a', angle, ROLL);
    expect(chain.rolls).toHaveLength(1);
    expect(rolls[0]?.path.at(-1)?.x).toBeCloseTo(chain.rolls[0]?.to.x ?? NaN, 5);
    expect(rolls[0]?.path.at(-1)?.y).toBeCloseTo(chain.rolls[0]?.to.y ?? NaN, 5);
  });

  it('a half hit sends it 30° off, the pool cut rule', () => {
    expect(boulderKnock(RIGHT, 0.5)).toBeCloseTo(Math.PI / 6, 5);
    expect(boulderKnock(RIGHT, -0.5)).toBeCloseTo(-Math.PI / 6, 5);
    expect(boulderKnock(RIGHT, 0)).toBe(RIGHT);
  });

  it('bounces off the fence like a cushion, angle in = angle out', () => {
    const c = clearing([{ id: 'a', x: 50, y: 400, height: 60 }], {
      boulders: [{ id: 'b', x: 450, y: 400, radius: 10 }],
    });
    const result = rollBoulder(c, new Set(), c.boulders[0] as never, Math.PI / 4, 150, [], 0.5);
    // It reaches the right-hand fence after ~57, bounces back left, keeping half what's left.
    expect(result.path).toHaveLength(3);
    const [start, wall, end] = result.path;
    expect(wall?.x).toBeCloseTo(490, 0);
    expect((end?.x ?? 0) - (wall?.x ?? 0)).toBeLessThan(0);
    expect((end?.y ?? 0) - (wall?.y ?? 0)).toBeGreaterThan(0);
    expect(start).toEqual({ x: 450, y: 400 });
    expect(result.natural).toBeLessThan(150);
  });

  it('a boulder that hits another stops and sets it rolling', () => {
    const c = clearing([{ id: 'a', x: 100, y: 100, height: 60 }], {
      boulders: [boulder, { id: 'b2', x: 220, y: 100, radius: 10 }],
    });
    const chain = resolveFall(c, all(c), 'a', RIGHT, ROLL);
    expect(chain.rolls.map((roll) => roll.boulder)).toEqual(['b', 'b2']);
    expect(chain.rolls[0]?.to.x).toBeCloseTo(200, 0);
    expect(chain.rolls[1]?.byBoulder).toBe(true);
  });

  it('a boulder rolled into the cabin is a crash', () => {
    const c = clearing(trees.slice(0, 1), {
      boulders: [boulder],
      cabin: { x: 230, y: 100, width: 20, depth: 60, height: 30 },
    });
    const chain = resolveFall(c, all(c), 'a', RIGHT, ROLL);
    expect(chain.rolls[0]?.cabin).toBe(true);
    expect(hitsCabin(chain)).toBe(true);
    expect(previewFall(c, all(c), trees[0] as never, RIGHT, ROLL).danger).toBe(true);
  });

  it('the aim guide shows the boulder it would set rolling and where it stops', () => {
    const c = clearing(trees, { boulders: [boulder] });
    const preview = previewFall(c, all(c), trees[0] as never, RIGHT, ROLL);
    expect(preview.roll?.boulder).toBe('b');
    expect(preview.roll?.path.at(-1)?.x).toBeCloseTo(300, 0);
    expect(preview.danger).toBe(false);
  });

  it('rolls slow evenly to a stop', () => {
    expect(rollTime(0, 100, 50)).toBe(0);
    expect(rollTime(100, 100, 50)).toBeCloseTo(4);
    expect(rollDistance(rollTime(75, 100, 50), 100, 50, 100)).toBeCloseTo(75);
    expect(rollDistance(10, 100, 50, 60)).toBe(60);
  });
});

describe('the cabin', () => {
  const cabin = { x: 80, y: 100, width: 20, depth: 40, height: 30 };
  const trees = [
    { id: 'a', x: 0, y: 100, height: 100 },
    { id: 'safe', x: 140, y: 100, height: 100 },
  ];

  it('stops a tree that reaches it, and the chain is marked as a crash', () => {
    const c = clearing(trees, { cabin });
    const chain = resolveFall(c, all(c), 'a', RIGHT, ROLL);
    expect(ids(chain.steps)).toEqual(['a']);
    expect(chain.steps[0]?.paths[0]?.cabin).toBeDefined();
    expect(hitsCabin(chain)).toBe(true);
    expect(hitsCabin(resolveFall(c, all(c), 'a', DOWN, ROLL))).toBe(false);
  });

  it('turns the aim guide red', () => {
    const c = clearing(trees, { cabin });
    const a = trees[0] as Clearing['trees'][number];
    expect(previewFall(c, all(c), a, RIGHT, ROLL).danger).toBe(true);
    expect(previewFall(c, all(c), a, DOWN, ROLL).danger).toBe(false);
  });

  it('loses the chain: no logs banked, and the round ends', async () => {
    const c = clearing(trees, { cabin });
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

describe('a round with a boulder', () => {
  it('waits for the boulder to stop, banks the trees it knocked, and leaves it where it stopped', () => {
    const c = clearing(
      [
        { id: 'a', x: 100, y: 100, height: 60 },
        { id: 'far', x: 260, y: 100, height: 60 },
        { id: 'other', x: 100, y: 400, height: 60 },
      ],
      { boulders: [{ id: 'b', x: 150, y: 100, radius: 10 }] },
    );
    const { logger } = testLogger();
    const events: RoundEvent[] = [];
    const feel = { ...data.woodcutting.feel, boulderRoll: ROLL.roll, boulderBounce: ROLL.bounce };
    const round = new WoodcuttingRound(
      c,
      {
        logger,
        feel: () => feel,
        chainExponent: 2,
        bank: (n) => n,
        onEvent: (e) => events.push(e),
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
    for (let i = 0; i < 400 && round.phase.kind === 'falling'; i++) round.tick(0.05);
    expect(round.phase.kind).toBe('pick');
    expect(round.logs).toBe(4);
    const types = events.map((event) => event.type);
    expect(types.indexOf('roll')).toBeLessThan(types.indexOf('banked'));
    expect(round.clearing.boulders[0]?.x).toBeCloseTo(300, 0);
  });
});

describe('random clearings with hazards', () => {
  it('always have a cabin at the top, left or right edge, boulders, and trees clear of both', () => {
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
      expect(c.boulders.length).toBeGreaterThanOrEqual(generator.boulders.count.min);
      expect(c.boulders.length).toBeLessThanOrEqual(generator.boulders.count.max);
      for (const tree of c.trees) {
        for (const b of c.boulders) {
          expect(Math.hypot(tree.x - b.x, tree.y - b.y)).toBeGreaterThanOrEqual(
            b.radius + c.trunkRadius + generator.boulders.gap,
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
    expect(two.boulders).toEqual(one.boulders);
  });
});
