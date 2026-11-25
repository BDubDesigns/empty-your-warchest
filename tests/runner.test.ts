import { describe, expect, it } from 'vitest';
import type { GameDataInput, RunnerFeel } from '../src/data';
import {
  applyGate,
  gateLabel,
  previewGate,
  recoveredSpears,
  rollLevel,
  rollMax,
  runnerConfig,
  RunnerSim,
  spearSupply,
  Squad,
  UNARMED,
  type RunnerEvent,
  type Side,
} from '../src/runner/sim';
import { data, dataWith } from './helpers';

const QUALITIES = ['poor', 'good', 'perfect'];
const feel = data.runner.feel;

function sim(
  overrides: Partial<RunnerFeel> = {},
  seed: number | string = 1,
  gameData = data,
  commandLevel = 1,
) {
  const runFeel = { ...feel, ...overrides };
  const spears = spearSupply(QUALITIES, runFeel);
  return new RunnerSim(runnerConfig(gameData, runFeel, seed, { commandLevel, spears }));
}

/** Runs to the end, steering with `steer(sim)` each step. Returns every event. */
function play(runner: RunnerSim, steer: (runner: RunnerSim) => number): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  for (let i = 0; i < 60 * 600 && !runner.done; i++) events.push(...runner.step(steer(runner)));
  return events;
}

type Pick = 'safe' | 'greedy';

/**
 * Steers each gate pair in turn to its safe side (unguarded) or its greedy side (guarded); sides
 * are shuffled each run, so this reads them from the rolled track.
 */
function route(...picks: Pick[]) {
  return (runner: RunnerSim): number => {
    const pairsPassed = runner.track
      .slice(0, runner.nextIndex)
      .filter((event) => event.kind === 'gates').length;
    const pick = picks[pairsPassed] ?? 'safe';
    const gates = runner.nextGates?.event;
    const greedy: Side = gates?.left.base.guards ? 'left' : 'right';
    const side = pick === 'greedy' ? greedy : greedy === 'left' ? 'right' : 'left';
    return side === 'left' ? -runner.halfWidth : runner.halfWidth;
  };
}

/** One fixed skirmish for focused tests: no rolls, no shuffle. */
function fixedLevel(events: GameDataInput['levels'][number]['events'], startingRecruits = 1) {
  return dataWith((raw) => {
    const level = raw.levels[0];
    if (!level) return;
    level.events = events;
    level.startingRecruits = startingRecruits;
  });
}

const QUICK_WALL = {
  type: 'wall',
  at: 1,
  hp: 1,
  archers: { volleySeconds: 99, perVolley: 1 },
} as const;

describe('gates', () => {
  it('adds, subtracts, multiplies and divides, never below zero, dividing up', () => {
    expect(applyGate(10, { op: 'add', value: 15 })).toBe(25);
    expect(applyGate(10, { op: 'subtract', value: 15 })).toBe(0);
    expect(applyGate(10, { op: 'multiply', value: 3 })).toBe(30);
    expect(applyGate(25, { op: 'divide', value: 2 })).toBe(13);
  });

  it('labels gates the way players read them', () => {
    expect(gateLabel({ op: 'add', value: 15 })).toBe('+15');
    expect(gateLabel({ op: 'multiply', value: 2 })).toBe('×2');
    expect(gateLabel({ op: 'subtract', value: 5 })).toBe('−5');
    expect(gateLabel({ op: 'divide', value: 2 })).toBe('÷2');
  });

  it('previews the new count and how many of them are armed, without changing the squad', () => {
    const squad = new Squad(QUALITIES, { poor: 5, good: 10, perfect: 10 });
    squad.recruit(38);
    expect(squad.armedCount).toBe(25);
    expect(previewGate(squad, { op: 'multiply', value: 2 })).toEqual({
      from: 38,
      to: 76,
      armedTo: 25,
    });
    expect(squad.count).toBe(38);
  });
});

