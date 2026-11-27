import { beforeAll, describe, expect, it } from 'vitest';
import { Rng, type LogEvent } from '../src/core';
import {
  GameDataError,
  parseGameData,
  type FortBlock,
  type GameData,
  type GameDataInput,
  type SiegeGuard,
} from '../src/data';
import { siegeTunables } from '../src/stations/siege/feel';
import { fortProblems } from '../src/stations/siege/logic/fairness';
import { objectiveMet } from '../src/stations/siege/logic/objective';
import { loadPhysics, type Physics } from '../src/stations/siege/logic/physics';
import {
  SiegeRound,
  tiltOf,
  type Pose,
  type SiegeEvent,
  type SiegeResult,
} from '../src/stations/siege/logic/round';
import { siegeRewards, siegeStars } from '../src/stations/siege/logic/score';
import {
  aimedVolley,
  clampAim,
  launchFrom,
  shotSpears,
  siegeWeapon,
  solveAim,
  spearsShot,
  startAim,
  volleySize,
  type Aim,
  type Spot,
  type ThrowMode,
  type Vec3,
} from '../src/stations/siege/logic/throw';
import { data, dataWith, editableRawData, testLogger } from './helpers';

let physics: Physics;
beforeAll(async () => {
  physics = await loadPhysics();
});

const DEG = Math.PI / 180;
const WEAPON = siegeWeapon(data.siege);
const AIMED = WEAPON.aimed.start;
const pose = (): Pose => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

/** A round on `fort`, with `spears` in a pretend warchest. */
function siege(
  fort: string,
  {
    spears = 600,
    aimed = AIMED,
    seed = 7,
    game = data,
    position,
  }: Partial<{
    spears: number;
    aimed: number;
    seed: number;
    game: GameData;
    position: number;
  }> = {},
) {
  const { logger } = testLogger();
  const logs: LogEvent[] = [];
  logger.onLog((event) => logs.push(event));
  const warchest = { spears };
  const events: SiegeEvent[] = [];
  const finished: SiegeResult[] = [];
  const round = new SiegeRound(
    physics,
    game,
    fort,
    {
      logger,
      feel: () => game.siege.feel,
      spears: () => warchest.spears,
      spend: (count) => {
        warchest.spears -= count;
      },
      finish: (result) => finished.push(result),
      onEvent: (event) => events.push(event),
    },
    { aimed, seed, ...(position !== undefined && { position }) },
  );
  return { round, warchest, events, finished, logs };
}

function run(round: SiegeRound, steps: number): void {
  for (let step = 0; step < steps && round.phase !== 'done'; step++) round.step();
}

/** Steps until the weapon can shoot again (or the round moves on), at most `steps`. */
function reload(round: SiegeRound, steps = 600): void {
  for (let step = 0; step < steps && !round.canThrow && round.phase !== 'done'; step++) {
    round.step();
  }
}

/** The aim Fire takes at `target` from `spot`: through it, allowing for the drop. */
function aimAt(spot: Spot, target: Vec3): Aim {
  return solveAim(spot, target, WEAPON, data.siege.physics.gravity);
}

/** The real data with an extra one-position fort, `test`, of these blocks (unchecked). */
function fortData(
  blocks: Omit<FortBlock, 'piece' | 'pieceKind' | 'banner' | 'weak' | 'merlon' | 'pane'>[] &
    object[],
) {
  const game = structuredClone(data);
  game.siege.forts.push({
    id: 'test',
    name: 'Test',
    par: 5,
    guardsVisible: 'some',
    rewards: { xpPerBlock: 2, xpPerGuard: 5, winXp: 10 },
    pieces: [],
    blocks: blocks.map((block) => ({
      banner: false,
      weak: false,
      merlon: false,
      pane: false,
      ...block,
      piece: 0,
      pieceKind: 'wall' as const,
    })),
    positions: [
      {
        name: 'Test',
        spots: [
          [0, 0],
          [3, 0],
        ],
        guards: [],
        approach: [],
        objective: { kind: 'banner_down' },
      },
    ],
  });
  return game;
}

/** A thin, tall board, the banner, standing on its own 10 m out. */
const BOARD = {
  material: 'wood',
  size: [2.5, 3, 0.1] as [number, number, number],
  at: [0, 1.5, -10] as [number, number, number],
  banner: true,
  // Never breaks: it has to fall.
  hp: 100000,
};

/** Steps a player watches after a shot: two seconds, long enough to see a collapse through. */
const WATCH_STEPS = 120;

/**
 * A scripted player, a decent one: at each position it shoots aimed volleys at what wins it
 * (each guard's chest, then its head; at the keep, the thin posts, then the keep itself),
 * allowing for the drop, and a barrage every fourth shot. Returns the round when it's over.
 */
