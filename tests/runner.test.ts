import { describe, expect, it } from 'vitest';
import type { RunnerFeel } from '../src/data';
import {
  applyGate,
  gateLabel,
  previewGate,
  runnerConfig,
  RunnerSim,
  Squad,
  UNARMED,
  type RunnerEvent,
  type Side,
} from '../src/runner/sim';
import { data, dataWith } from './helpers';

const QUALITIES = ['poor', 'good', 'perfect'];
const feel = data.runner.feel;

function sim(overrides: Partial<RunnerFeel> = {}, seed: number | string = 1, gameData = data) {
  return new RunnerSim(runnerConfig(gameData, { ...feel, ...overrides }, seed));
}

/** Runs to the end, steering with `steer(sim)` each step. Returns every event. */
function play(runner: RunnerSim, steer: (runner: RunnerSim) => number): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  for (let i = 0; i < 60 * 600 && !runner.done; i++) events.push(...runner.step(steer(runner)));
  return events;
}

/** Steers to a side for each gate pair in turn (by pair order), the middle otherwise. */
function route(...sides: Side[]) {
  return (runner: RunnerSim): number => {
    const pairsPassed = runner.track
      .slice(0, runner.nextIndex)
      .filter((event) => event.kind === 'gates').length;
    const side = sides[pairsPassed] ?? 'left';
    return side === 'left' ? -runner.halfWidth : runner.halfWidth;
  };
}

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

  it('loses the unarmed first, then the worst spears', () => {
    const squad = new Squad(QUALITIES, { poor: 1, good: 1, perfect: 1 });
    squad.recruit(5);
    expect(squad.lose(4)).toEqual([UNARMED, UNARMED, 'poor', 'good']);
    expect(squad.front()).toBe('perfect');
  });

  it('starts a run with the slider spears', () => {
    const runner = sim({ spearsPoor: 0, spearsGood: 3, spearsPerfect: 0 });
    expect(runner.squad.count).toBe(data.levels[0]?.startingRecruits);
    expect(runner.squad.armedCount).toBe(3);
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
    const events = play(runner, route('left', 'left', 'left'));
    const gates = events.filter((event) => event.type === 'gate');
    expect(gates[0]).toMatchObject({ side: 'left', gate: { op: 'add', value: 10 }, good: true });
    expect(gates[0]?.after).toBe((gates[0]?.before ?? 0) + 10);
  });

  it('steers no faster than the steering speed', () => {
    const runner = sim({ steerSmoothing: 0, steerSpeed: 6 });
    runner.step(100);
    expect(runner.x).toBeCloseTo(6 / 60);
    for (let i = 0; i < 600; i++) runner.step(100);
    expect(runner.x).toBeCloseTo(runner.maxX);
  });

  it('flips a gate the squad attacks long enough, and not one it ignores', () => {
    const flipped = play(sim({ flipAttackRate: 10 }), route('left', 'left', 'right'));
    const third = flipped.filter((event) => event.type === 'gate')[2];
    expect(flipped.some((event) => event.type === 'flip')).toBe(true);
    expect(flipped.filter((event) => event.type === 'guardFell')).toHaveLength(4);
    expect(third).toMatchObject({ gate: { op: 'multiply', value: 3 }, flipped: true, good: true });

    // Steering over only at the last moment leaves no time to fill the bar.
    const late = play(sim({ flipAttackRate: 10 }), (runner) => {
      const next = runner.nextGates;
      const flipPair = next?.event.right.base.flip !== undefined;
      const close = next !== undefined && next.event.at - runner.distance < 0.5;
      return flipPair && close ? runner.halfWidth : -runner.halfWidth;
    });
    expect(late.some((event) => event.type === 'flip')).toBe(false);
    const events = play(sim({ flipAttackRate: 0 }), route('left', 'left', 'right'));
    const gate = events.filter((event) => event.type === 'gate')[2];
    expect(gate).toMatchObject({ gate: { op: 'subtract', value: 10 }, good: false });
  });

  it('only fights a lane group when the squad is on its side', () => {
    const avoided = play(sim(), route('left', 'left', 'left'));
    expect(avoided.some((event) => event.type === 'avoided')).toBe(true);
    const fought = play(sim(), route('left', 'right', 'left'));
    const clashes = fought.filter((event) => event.type === 'clashStart');
    expect(clashes).toHaveLength(3);
  });

  it('duels on the front line: a Good spear beats an unarmed bandit and fights on wounded', () => {
    const runner = sim({ spearsPoor: 0, spearsGood: 100, spearsPerfect: 0 });
    const events = play(runner, route('left', 'left', 'left'));
    const start = events.findIndex((event) => event.type === 'clashStart');
    const blows = events.slice(start).filter((event) => event.type === 'blow');
    // 4 damage a blow drops a 10-HP bandit on the third; an unarmed bandit's 1 damage a blow
    // leaves the spearman standing.
    expect(blows.slice(0, 3).map((blow) => blow.enemyFell)).toEqual([false, false, true]);
    expect(blows.slice(0, 3).some((blow) => blow.unitFell)).toBe(false);
    expect(blows[0]).toMatchObject({ fighter: 'good', enemy: UNARMED });
  });

  it('trades Good spears for armed bandits one for one, and Perfect spears win', () => {
    const armedOnly = (spears: Partial<RunnerFeel>) => {
      const gameData = dataWith((raw) => {
        const level = raw.levels[0];
        if (!level) return;
        level.events = [
          { type: 'enemies', at: 0.1, enemy: 'bandit', count: 5, armed: 5 },
          { type: 'wall', at: 1, hp: 1, archers: { volleySeconds: 99, perVolley: 1 } },
        ];
        level.startingRecruits = 5;
      });
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
    const gameData = dataWith((raw) => {
      const level = raw.levels[0];
      if (!level) return;
      level.events = [
        { type: 'enemies', at: 0.1, enemy: 'bandit', count: 1, armed: 1 },
        { type: 'wall', at: 1, hp: 1, archers: { volleySeconds: 99, perVolley: 1 } },
      ];
      level.startingRecruits = 1;
    });
    const runner = sim({ spearsPoor: 0, spearsGood: 1, spearsPerfect: 0 }, 1, gameData);
    const events = play(runner, () => 0);
    expect(events.at(-2)).toMatchObject({ type: 'blow', unitFell: true, enemyFell: true });
    expect(events.at(-1)).toMatchObject({ type: 'lost', cause: 'enemies' });
    expect(events.some((event) => event.type === 'clashWon')).toBe(false);
  });

  it('loses against bandits when the count hits zero', () => {
    const runner = sim({ spearsPoor: 0, spearsGood: 0, spearsPerfect: 0 });
    // A bad gate and no spears: unarmed recruits can't beat the first bandits.
    const events = play(runner, route('right'));
    expect(events.at(-1)).toMatchObject({ type: 'lost', cause: 'enemies' });
    expect(runner.result).toMatchObject({ won: false, survivors: 0 });
  });

  it('breaks the wall with the whole squad while archers fire volleys', () => {
    const runner = sim({ spearsPoor: 0, spearsGood: 0, spearsPerfect: 100 });
    const events = play(runner, route('left', 'right', 'right'));
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
    const events = play(runner, route('left', 'right', 'right'));
    expect(events.filter((event) => event.type === 'volley').length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: 'lost', cause: 'wall' });
  });

  it('only previews a gate pair within reading distance', () => {
    const runner = sim();
    expect(runner.preview()).toBeUndefined();
    while (!runner.preview()) runner.step(-runner.halfWidth);
    const firstGate = runner.nextEvent;
    expect(firstGate?.kind).toBe('gates');
    const ahead = (firstGate?.at ?? 0) - runner.distance;
    expect(ahead).toBeLessThanOrEqual(feel.runSpeed * feel.gateReadSeconds + 1e-9);
    expect(runner.preview()).toMatchObject({ side: 'left', from: 10, to: 20 });
  });
});