describe('arming', () => {
  it('hands out spears worst-first; extra recruits are unarmed', () => {
    const squad = new Squad(QUALITIES, { poor: 2, good: 3, perfect: 1 });
    squad.recruit(4);
    expect(squad.snapshot()).toEqual({ unarmed: 0, armed: { poor: 2, good: 2, perfect: 0 } });
    squad.recruit(5);
    expect(squad.snapshot()).toEqual({ unarmed: 3, armed: { poor: 2, good: 3, perfect: 1 } });
    expect(squad.spearsUsed).toBe(6);
  });

  it('fights and falls spearmen first, worst spear first; the unarmed are the reserve', () => {
    const squad = new Squad(QUALITIES, { poor: 1, good: 1, perfect: 1 });
    squad.recruit(5);
    expect(squad.front()).toBe('poor');
    expect(squad.fall(4)).toEqual(['poor', 'good', 'perfect', UNARMED]);
    expect(squad.front()).toBe(UNARMED);
  });

  it('sheds the unarmed extras first at a bad gate', () => {
    const squad = new Squad(QUALITIES, { poor: 1, good: 1, perfect: 1 });
    squad.recruit(5);
    expect(squad.shed(3)).toEqual([UNARMED, UNARMED, 'poor']);
  });

  it('starts a run with one guy, armed if there is a spear', () => {
    const runner = sim({ spearsPoor: 0, spearsGood: 3, spearsPerfect: 0 });
    expect(runner.squad.count).toBe(1);
    expect(runner.squad.armedCount).toBe(1);
    expect(runner.squad.usedByQuality).toEqual({ poor: 0, good: 1, perfect: 0 });
  });

  it('recovers a share of the spears used on a win, and none on a loss', () => {
    const used = { poor: 3, good: 10, perfect: 1 };
    const rates = { poor: 0.5, good: 0.5, perfect: 0.5 };
    expect(recoveredSpears(used, true, rates)).toEqual({ poor: 1, good: 5, perfect: 0 });
    expect(recoveredSpears(used, false, rates)).toEqual({ poor: 0, good: 0, perfect: 0 });
  });
});

describe('rolled tracks', () => {
  const level = data.levels[0];
  if (!level) throw new Error('No level in data');

  it('rolls the same track for the same seed and Command level', () => {
    expect(rollLevel(level, 7, 'seed')).toEqual(rollLevel(level, 7, 'seed'));
    const tracks = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(rollLevel(level, 20, seed))),
    );
    expect(tracks.size).toBeGreaterThan(1);
  });

  it('scales rolls with Command level, never past the max', () => {
    expect(rollMax({ min: 1, perLevel: 1 }, 1)).toBe(1);
    expect(rollMax({ min: 1, perLevel: 1 }, 10)).toBe(10);
    expect(rollMax({ min: 3, perLevel: 0.3 }, 11)).toBe(6);
    expect(rollMax(5, 50)).toBe(5);
    for (let seed = 0; seed < 20; seed++) {
      for (const event of rollLevel(level, 1, seed)) {
        if (event.type === 'enemies') {
          const template = level.events.find((entry) => entry.at === event.at);
          if (template?.type === 'enemies') expect(event.count).toBe(rollMax(template.count, 1));
        }
      }
    }
  });

  it('swaps the sides of shuffled gate pairs on some runs', () => {
    const guardedSides = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map((seed) => {
        const first = rollLevel(level, 1, seed).find((event) => event.type === 'gates');
        return first?.type === 'gates' && first.left.guards ? 'left' : 'right';
      }),
    );
    expect(guardedSides).toEqual(new Set(['left', 'right']));
  });
});