function play(fort: string, seed: number, aimed = AIMED) {
  const game = siege(fort, { seed, spears: 600, aimed });
  const { round } = game;
  const [, height] = data.siege.guard.size;
  let tries = 0;
  let at = round.position;
  while (round.phase !== 'done' && round.throws < 40) {
    reload(round);
    if (round.phase === 'won') break;
    if (!round.canThrow) break;
    if (round.position !== at) {
      at = round.position;
      tries = 0;
    }
    const index = round.guards.findIndex(
      (entry) => entry.position === round.position && !entry.down,
    );
    const guard = round.guards[index];
    let target: Vec3;
    if (guard) {
      // A guard on the wall: wait till he's stopped and stood up (out from cover), then aim at
      // his head and shoulders in the gap; a walking one, a little ahead of him.
      const { walker } = guard;
      for (
        let wait = 0;
        wait < 300 &&
        walker.mode === 'alert' &&
        (walker.step === 'dash' || walker.ducked > 0.1 || Math.abs(walker.x - walker.to) > 0.01);
        wait++
      ) {
        round.step();
      }
      const now = round.guardPose(index, pose()).position;
      const [, y] = guard.guard.at;
      const walkingNow = walker.mode === 'patrol' && walker.timer <= 0;
      const lead = walkingNow ? walker.heading * data.siege.guardMoves.patrolSpeed * 0.3 : 0;
      const share = guard.guard.walk ? 0.8 : tries % 2 === 0 ? 0.6 : 0.85;
      target = { x: now.x + lead, y: y + height * share, z: now.z };
      if (guard.guard.walk) target = throughGap(round, guard.guard, target);
    } else {
      const weak = round.blocks.find(
        (block) => block.block.weak && !block.broken && block.block.pieceKind === 'keep',
      );
      const keep = round.fort.blocks.find((block) => block.pieceKind === 'keep');
      const [x, y, z] = weak?.block.at ?? keep?.at ?? [0, 2, 0];
      target = { x, y, z };
    }
    const mode: ThrowMode = tries % 4 === 3 ? 'barrage' : 'aimed';
    round.throw(mode, aimAt(round.ballista(), target));
    tries++;
    // It watches where the volley went (and what it brought down) before the next.
    run(round, WATCH_STEPS);
  }
  run(round, 900);
  return game;
}

/**
 * Where to aim at a guard on a walkway so the shot goes through the gap between the merlons in
 * front of him (what a player sees of him), rather than at his middle (which, from off to one
 * side, is often behind a merlon).
 */
function throughGap(round: SiegeRound, guard: SiegeGuard, target: Vec3): Vec3 {
  const spot = round.ballista();
  const merlon = round.fort.blocks.find((block) => block.merlon && block.at[2] > target.z);
  const gaps = (guard.cover ?? []).flatMap((x) => [x - (guard.gap ?? 0), x + (guard.gap ?? 0)]);
  if (!merlon || gaps.length === 0) return target;
  const wall = merlon.at[2];
  const onWall = spot.x + ((target.x - spot.x) * (wall - spot.z)) / (target.z - spot.z);
  const gap = gaps.reduce((best, x) => (Math.abs(x - onWall) < Math.abs(best - onWall) ? x : best));
  const x = spot.x + ((gap - spot.x) * (target.z - spot.z)) / (wall - spot.z);
  const half = data.siege.guard.size[0] / 2;
  return Math.abs(x - target.x) < half ? { ...target, x } : target;
}

