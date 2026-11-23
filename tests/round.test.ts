import { describe, expect, it } from 'vitest';
import { chainLogs, WoodcuttingRound, type RoundEvent } from '../src/stations/woodcutting';
import { data, testLogger } from './helpers';

const clearing = data.woodcutting.clearings[0];
if (!clearing) throw new Error('No clearing in data');
const feel = data.woodcutting.feel;
const towardA2 = Math.atan2(170 - 110, 140 - 70);

function setup(seed = 7) {
  const { logger } = testLogger();
  const events: RoundEvent[] = [];
  let banked = 0;
  const round = new WoodcuttingRound(
    clearing as NonNullable<typeof clearing>,
    {
      logger,
      feel: () => feel,
      chainExponent: data.woodcutting.chainExponent,
      bank: (batches) => {
        banked += batches;
        return batches;
      },
      onEvent: (event) => events.push(event),
      view: 'test',
    },
    seed,
  );
  return { round, logger, events, banked: () => banked };
}

/** Holds the axe at full pull until the marker is on the yellow, then lets go. */
function perfectChop(round: WoodcuttingRound) {
  const phase = round.phase;
  if (phase.kind !== 'chop') throw new Error(`Not chopping: ${phase.kind}`);
  round.grab();
  round.setPull(1);
  const hold = phase.target / feel.meterSpeed;
  round.tick(hold);
  round.releaseAxe();
  round.tick(feel.swingSeconds);
}

function aimAndChop(round: WoodcuttingRound, tree: string, angle: number) {
  round.touchTree(tree);
  round.aimTo(angle);
  round.tick(0.5);
  round.releaseAim();
  round.chop();
}

describe('WoodcuttingRound', () => {
  it('plays a turn: aim, chop to felling, the chain falls and banks', async () => {
    const { round, logger, events, banked } = setup();
    aimAndChop(round, 'a1', towardA2);
    expect(round.phase.kind).toBe('chop');
    while (round.phase.kind === 'chop') perfectChop(round);
    expect(round.phase.kind).toBe('falling');
    for (let i = 0; i < 200 && round.phase.kind === 'falling'; i++) round.tick(0.05);
    expect(round.phase.kind).toBe('pick');
    // A chain of 4 trees banks 4² logs.
    expect(banked()).toBe(16);
    expect(round.logs).toBe(16);
    expect(events).toContainEqual({ type: 'banked', trees: 4, logs: 16 });
    expect(events.filter((event) => event.type === 'landed')).toHaveLength(4);
    // Each tree the chain knocks over is hit once, before it lands.
    const order = events.flatMap((event) =>
      event.type === 'hit' || event.type === 'landed' ? [`${event.type} ${event.step.tree}`] : [],
    );
    expect(order.filter((entry) => entry.startsWith('hit'))).toEqual([
      'hit a2',
      'hit a3',
      'hit a4',
    ]);
    for (const tree of ['a2', 'a3', 'a4']) {
      expect(order.indexOf(`hit ${tree}`)).toBeLessThan(order.indexOf(`landed ${tree}`));
    }

    const types = (await logger.readAll()).map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'woodcutting.roundStart',
        'woodcutting.select',
        'woodcutting.aim',
        'woodcutting.chop',
        'woodcutting.fell',
        'woodcutting.bank',
      ]),
    );
    const fell = (await logger.readAll()).find((event) => event.type === 'woodcutting.fell');
    expect(fell?.data?.chain).toEqual(['a1', 'a2', 'a3', 'a4']);
    const bank = (await logger.readAll()).find((event) => event.type === 'woodcutting.bank');
    expect(bank?.data).toEqual({ trees: 4, logs: 16, roundLogs: 16 });
  });

  it('a perfect full pull deals full power plus the bonus, and keeps the aim', () => {
    const { round } = setup();
    aimAndChop(round, 'a1', towardA2);
    perfectChop(round);
    const phase = round.phase;
    expect(phase.kind).toBe('chop');
    if (phase.kind !== 'chop') return;
    expect(phase.points).toBe(feel.fullPullPoints + feel.perfectBonus);
    expect(phase.angle).toBeCloseTo(towardA2);
  });

  it('keeps the aim from before the finger lifted, and lets the buttons nudge it', () => {
    const { round } = setup();
    round.touchTree('a1');
    round.aimTo(1.0);
    round.tick(0.3);
    round.aimTo(1.2);
    round.tick(0.05);
    round.aimTo(1.6);
    round.releaseAim();
    const phase = round.phase;
    if (phase.kind !== 'aim') throw new Error('Not aiming');
    expect(phase.angle).toBe(1.0);
    round.nudge(1);
    expect(round.phase.kind === 'aim' && round.phase.angle).toBeCloseTo(
      1.0 + (feel.fineAimStep * Math.PI) / 180,
    );
  });

  it('only chops once the aim is set and the finger is up', () => {
    const { round } = setup();
    round.touchTree('a1');
    expect(round.canChop).toBe(false);
    round.chop();
    expect(round.phase.kind).toBe('aim');
    round.aimTo(0.5);
    round.releaseAim();
    expect(round.canChop).toBe(true);
  });

  it('ignores a grab that is never pulled back', () => {
    const { round } = setup();
    aimAndChop(round, 'a1', towardA2);
    round.grab();
    round.tick(0.3);
    round.releaseAxe();
    round.tick(1);
    expect(round.phase.kind === 'chop' && round.phase.points).toBe(0);
  });

  it('replays the same round from the same seed', async () => {
    const play = async (seed: number) => {
      const { round, logger } = setup(seed);
      aimAndChop(round, 'b1', Math.PI / 2);
      for (let i = 0; i < 6 && round.phase.kind === 'chop'; i++) {
        round.grab();
        round.setPull(0.6);
        round.tick(0.37 * (i + 1));
        round.releaseAxe();
        round.tick(feel.swingSeconds);
      }
      return (await logger.readAll())
        .filter((event) => event.type === 'woodcutting.chop')
        .map((event) => event.data);
    };
    expect(await play(3)).toEqual(await play(3));
  });

  it('banks what is already falling when the player leaves', () => {
    const { round, banked } = setup();
    aimAndChop(round, 'a1', towardA2);
    while (round.phase.kind === 'chop') perfectChop(round);
    round.exit();
    expect(banked()).toBe(16);
  });

  it('an exponent of 1 is a log per tree', () => {
    expect(chainLogs(4, 1)).toBe(4);
  });
});

describe('chainLogs', () => {
  it('banks trees^exponent logs, as a whole number', () => {
    expect([1, 2, 3, 4, 6].map((trees) => chainLogs(trees, 2))).toEqual([1, 4, 9, 16, 36]);
    expect(chainLogs(3, 1.5)).toBe(5);
    expect(chainLogs(1, 0.5)).toBe(1);
    expect(chainLogs(2, 0.1)).toBe(1);
  });
});
