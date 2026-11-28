import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core';
import type { Clearing, WoodcuttingFellRest } from '../src/data';
import {
  fallPath,
  fellRestSteps,
  starBonusLogs,
  WoodcuttingRound,
  type RoundEvent,
} from '../src/stations/woodcutting';
import { data, dataWith, testLogger } from './helpers';

const tutorial = data.woodcutting.clearings[0] as Clearing;
const feel = data.woodcutting.feel;
const towardA2 = Math.atan2(170 - 110, 140 - 70);
/** The tutorial clearing with a cabin and a boulder, both clear of the a1–a4 chain. */
const hazardous: Clearing = {
  ...tutorial,
  cabin: { x: 120, y: 610, width: 96, depth: 40, height: 60 },
  boulders: [{ id: 'rock', x: 120, y: 240, radius: 20 }],
};

function setup({
  par = 20,
  clearing = tutorial,
  fellRest = data.woodcutting.fellRest,
}: { par?: number; clearing?: Clearing; fellRest?: WoodcuttingFellRest } = {}) {
  const { logger } = testLogger();
  const events: RoundEvent[] = [];
  const bankCalls: { batches: number; trees: number }[] = [];
  const drops: { item: string; count: number }[] = [];
  const round = new WoodcuttingRound(
    clearing,
    {
      logger,
      feel: () => feel,
      chainExponent: data.woodcutting.chainExponent,
      bank: (batches, trees) => {
        bankCalls.push({ batches, trees });
        return batches;
      },
      forage: data.woodcutting.forage,
      bankDrops: (stacks) => drops.push(...stacks),
      onEvent: (event) => events.push(event),
      view: 'test',
      fellRest,
      stars: { par, ...data.woodcutting.stars, bonus: data.woodcutting.starBonus },
    },
    7,
  );
  return { round, logger, events, bankCalls, drops };
}

/** Holds the axe at full pull until the marker is on the yellow, then lets go. */
function perfectChop(round: WoodcuttingRound) {
  const phase = round.phase;
  if (phase.kind !== 'chop') throw new Error(`Not chopping: ${phase.kind}`);
  round.grab();
  round.setPull(1);
  round.tick(phase.target / feel.meterSpeed);
  round.releaseAxe();
  round.tick(feel.swingSeconds);
}

function aim(round: WoodcuttingRound, tree: string, angle: number) {
  round.touchTree(tree);
  round.aimTo(angle);
  round.tick(0.5);
  round.releaseAim();
}

/** Fells a1 into the a1–a4 chain (16 logs: 3 stars at par 20) and lets it bank. */
function bankTheChain(round: WoodcuttingRound) {
  aim(round, 'a1', towardA2);
  round.chop();
  while (round.phase.kind === 'chop') perfectChop(round);
  for (let i = 0; i < 200 && round.phase.kind === 'falling'; i++) round.tick(0.05);
  expect(round.phase.kind).toBe('pick');
  expect(round.logs).toBe(16);
}