describe('siege forts', () => {
  it('stand still on their own until hit, guards and all', () => {
    for (const fort of data.siege.forts) {
      const { round } = siege(fort.id);
      run(round, 600);
      round.blocks.forEach((block, index) => {
        const { position } = round.blockPose(index, pose());
        const moved = Math.hypot(
          position.x - block.start.x,
          position.y - block.start.y,
          position.z - block.start.z,
        );
        expect(moved, `${fort.id} block ${String(index)}`).toBeLessThan(0.02);
      });
      round.guards.forEach((guard, index) => {
        const { position, rotation } = round.guardPose(index, pose());
        expect(position.y - guard.guard.at[1]).toBeCloseTo(data.siege.guard.size[1] / 2, 1);
        expect(tiltOf(rotation)).toBeLessThan(1);
        expect(guard.down).toBe(false);
      });
      expect(round.blocksDown).toBe(0);
      expect(round.phase).toBe('aim');
      round.dispose();
    }
  });

  it('are built from pieces, each block knowing its piece', () => {
    const fort = data.siege.forts[0];
    if (!fort) throw new Error('No fort');
    const kinds = new Set(fort.blocks.map((block) => block.pieceKind));
    for (const kind of ['wall', 'gate', 'cover', 'platform', 'keep', 'walkway']) {
      expect(kinds).toContain(kind);
    }
    expect(fort.blocks.some((block) => block.merlon)).toBe(true);
    expect(fort.blocks.filter((block) => block.banner)).toHaveLength(1);
    expect(fort.positions.map((position) => position.guards.length)).toEqual([2, 1, 0]);
  });

  it('an aimed volley at the outer wall hits it, dealing damage', () => {
    const { round, events } = siege('outpost');
    expect(round.throw('aimed', aimAt(round.ballista(), { x: 3, y: 0.9, z: -20 }))).toBe(true);
    run(round, 180);
    const hits = events.flatMap((event) => (event.type === 'hit' ? [event] : []));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.kind).toBe('stone');
    expect(round.blocks.some((block) => block.hp < block.maxHp)).toBe(true);
    // Every impact is there for other rules (noise, later) to hook into.
    expect(events.some((event) => event.type === 'impact' && event.by === 'spear')).toBe(true);
    round.dispose();
  });

  it('replays exactly: the same seed and shots on the same steps give the same result', () => {
    const play = () => {
      const { round, events } = siege('outpost', { seed: 42 });
      round.throw('barrage', aimAt(round.ballista(), { x: 3, y: 1.5, z: -20 }));
      run(round, 90);
      round.moveTo(2);
      run(round, 60);
      round.throw('aimed', aimAt(round.ballista(), { x: 6, y: 1.2, z: -20 }));
      run(round, 400);
      const outcome = {
        poses: round.blocks.map((_, index) => round.blockPose(index, pose())),
        guards: round.guards.map((_, index) => round.guardPose(index, pose())),
        hp: round.blocks.map((block) => block.hp),
        events: events.map((event) => event.type),
        used: round.used,
      };
      round.dispose();
      return outcome;
    };
    const first = play();
    expect(first.events).toContain('hit');
    expect(play()).toEqual(first);
  });

  it('a stone wall block breaks in about two aimed volleys', () => {
    const { round, events } = siege('stronghold');
    let volleys = 0;
    while (
      !events.some((event) => event.type === 'break' && event.kind === 'stone') &&
      volleys < 6
    ) {
      reload(round);
      round.throw('aimed', aimAt(round.ballista(), { x: -2, y: 0.9, z: -20 }));
      volleys++;
      run(round, 60);
    }
    expect(volleys).toBeLessThanOrEqual(3);
    round.dispose();
  });

  it('a gate breaks in one aimed volley', () => {
    const { round, events } = siege('outpost');
    round.throw('aimed', aimAt(round.ballista(), { x: -5, y: 1.5, z: -20 }));
    run(round, 120);
    const broken = events.flatMap((event) => (event.type === 'break' ? [event] : []));
    expect(broken.some((event) => round.blocks[event.block]?.block.pieceKind === 'gate')).toBe(
      true,
    );
    round.dispose();
  });

  it('the keep takes more than one aimed volley, even at Command 17', () => {
    const aimed = aimedVolley(WEAPON, 17);
    for (const fort of data.siege.forts) {
      const { round } = siege(fort.id, { position: fort.positions.length - 1, aimed });
      const weak = round.blocks.find(
        (block) => block.block.weak && block.block.pieceKind === 'keep',
      );
      if (!weak) throw new Error(`No weak post on the ${fort.id} keep`);
      const [x, y, z] = weak.block.at;
      round.throw('aimed', aimAt(round.ballista(), { x, y, z }));
      run(round, 300);
      expect(round.blocks.some((block) => block.broken || block.hp < block.maxHp)).toBe(true);
      // It may sag on what's left, but the banner's still up.
      expect(round.phase, fort.id).toBe('aim');
      const banner = round.blockPose(round.bannerIndex, pose());
      expect(banner.position.y).toBeGreaterThan(data.siege.banner.winHeight + 1);
      round.dispose();
    }
  });

  it('a block at 0 hit points breaks and leaves the world, so what it held up falls', () => {
    // A beam on two posts, the one in the line of fire fragile, and the banner well off to one side.
    const game = fortData([
      { material: 'wood', size: [0.3, 1.2, 0.3], at: [-2, 0.6, -10] },
      { material: 'wood', size: [0.3, 1.2, 0.3], at: [0, 0.6, -10], hp: 1 },
      { material: 'wood', size: [3, 0.2, 0.6], at: [-1, 1.3, -10] },
      { ...BOARD, at: [8, 1.5, -10] },
    ]);
    const { round, events } = siege('test', { game });
    round.throw('aimed', aimAt(round.ballista(), { x: 0, y: 0.6, z: -10 }));
    run(round, 240);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'break', block: 1 }) as SiegeEvent,
    );
    expect(round.blocks[1]?.broken).toBe(true);
    // Gone from the world: no spear shot later can touch it.
    const hitsOn = () =>
      events.filter(
        (event) =>
          event.type === 'hit' && event.target.kind === 'block' && event.target.index === 1,
      ).length;
    const before = hitsOn();
    reload(round);
    round.throw('aimed', aimAt(round.ballista(), { x: 0, y: 0.6, z: -10 }));
    run(round, 240);
    expect(hitsOn()).toBe(before);
    // The beam it held up has come down at that end.
    expect(round.blockPose(2, pose()).position.y).toBeLessThan(1.3 - 0.3);
    round.dispose();
  });

  it('a banner on the ground wins, and the round ends once the fort settles', () => {
    const game = fortData([BOARD]);
    const { round, events, finished } = siege('test', { game });
    round.throw('aimed', aimAt(round.ballista(), { x: 0, y: 2.2, z: -10 }));
    run(round, 900);
    expect(events.map((event) => event.type)).toContain('won');
    expect(round.phase).toBe('done');
    expect(finished[0]?.won).toBe(true);
    expect(finished[0]?.used).toBe(AIMED);
    expect(finished[0]?.throws).toBe(1);
    expect(finished[0]?.stars).toBe(3);
    round.dispose();
  });

  it('with no spears left, the round is lost once everything has settled', () => {
    const { round, finished, logs } = siege('outpost', { spears: 3 });
    round.throw('aimed', { yaw: 0, tilt: 0 });
    run(round, 900);
    expect(round.phase).toBe('done');
    expect(finished[0]?.won).toBe(false);
    expect(finished[0]?.recovered).toBe(0);
    const end = logs.find((event) => event.type === 'siege.end');
    expect(end?.data).toMatchObject({
      won: false,
      throws: 1,
      throwsPerPosition: [1, 0, 0],
      spearsUsed: 3,
      par: data.siege.forts[0]?.par,
    });
    for (const key of ['blocksBroken', 'piecesBroken', 'guardsDown', 'damage']) {
      expect(end?.data).toHaveProperty(key);
    }
    round.dispose();
  });
});