describe('runner', () => {
  it('gives the same run for the same inputs and seed', () => {
    const steer = (runner: RunnerSim): number => Math.sin(runner.steps / 40) * 4;
    const first = play(sim({}, 'replay'), steer);
    const second = play(sim({}, 'replay'), steer);
    expect(second).toEqual(first);
    expect(first.at(-1)?.type).toMatch(/won|lost/);
  });

  it('takes the gate on the side the squad centre is on', () => {
    const runner = sim();
    const first = runner.nextGates?.event;
    const safeSide: Side = first?.left.base.guards ? 'right' : 'left';
    const events = play(runner, route('safe', 'safe', 'safe'));
    const gates = events.filter((event) => event.type === 'gate');
    const value = first?.[safeSide].base.value ?? 0;
    expect(gates[0]).toMatchObject({ side: safeSide, gate: { op: 'add', value }, good: true });
    expect(gates[0]?.after).toBe(1 + value);
  });

  it('steers no faster than the steering speed', () => {
    const runner = sim({ steerSmoothing: 0, steerSpeed: 6 });
    runner.step(100);
    expect(runner.x).toBeCloseTo(6 / 60);
    for (let i = 0; i < 600; i++) runner.step(100);
    expect(runner.x).toBeCloseTo(runner.maxX);
  });

  it("makes a squad fight a gate's guards to reach it, and only on that side", () => {
    const spears = { spearsPoor: 0, spearsGood: 0, spearsPerfect: 100 };
    const fought = play(sim(spears), route('safe', 'safe', 'greedy'));
    expect(fought.filter((event) => event.type === 'clashStart')).toHaveLength(3);
    const third = fought.filter((event) => event.type === 'gate')[2];
    expect(third).toMatchObject({ gate: { op: 'multiply', value: 3 }, good: true });

    // On the other side the guards are skipped.
    const skipped = play(sim(spears), route('safe', 'safe', 'safe'));
    expect(skipped.filter((event) => event.type === 'avoided')).toHaveLength(3);
    expect(skipped.filter((event) => event.type === 'gate')[2]).toMatchObject({
      gate: { op: 'add' },
    });
  });

  it('lets a spear beat an unarmed bandit in one blow, and fists never beat a spear', () => {
    const gameData = (armedShare: number) =>
      fixedLevel([{ type: 'enemies', at: 0.1, enemy: 'bandit', count: 3, armedShare }, QUICK_WALL]);
    const spear = sim({ spearsPoor: 0, spearsGood: 1, spearsPerfect: 0 }, 1, gameData(0));
    const blows = play(spear, () => 0).filter((event) => event.type === 'blow');
    expect(blows.map((blow) => blow.enemyFell)).toEqual([true, true, true]);
    expect(blows.every((blow) => !blow.unitFell)).toBe(true);
    expect(blows[0]).toMatchObject({ fighter: 'good', enemy: UNARMED });

    const fists = sim({ spearsPoor: 0, spearsGood: 0, spearsPerfect: 0 }, 1, gameData(1));
    const lost = play(fists, () => 0).filter((event) => event.type === 'blow');
    expect(lost).toEqual([expect.objectContaining({ unitFell: true, enemyFell: false })]);
    expect(fists.result?.won).toBe(false);
  });

  it('trades Good spears for armed bandits one for one, and Perfect spears win', () => {
    const armedOnly = (spears: Partial<RunnerFeel>) => {
      const gameData = fixedLevel(
        [{ type: 'enemies', at: 0.1, enemy: 'bandit', count: 5, armedShare: 1 }, QUICK_WALL],
        5,
      );
      const runner = sim(
        { spearsPoor: 0, spearsGood: 0, spearsPerfect: 0, ...spears },
        1,
        gameData,
      );
      play(runner, () => 0);
      return runner;
    };
    expect(armedOnly({ spearsGood: 5 }).result).toMatchObject({ won: false, cause: 'enemies' });
    expect(armedOnly({ spearsPerfect: 5 }).result?.won).toBe(true);
  });

  it('loses when the last soldier falls, even if the last bandit falls with him', () => {
    const gameData = fixedLevel([
      { type: 'enemies', at: 0.1, enemy: 'bandit', count: 1, armedShare: 1 },
      QUICK_WALL,
    ]);
    const runner = sim({ spearsPoor: 0, spearsGood: 1, spearsPerfect: 0 }, 1, gameData);
    const events = play(runner, () => 0);
    expect(events.at(-2)).toMatchObject({ type: 'blow', unitFell: true, enemyFell: true });
    expect(events.at(-1)).toMatchObject({ type: 'lost', cause: 'enemies' });
    expect(events.some((event) => event.type === 'clashWon')).toBe(false);
  });

  it('loses against bandits when the count hits zero', () => {
    const runner = sim({ spearsPoor: 0, spearsGood: 0, spearsPerfect: 0 });
    // No spears: unarmed recruits can't beat the armed bandits in the warm-up.
    const events = play(runner, route('safe'));
    expect(events.at(-1)).toMatchObject({ type: 'lost', cause: 'enemies' });
    expect(runner.result).toMatchObject({ won: false, survivors: 0 });
  });

  it('breaks the wall with the whole squad while archers fire volleys', () => {
    const runner = sim({ spearsPoor: 0, spearsGood: 0, spearsPerfect: 100 });
    const events = play(runner, route('greedy', 'greedy', 'greedy'));
    expect(events.some((event) => event.type === 'wallHit')).toBe(true);
    expect(events.at(-1)?.type).toBe('won');
    expect(runner.result?.survivors).toBeGreaterThan(0);
    expect(runner.result?.spearsUsed).toBeGreaterThan(0);
  });

  it('loses at the wall when the volleys get everyone before it breaks', () => {
    const toughWall = dataWith((raw) => {
      const wall = raw.levels[0]?.events.at(-1);
      if (wall?.type === 'wall') wall.hp = 100_000;
    });
    const runner = sim({ spearsPoor: 0, spearsGood: 0, spearsPerfect: 100 }, 1, toughWall);
    const events = play(runner, route('greedy', 'greedy', 'greedy'));
    expect(events.filter((event) => event.type === 'volley').length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: 'lost', cause: 'wall' });
  });

  it('only previews a gate pair within reading distance', () => {
    const runner = sim();
    expect(runner.preview()).toBeUndefined();
    while (!runner.preview()) runner.step(-runner.halfWidth);
    const firstGate = runner.nextGates?.event;
    const ahead = (firstGate?.at ?? 0) - runner.distance;
    expect(ahead).toBeLessThanOrEqual(feel.runSpeed * feel.gateReadSeconds + 1e-9);
    const value = firstGate?.left.base.value ?? 0;
    expect(runner.preview()).toMatchObject({ side: 'left', from: 1, to: 1 + value });
  });
});