describe('Fell the rest', () => {
  it('is only offered with 3 stars and trees standing', () => {
    // Par 100: the chain's 16 logs are 1 star.
    const low = setup({ par: 100 });
    expect(low.round.canFellRest).toBe(false);
    bankTheChain(low.round);
    expect(low.round.stars).toBe(1);
    expect(low.round.canFellRest).toBe(false);
    low.round.fellRest();
    expect(low.round.phase.kind).toBe('pick');
    expect(low.round.standing.size).toBe(tutorial.trees.length - 4);

    const { round } = setup();
    expect(round.canFellRest).toBe(false);
    bankTheChain(round);
    expect(round.stars).toBe(3);
    expect(round.canFellRest).toBe(true);
    expect(round.fellRestLogs).toBe(tutorial.trees.length - 4);
    // Without the rules (another view, a test), it's never offered.
    const none = new WoodcuttingRound(
      tutorial,
      { logger: testLogger().logger, feel: () => feel, bank: (b) => b, view: 'test' },
      7,
    );
    expect(none.canFellRest).toBe(false);
  });

  it('is offered while picking or aiming, not while chopping or falling', () => {
    const { round } = setup();
    bankTheChain(round);
    aim(round, 'b1', Math.PI / 2);
    expect(round.phase.kind).toBe('aim');
    expect(round.canFellRest).toBe(true);
    round.chop();
    expect(round.phase.kind).toBe('chop');
    expect(round.canFellRest).toBe(false);
    round.fellRest();
    expect(round.phase.kind).toBe('chop');
    while (round.phase.kind === 'chop') perfectChop(round);
    expect(round.phase.kind).toBe('falling');
    expect(round.canFellRest).toBe(false);
    for (let i = 0; i < 200 && round.phase.kind === 'falling'; i++) round.tick(0.05);
    expect(round.canFellRest).toBe(true);
  });

  it('banks logsPerTree for each standing tree through the bank hook, and ends the round', async () => {
    const { round, logger, events, bankCalls } = setup();
    bankTheChain(round);
    const standing = round.standing.size;
    round.fellRest();
    expect(bankCalls.at(-1)).toEqual({ batches: standing, trees: standing });
    expect(round.logs).toBe(16 + standing);
    expect(round.felled).toBe(tutorial.trees.length);
    expect(round.standing.size).toBe(0);
    expect(round.phase.kind).toBe('cleared');
    expect(round.canFellRest).toBe(false);
    // The star bonus is on the round's logs, the singles included.
    expect(round.starBonus).toBe(starBonusLogs(16 + standing, 3, data.woodcutting.starBonus));
    const felled = events.find((event) => event.type === 'felledRest');
    expect(felled?.type === 'felledRest' && felled.logs).toBe(standing);
    const logs = await logger.readAll();
    expect(logs.find((event) => event.type === 'woodcutting.fellRest')?.data).toMatchObject({
      trees: standing,
      logs: standing,
      roundLogs: 16 + standing,
      starsBefore: 3,
      stars: 3,
    });
    const end = logs.filter((event) => event.type === 'woodcutting.roundEnd');
    expect(end).toHaveLength(1);
    expect(end[0]?.data).toMatchObject({ reason: 'felledRest', standing: 0 });
    // Once is all: nothing is left to fell.
    round.fellRest();
    expect(bankCalls).toHaveLength(2);
  });

  it('banks more per tree when the data says so', () => {
    const { round } = setup({ fellRest: { ...data.woodcutting.fellRest, logsPerTree: 2 } });
    bankTheChain(round);
    const standing = round.standing.size;
    expect(round.fellRestLogs).toBe(standing * 2);
    round.fellRest();
    expect(round.logs).toBe(16 + standing * 2);
  });

  it('fells singles: no chain hits, no rolls, no cabin', () => {
    const { round, events } = setup({ clearing: hazardous });
    bankTheChain(round);
    const before = events.length;
    round.fellRest();
    const after = events.slice(before);
    expect(after.map((event) => event.type)).toEqual(['felledRest']);
    expect(round.crashed).toBe(false);
    expect(round.lostLogs).toBe(0);
    expect(round.clearing.boulders).toEqual(hazardous.boulders);
    const felled = after[0];
    if (felled?.type !== 'felledRest') throw new Error('No felledRest event');
    for (const step of felled.steps) {
      expect(step.hitBy).toBeUndefined();
      expect(step.paths.every((path) => path.cabin === undefined)).toBe(true);
      // Each lands clear of the cabin: it falls a way that doesn't reach it.
      const tree = hazardous.trees.find((entry) => entry.id === step.tree);
      if (!tree) throw new Error(`No tree ${step.tree}`);
      for (const trunk of step.trunks) {
        expect(fallPath(hazardous, new Set(), tree, trunk).path.cabin).toBeUndefined();
      }
    }
    // A ripple: each tree has its own place in it.
    expect(new Set(felled.steps.map((step) => step.depth)).size).toBe(felled.steps.length);
  });

  it('pays the forage on the trees it fells', () => {
    const { round, events, drops } = setup();
    bankTheChain(round);
    const expected = [...round.standing].filter((id) => round.forage.trees.has(id));
    const before = drops.length;
    round.fellRest();
    const felled = events.find((event) => event.type === 'felledRest');
    if (felled?.type !== 'felledRest') throw new Error('No felledRest event');
    expect(felled.forage.trees.sort()).toEqual(expected.sort());
    expect(felled.forage.patches).toEqual([]);
    const moss = expected.reduce((sum, id) => sum + (round.forage.trees.get(id)?.moss ?? 0), 0);
    const paidMoss = drops
      .slice(before)
      .filter((stack) => stack.item === data.woodcutting.forage.mossyTrees.item)
      .reduce((sum, stack) => sum + stack.count, 0);
    // Moss and red caps are different items, so the moss alone adds up to the trees' moss.
    expect(paidMoss).toBe(moss);
    for (const id of expected) expect(round.hasForaged(`tree:${id}`)).toBe(true);
  });
});

describe('fellRestSteps', () => {
  it('is the same for the same seed, and ripples out from the middle', () => {
    const standing = new Set(tutorial.trees.map((tree) => tree.id));
    const a = fellRestSteps(tutorial, standing, [], 16, new Rng(5));
    expect(fellRestSteps(tutorial, standing, [], 16, new Rng(5))).toEqual(a);
    expect(a.map((step) => step.depth)).toEqual(a.map((_, index) => index));
    const middle = { x: tutorial.width / 2, y: tutorial.height / 2 };
    const distances = a.map((step) => {
      const tree = tutorial.trees.find((entry) => entry.id === step.tree);
      return tree ? Math.hypot(tree.x - middle.x, tree.y - middle.y) : NaN;
    });
    expect([...distances].sort((x, y) => x - y)).toEqual(distances);
    // Forked trees fall as their forks.
    const forked = a.find((step) => step.tree === 'c1');
    expect(forked?.trunks).toHaveLength(2);
  });
});

describe('fell the rest data', () => {
  it('fails loudly on stars past 3 or no logs', () => {
    expect(() =>
      dataWith((raw) => {
        raw.woodcutting.fellRest.minStars = 4;
      }),
    ).toThrow();
    expect(() =>
      dataWith((raw) => {
        raw.woodcutting.fellRest.logsPerTree = 0;
      }),
    ).toThrow();
  });
});