describe('siege guards and positions', () => {
  it('a direct hit brings a guard down: it topples, and it is logged', () => {
    const { round, events, logs } = siege('outpost', { position: 1 });
    const index = round.guards.findIndex((guard) => guard.position === 1);
    const guard = round.guards[index];
    if (!guard) throw new Error('No guard');
    const [x, y, z] = guard.guard.at;
    round.throw('aimed', aimAt(round.ballista(), { x, y: y + 1.5, z }));
    run(round, 240);
    expect(events.some((event) => event.type === 'hit' && event.kind === 'guard')).toBe(true);
    expect(guard.down).toBe(true);
    expect(tiltOf(round.guardPose(index, pose()).rotation)).toBeGreaterThan(
      data.siege.guard.downTilt,
    );
    expect(logs.some((event) => event.type === 'siege.guardDown')).toBe(true);
    round.dispose();
  });

  it('with its guards down, a position is won and the weapon rolls on to the next', () => {
    const { round, events, logs } = siege('outpost', { position: 1 });
    const feel = data.siege.feel;
    for (const guard of round.guards.filter((entry) => entry.position === 1)) {
      const [x, y, z] = guard.guard.at;
      for (let shot = 0; shot < 4 && !guard.down; shot++) {
        reload(round);
        round.throw('aimed', aimAt(round.ballista(), { x, y: y + 1.5 - shot * 0.1, z }));
        run(round, 120);
      }
    }
    run(round, 30);
    expect(events.some((event) => event.type === 'positionWon')).toBe(true);
    run(round, Math.ceil((feel.advanceDelaySeconds + feel.advanceSeconds) * 60) + 10);
    expect(round.position).toBe(2);
    expect(round.phase).toBe('aim');
    const [sx, sz] = data.siege.forts[0]?.positions[2]?.spots[1] ?? [0, 0];
    expect(round.ballista()).toEqual({ x: sx, z: sz });
    expect(logs.some((event) => event.type === 'siege.position')).toBe(true);
    round.dispose();
  });

  it('moves between spots when tapped, and shoots from where it stands', () => {
    const { round, logs } = siege('outpost');
    expect(round.moveTo(2)).toBe(true);
    expect(round.canThrow).toBe(false);
    run(round, Math.ceil(data.siege.feel.spotSeconds * 60) + 2);
    const [x, z] = data.siege.forts[0]?.positions[0]?.spots[2] ?? [0, 0];
    expect(round.ballista()).toEqual({ x, z });
    round.throw('aimed', { yaw: 0, tilt: 2 * DEG });
    const thrown = logs.find((event) => event.type === 'siege.throw');
    expect(thrown?.data).toMatchObject({ mode: 'aimed', spot: 2, position: 0, tilt: 2, yaw: 0 });
    round.dispose();
  });

  it('the banner cannot be brought down from the first two positions', () => {
    const fort = data.siege.forts[0];
    if (!fort) throw new Error('No fort');
    for (const position of [0, 1]) {
      for (let spot = 0; spot < (fort.positions[position]?.spots.length ?? 0); spot++) {
        const { round } = siege('outpost', { position, spears: 100000 });
        round.moveTo(spot);
        run(round, 60);
        for (const tilt of [-2, 2, 5, 8]) {
          for (const yaw of [-20, -8, 8, 20]) {
            reload(round, 120);
            // Won, and rolled on to the keep while reloading: these shots are done.
            if (round.position !== position) break;
            round.throw('barrage', { yaw: yaw * DEG, tilt: tilt * DEG });
          }
        }
        run(round, 300);
        const banner = round.blockPose(round.bannerIndex, pose());
        const start = fort.blocks[round.bannerIndex]?.at[1] ?? 0;
        expect(banner.position.y, `position ${String(position)} spot ${String(spot)}`).toBeCloseTo(
          start,
          1,
        );
        round.dispose();
      }
    }
  }, 120_000);

  it('a scripted player at Command 19 takes the Outpost for 25 to 40 spears, the Stronghold about 50 to 90', () => {
    // Guards on the walls dodge and duck: the scripted player waits them out and shoots through
    // the gaps, so a run costs a volley more or less than it used to.
    // Brandon's level: aimed volleys of 8, so a shot is 8 spears and "about" is a shot either way.
    const aimed = aimedVolley(WEAPON, 19);
    for (const [fort, low, high] of [
      // The first fort is the easy one.
      ['outpost', 25, 40],
      ['stronghold', 50, 90 + aimed],
    ] as const) {
      const spent: number[] = [];
      for (const seed of [1, 2, 3]) {
        const { round, finished } = play(fort, seed, aimed);
        expect(finished[0]?.won, `${fort} seed ${String(seed)}`).toBe(true);
        expect(finished[0]?.throwsPerPosition.every((throws) => throws > 0)).toBe(true);
        spent.push(round.used);
        round.dispose();
      }
      const average = spent.reduce((sum, used) => sum + used, 0) / spent.length;
      expect(average, `${fort}: ${spent.join(', ')}`).toBeGreaterThanOrEqual(low);
      expect(average, `${fort}: ${spent.join(', ')}`).toBeLessThanOrEqual(high);
    }
  }, 180_000);
});

describe('siege guards on watch', () => {
  const walkerIndex = (round: SiegeRound) =>
    round.guards.findIndex((guard) => guard.walker.mode === 'patrol');

  it('a guard walks his walkway, the same way every time for the same seed', () => {
    const walk = (seed: number) => {
      const { round } = siege('outpost', { seed });
      const index = walkerIndex(round);
      const xs = [0, 1, 2, 3].map(() => {
        run(round, 120);
        return round.guardPose(index, pose()).position.x;
      });
      const range = round.guards[index]?.guard.walk ?? [0, 0];
      round.dispose();
      return { xs, range };
    };
    const { xs, range } = walk(5);
    expect(new Set(xs.map((x) => x.toFixed(2))).size).toBeGreaterThan(1);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(range[0] - 0.01);
      expect(x).toBeLessThanOrEqual(range[1] + 0.01);
    }
    expect(walk(5).xs).toEqual(xs);
  });

  it('the first shot alerts the guard on the wall; a sleeper sleeps on through it', () => {
    const { round, events, logs } = siege('stronghold');
    const walker = walkerIndex(round);
    const sleeper = round.guards.findIndex(
      (guard) => guard.position === 0 && guard.walker.mode === 'sleep',
    );
    // Into the ground off to the left, near only the guard walking the left walkway.
    round.throw('aimed', { yaw: -0.45, tilt: -3 * DEG });
    run(round, 60);
    expect(round.guards[walker]?.walker.mode).toBe('alert');
    expect(round.guards[sleeper]?.walker.mode).toBe('sleep');
    expect(events).toContainEqual({ type: 'alerted', guard: walker, woke: false });
    expect(logs.some((event) => event.type === 'siege.noise')).toBe(true);
    expect(logs.find((event) => event.type === 'siege.guardWake')?.data).toMatchObject({
      guard: walker,
      from: 'patrol',
      to: 'alert',
      by: 'fire',
    });
    round.dispose();
  });

  it('smashing the gate wakes the sleeper behind it; he stands, looks round, then is alert', () => {
    const { round } = siege('stronghold');
    const sleeper = round.guards.findIndex(
      (guard) => guard.position === 0 && guard.walker.mode === 'sleep',
    );
    const gate = round.fort.pieces.find((piece) => piece.kind === 'gate');
    const [x, z] = gate?.at ?? [0, 0];
    round.throw('barrage', aimAt(round.ballista(), { x, y: 1.5, z }));
    run(round, 40);
    const mode = round.guards[sleeper]?.walker.mode;
    expect(['waking', 'alert']).toContain(mode);
    run(round, Math.ceil(data.siege.guardMoves.wakeSeconds * 60) + 10);
    if (!round.guards[sleeper]?.down) expect(round.guards[sleeper]?.walker.mode).toBe('alert');
    round.dispose();
  });

  it('a clean hit on a sleeper is quiet: a sleeper further off sleeps on', () => {
    const { round } = siege('stronghold', { aimed: 1 });
    const sleepers = round.guards.flatMap((guard, index) =>
      guard.position === 0 && guard.walker.mode === 'sleep' ? [index] : [],
    );
    const [near, far] = sleepers;
    if (near === undefined || far === undefined) throw new Error('Two sleepers wanted');
    // The noise of a hit on a guard doesn't reach the other sleeper.
    const hit = { x: 0, y: 1, z: 0 };
    const at = round.guards[near]?.guard.at ?? [0, 0, 0];
    Object.assign(hit, { x: at[0], y: at[1] + 1, z: at[2] });
    const reach = data.siege.noise.hit.guard * data.siege.noise.sleepShare;
    const other = round.guards[far]?.guard.at ?? [0, 0, 0];
    expect(Math.hypot(other[0] - hit.x, other[2] - hit.z)).toBeGreaterThan(reach);
    round.dispose();
  });
});

describe('siege windows', () => {
  it('a spear shatters a window and flies on through; the shatter is loud', () => {
    const { round, events, logs } = siege('outpost');
    const pane = round.blocks.findIndex((block) => block.block.pane);
    const state = round.blocks[pane];
    if (!state) throw new Error('No window');
    // From the spot in front of it, at the guard behind it.
    round.moveTo(0);
    run(round, Math.ceil(data.siege.feel.spotSeconds * 60) + 2);
    const guard = round.guards.find(
      (entry) => entry.guard.watch === 'stand' && entry.position === 0,
    );
    const [x, y, z] = guard?.guard.at ?? state.block.at;
    round.throw('aimed', aimAt(round.ballista(), { x, y: y + 1.1, z }));
    run(round, 60);
    expect(state.broken).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'break', block: pane, kind: 'glass' }),
    );
    // On through: the guard behind it is hit.
    expect(events.some((event) => event.type === 'hit' && event.kind === 'guard')).toBe(true);
    expect(
      logs.some((event) => event.type === 'siege.noise' && event.data?.source === 'break:glass'),
    ).toBe(true);
    round.dispose();
  });
});

describe('fort fairness', () => {
  it('passes for every fort in data', () => {
    for (const fort of data.siege.forts) expect(fortProblems(data.siege, fort)).toEqual([]);
  });

  /** The Outpost changed by `edit`, checked. */
  const outpost = (edit: (raw: GameDataInput) => void) => {
    const game = dataWith(edit);
    const fort = game.siege.forts[0];
    if (!fort) throw new Error('No fort');
    return fortProblems(game.siege, fort).map((problem) => problem.message);
  };

  it('fails when the keep can be hit before the last position', () => {
    const problems = outpost((raw) => {
      // The courtyard's spots moved through the inner wall, in front of the keep.
      const courtyard = raw.siege.forts[0]?.positions[1];
      if (courtyard)
        courtyard.spots = [
          [-10, -58],
          [0, -58],
          [10, -58],
        ];
    });
    expect(problems).toContain('The keep can be hit before the last position');
  });

  it('fails when a later position’s guard can be seen or hit from an earlier one', () => {
    // A courtyard guard moved over to stand in line with the outer gate.
    const problems = outpost((raw) => {
      raw.siege.forts[0]?.pieces.push({ kind: 'post', at: [1, -45.2], guard: 1 });
    });
    expect(problems.some((message) => message.includes('can be seen or hit from here'))).toBe(true);
  });

  it('fails when a fort that shows all its guards hides one', () => {
    // The Outpost's window bricked up: the guard behind it can't be seen as the round starts.
    const problems = outpost((raw) => {
      for (const piece of raw.siege.forts[0]?.pieces ?? []) {
        if (piece.kind === 'wall') piece.windows = [];
      }
    });
    expect(problems.some((message) => message.includes("can't be seen from his position"))).toBe(
      true,
    );
  });

  it('fails when a guard is out of reach of every spot', () => {
    const problems = outpost((raw) => {
      for (const piece of raw.siege.forts[0]?.pieces ?? []) {
        if (piece.kind === 'platform') piece.height = 6;
      }
    });
    expect(problems.some((message) => message.includes("can't be hit from any spot"))).toBe(true);
  });
});

describe('the objective', () => {
  const rules = data.siege;
  it('banner_down is met once the banner is below the win height (or the objective’s own)', () => {
    const height = rules.banner.winHeight;
    const banner = { kind: 'banner_down' } as const;
    expect(objectiveMet(banner, { rules, bannerHeight: height - 0.01, guardsLeft: 2 })).toBe(true);
    expect(objectiveMet(banner, { rules, bannerHeight: height + 0.01, guardsLeft: 0 })).toBe(false);
    expect(objectiveMet(banner, { rules, bannerHeight: undefined, guardsLeft: 0 })).toBe(false);
    expect(
      objectiveMet({ kind: 'banner_down', height: 3 }, { rules, bannerHeight: 2, guardsLeft: 1 }),
    ).toBe(true);
  });

  it('guards_down is met once no guard is left at the position', () => {
    const guards = { kind: 'guards_down' } as const;
    expect(objectiveMet(guards, { rules, bannerHeight: 5, guardsLeft: 1 })).toBe(false);
    expect(objectiveMet(guards, { rules, bannerHeight: 5, guardsLeft: 0 })).toBe(true);
  });
});

describe('the weapon', () => {
  it('grows its volley with the Command level, and a barrage is three volleys', () => {
    const { start, everyLevels, add } = WEAPON.aimed;
    expect(aimedVolley(WEAPON, 1)).toBe(start);
    expect(aimedVolley(WEAPON, everyLevels)).toBe(start + add);
    expect(aimedVolley(WEAPON, everyLevels * 3 + 1)).toBe(start + add * 3);
    expect(volleySize('aimed', 5, WEAPON)).toBe(5);
    expect(volleySize('barrage', 5, WEAPON)).toBe(5 * WEAPON.barrageTimes);
  });

  it('shoots what it has: never more spears than are left', () => {
    expect(spearsShot('barrage', 5, 7, WEAPON)).toBe(7);
    expect(spearsShot('aimed', 5, 3, WEAPON)).toBe(3);
    expect(spearsShot('aimed', 5, 0, WEAPON)).toBe(0);
    const spears = shotSpears(
      'barrage',
      startAim(WEAPON),
      { x: 0, z: 0 },
      5,
      7,
      WEAPON,
      data.siege.feel,
      new Rng(1),
    );
    expect(spears).toHaveLength(7);
    expect(spears.slice(0, 5).every((spear) => spear.wave === 0)).toBe(true);
    expect(spears[5]?.delay).toBeGreaterThanOrEqual(data.siege.feel.barrageStagger);
  });

  it('shoots flat and fast, at its one speed', () => {
    const spears = shotSpears(
      'aimed',
      startAim(WEAPON),
      { x: 0, z: 0 },
      5,
      5,
      WEAPON,
      data.siege.feel,
      new Rng(2),
    );
    for (const spear of spears) {
      const fast = Math.hypot(spear.velocity.x, spear.velocity.y, spear.velocity.z);
      expect(Math.abs(fast - WEAPON.speed) / WEAPON.speed).toBeLessThanOrEqual(
        data.siege.feel.aimedSpeedStray,
      );
    }
    expect(WEAPON.speed).toBeGreaterThanOrEqual(35);
    expect(WEAPON.tilt.max).toBeLessThanOrEqual(10);
  });

  it('keeps the aim (and so the view down the sights) within the weapon’s turn and tilt', () => {
    const feel = data.siege.feel;
    expect(clampAim({ yaw: 0, tilt: 30 * DEG }, WEAPON, feel).tilt).toBeCloseTo(
      WEAPON.tilt.max * DEG,
    );
    expect(clampAim({ yaw: 0, tilt: -30 * DEG }, WEAPON, feel).tilt).toBeCloseTo(
      WEAPON.tilt.min * DEG,
    );
    expect(clampAim({ yaw: 2, tilt: 0 }, WEAPON, feel).yaw).toBeCloseTo(feel.maxAim * DEG);
    expect(clampAim({ yaw: -2, tilt: 0 }, WEAPON, feel).yaw).toBeCloseTo(-feel.maxAim * DEG);
    const inside = { yaw: 0.1, tilt: 2 * DEG };
    expect(clampAim(inside, WEAPON, feel)).toEqual(inside);
  });

  it('aims the middle spear through the point under the sight, drop and all', () => {
    const gravity = data.siege.physics.gravity;
    for (const target of [
      { x: -5, y: 1.5, z: -20 },
      { x: 7, y: 2.4, z: -45 },
      { x: 0, y: 0.5, z: -12 },
    ]) {
      const spot = { x: 0, z: 0 };
      const aim = aimAt(spot, target);
      const { position, velocity } = launchFrom(spot, aim, WEAPON.speed, 0, WEAPON);
      const out = Math.hypot(target.x - position.x, target.z - position.z);
      const t = out / Math.hypot(velocity.x, velocity.z);
      expect(position.x + velocity.x * t).toBeCloseTo(target.x, 2);
      expect(position.z + velocity.z * t).toBeCloseTo(target.z, 2);
      expect(position.y + velocity.y * t - 0.5 * gravity * t * t).toBeCloseTo(target.y, 2);
    }
    // Out of its tilt, the nearest it has.
    expect(aimAt({ x: 0, z: 0 }, { x: 0, y: 40, z: -10 }).tilt).toBeCloseTo(WEAPON.tilt.max * DEG);
  });

  it('takes each shot’s spears from the warchest, as many as it shoots', () => {
    const { round, warchest, logs } = siege('outpost', { spears: 22 });
    expect(round.throw('barrage', startAim(WEAPON))).toBe(true);
    expect(warchest.spears).toBe(22 - 15);
    expect(round.throw('aimed', startAim(WEAPON))).toBe(false);
    reload(round);
    expect(round.throw('barrage', startAim(WEAPON))).toBe(true);
    expect(warchest.spears).toBe(0);
    expect(round.used).toBe(22);
    reload(round, 120);
    expect(round.canThrow).toBe(false);
    const throws = logs.filter((event) => event.type === 'siege.throw');
    expect(throws.map((event) => event.data?.spears)).toEqual([15, 7]);
    round.dispose();
  });

  it('a barrage strays far wider than an aimed volley', () => {
    const spread = (mode: ThrowMode) => {
      const spears = shotSpears(
        mode,
        startAim(WEAPON),
        { x: 0, z: 0 },
        5,
        15,
        WEAPON,
        data.siege.feel,
        new Rng(3),
      );
      const yaws = spears.map((spear) => Math.atan2(spear.velocity.x, -spear.velocity.z));
      return Math.max(...yaws) - Math.min(...yaws);
    };
    expect(spread('barrage')).toBeGreaterThan(spread('aimed') * 3);
  });
});

describe('siege stars and rewards', () => {
  const stars = data.siege.stars;
  const won = (throws: number, used = 20) => ({
    won: true,
    used,
    throws,
    blocksDown: 10,
    guardsDown: 4,
  });

  it('stars compare throws with par, whatever the spears', () => {
    expect(stars.by).toBe('throws');
    expect(siegeStars(won(4), 4, stars)).toBe(3);
    expect(siegeStars(won(5), 4, stars)).toBe(2);
    expect(siegeStars(won(6), 4, stars)).toBe(2);
    expect(siegeStars(won(7), 4, stars)).toBe(1);
    // Spending is never punished: a barrage-heavy win in few throws keeps its stars.
    expect(siegeStars(won(3, 45), 4, stars)).toBe(3);
    expect(siegeStars({ ...won(1), won: false }, 4, stars)).toBe(0);
  });

  it('pays Command XP per block and guard down plus the win bonus, and recovers a share', () => {
    const fort = { par: 3, rewards: { xpPerBlock: 3, xpPerGuard: 10, winXp: 60 } };
    const recovery = data.tuning.weaponRecoveryOnWin;
    const three = siegeRewards(won(3), fort, data.siege, recovery);
    const base = 10 * 3 + 4 * 10 + 60;
    expect(three.stars).toBe(3);
    expect(three.xp).toBe(base + Math.round(base * data.siege.starBonus.three));
    const back = Math.floor(20 * recovery);
    expect(three.recovered).toBe(back + Math.round(back * data.siege.starBonus.three));
    const lost = siegeRewards({ ...won(8, 40), won: false }, fort, data.siege, recovery);
    expect(lost).toMatchObject({ stars: 0, xp: 70, recovered: 0 });
  });
});

describe('siege feel', () => {
  it('has a live-tuning slider for every feel number', () => {
    const sliders = siegeTunables.map((tunable) => tunable.key).sort();
    expect(sliders).toEqual(Object.keys(data.siege.feel).sort());
  });
});

describe('siege data', () => {
  const fails = (edit: (raw: GameDataInput) => void, message: string) => {
    const raw = editableRawData();
    edit(raw);
    expect(() => parseGameData(raw)).toThrow(GameDataError);
    expect(() => parseGameData(raw)).toThrow(message);
  };
  const outpost = (raw: GameDataInput) => {
    const fort = raw.siege.forts[0];
    if (!fort) throw new Error('No fort');
    return fort;
  };

  it('fails on overlapping pieces', () => {
    fails((raw) => {
      const fort = outpost(raw);
      fort.pieces.push({ kind: 'wall', at: [3.2, -20], length: 2, courses: 2, material: 'stone' });
    }, 'Overlaps');
  });

  it('fails on a guard inside a block, and a guard for a position that isn’t there', () => {
    fails((raw) => {
      outpost(raw).pieces.push({ kind: 'post', at: [3, -20], guard: 0 });
    }, 'Overlaps a block or another guard');
    fails((raw) => {
      outpost(raw).pieces.push({ kind: 'post', at: [10, -5], guard: 7 });
    }, 'No position 7 to guard');
    fails((raw) => {
      outpost(raw).pieces.push({ kind: 'post', at: [10, -5], guard: 0, watch: 'patrol' });
    }, 'Only a guard on a walkway can patrol');
  });

  it('fails when the last position does not bring the banner down, or guards are missing', () => {
    fails((raw) => {
      const last = outpost(raw).positions.at(-1);
      if (last) last.objective = { kind: 'guards_down' };
    }, 'The last position brings the banner down');
    fails((raw) => {
      const fort = outpost(raw);
      fort.pieces = fort.pieces.filter((piece) => !('guard' in piece) || piece.guard !== 0);
    }, 'Bringing the guards down needs guards');
  });

  it('fails on an unknown material, a missing banner, a bad tilt range or weapon', () => {
    fails((raw) => {
      const piece = outpost(raw).pieces[0];
      if (piece && 'material' in piece) piece.material = 'marble';
    }, 'Unknown material "marble"');
    fails((raw) => {
      const fort = outpost(raw);
      fort.pieces = fort.pieces.filter((piece) => piece.kind !== 'keep');
    }, 'needs a banner');
    fails((raw) => {
      const weapon = raw.siege.weapons[0];
      if (weapon) weapon.tilt.min = 50;
    }, 'Needs min under max');
    fails((raw) => {
      raw.siege.weapon = 'trebuchet';
    }, 'Unknown weapon "trebuchet"');
  });
});
