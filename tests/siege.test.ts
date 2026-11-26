import { beforeAll, describe, expect, it } from 'vitest';
import { Rng, type LogEvent } from '../src/core';
import {
  GameDataError,
  farthestShot,
  parseGameData,
  type GameData,
  type GameDataInput,
} from '../src/data';
import { siegeTunables } from '../src/stations/siege/feel';
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
  aimFromDrag,
  aimedVolley,
  muzzleAt,
  shotSpears,
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
const AIMED = data.siege.ballista.aimed.start;
const pose = (): Pose => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

/** A round on `fort`, with `spears` in a pretend warchest. */
function siege(
  fort: string,
  {
    spears = 400,
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

/** Steps until the ballista can shoot again (or the round moves on), at most `steps`. */
function reload(round: SiegeRound, steps = 600): void {
  for (let step = 0; step < steps && !round.canThrow && round.phase !== 'done'; step++) {
    round.step();
  }
}

/**
 * The aim that sends a spear from the ballista at `spot` through `target`: straight at it, and
 * the low arc (or the high one, a lob) at its distance. What a good player works out by eye.
 */
function aimAt(spot: Spot, target: Vec3, high = false): Aim {
  const { speed, tilt } = data.siege.ballista;
  const gravity = data.siege.physics.gravity;
  const yaw = Math.atan2(target.x - spot.x, -(target.z - spot.z));
  const heights: { tilt: number; miss: number }[] = [];
  for (let degrees = tilt.min; degrees <= tilt.max; degrees += 0.1) {
    const aim = { yaw, tilt: degrees * DEG };
    const muzzle = muzzleAt(spot, aim, data.siege);
    const across = Math.hypot(target.x - muzzle.x, target.z - muzzle.z);
    const time = across / (speed * Math.cos(aim.tilt));
    const y = muzzle.y + speed * Math.sin(aim.tilt) * time - 0.5 * gravity * time * time;
    heights.push({ tilt: aim.tilt, miss: y - target.y });
  }
  // Where the arc crosses the target's height, low or high.
  const crossings = heights.filter(
    (entry, index) =>
      index > 0 && Math.sign(entry.miss) !== Math.sign(heights[index - 1]?.miss ?? 0),
  );
  const crossing = (high ? crossings.at(-1) : crossings[0]) ?? heights.at(-1);
  return { yaw, tilt: crossing?.tilt ?? tilt.max * DEG };
}

type Blocks = GameDataInput['siege']['forts'][number]['blocks'];

/** The real data plus a one-position test fort, `test`, of these blocks. */
function fortData(blocks: Blocks): GameData {
  return dataWith((raw) => {
    raw.siege.forts.push({
      id: 'test',
      name: 'Test',
      par: 5,
      rewards: { xpPerBlock: 2, xpPerGuard: 5, winXp: 10 },
      blocks,
      positions: [
        {
          name: 'Test',
          spots: [
            [0, 0],
            [3, 0],
          ],
          objective: { kind: 'banner_down' },
        },
      ],
    });
  });
}

/** A thin, tall board, the banner, standing on its own 10 m out. */
const BOARD: Blocks[number] = {
  material: 'wood',
  size: [2.5, 3, 0.1],
  at: [0, 1.5, -10],
  banner: true,
  // Never breaks: it has to fall.
  hp: 100000,
};

/**
 * A scripted player, a decent one: at each position it shoots aimed volleys at what wins it
 * (each guard's chest, then its head, with a lob if cover's in the way; at the keep, the thin
 * posts, then the keep itself), and a barrage now and then. Returns the round when it's over.
 */
/** Steps a player watches after a shot: two seconds, long enough to see a collapse through. */
const WATCH_STEPS = 120;

function playOutpost(seed: number) {
  const game = siege('outpost', { seed, spears: 200 });
  const { round } = game;
  const [, height] = data.siege.guard.size;
  let tries = 0;
  let at = round.position;
  while (round.phase !== 'done' && round.throws < 20) {
    reload(round);
    if (round.phase === 'won') {
      run(round, 600);
      break;
    }
    if (!round.canThrow) break;
    if (round.position !== at) {
      at = round.position;
      tries = 0;
    }
    const spot = round.ballista();
    const position = round.position;
    const guard = round.guards.find((entry) => entry.position === position && !entry.down);
    let target: Vec3;
    if (guard) {
      const [x, y, z] = guard.guard.at;
      target = { x, y: y + height * (tries % 2 === 0 ? 0.65 : 0.9), z };
    } else {
      const weak = round.blocks.find((block) => block.block.weak && !block.broken);
      const [x, y, z] = weak?.block.at ?? [0, 2.5, -50];
      target = { x, y, z };
    }
    const mode: ThrowMode = tries % 4 === 3 ? 'barrage' : 'aimed';
    // A lob over cover, now and then, at a guard that is ducking behind it.
    round.throw(mode, aimAt(spot, target, guard !== undefined && tries % 3 === 2));
    tries++;
    // It watches where the volley went (and what it brought down) before the next.
    run(round, WATCH_STEPS);
  }
  run(round, 900);
  return game;
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

  it('an aimed volley at the outer wall hits it, dealing damage', () => {
    const { round, events } = siege('outpost');
    const spot = round.ballista();
    expect(round.throw('aimed', aimAt(spot, { x: -2.5, y: 0.9, z: -12 }))).toBe(true);
    run(round, 180);
    const hits = events.flatMap((event) => (event.type === 'hit' ? [event] : []));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.kind).toBe('stone');
    expect(round.blocks.some((block) => block.hp < block.maxHp)).toBe(true);
    expect(round.damage).toBeGreaterThan(0);
    // Every impact is there for other rules (noise, later) to hook into.
    expect(events.some((event) => event.type === 'impact' && event.by === 'spear')).toBe(true);
    round.dispose();
  });

  it('replays exactly: the same seed and shots on the same steps give the same result', () => {
    const play = () => {
      const { round, events } = siege('outpost', { seed: 42 });
      round.throw('barrage', { yaw: 0.02, tilt: 8 * DEG });
      run(round, 90);
      round.moveTo(2);
      run(round, 60);
      round.throw('aimed', aimAt(round.ballista(), { x: 2, y: 2.9, z: -12 }));
      run(round, 400);
      const poses = round.blocks.map((_, index) => round.blockPose(index, pose()));
      const guards = round.guards.map((_, index) => round.guardPose(index, pose()));
      const outcome = {
        poses,
        guards,
        hp: round.blocks.map((block) => block.hp),
        events: events.map((event) => event.type),
        used: round.used,
        down: round.blocksDown,
      };
      round.dispose();
      return outcome;
    };
    const first = play();
    expect(first.events).toContain('hit');
    expect(play()).toEqual(first);
  });

  it('a stone wall wears down and breaks under repeated hits', () => {
    const { round, events } = siege('outpost');
    for (let shot = 0; shot < 8; shot++) {
      reload(round);
      round.throw('aimed', aimAt(round.ballista(), { x: -1.5, y: 0.9, z: -12 }));
    }
    run(round, 120);
    const broken = events.flatMap((event) => (event.type === 'break' ? [event] : []));
    expect(broken.some((event) => event.kind === 'stone')).toBe(true);
    round.dispose();
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
    expect(round.blocks[1]?.hp).toBe(0);
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
    round.throw('aimed', aimAt(round.ballista(), { x: 0, y: 2.4, z: -10 }));
    run(round, 900);
    expect(events.map((event) => event.type)).toContain('bannerFalling');
    expect(events.map((event) => event.type)).toContain('won');
    expect(round.phase).toBe('done');
    expect(finished).toHaveLength(1);
    expect(finished[0]?.won).toBe(true);
    expect(finished[0]?.used).toBe(AIMED);
    expect(finished[0]?.throws).toBe(1);
    expect(finished[0]?.stars).toBe(3);
    round.dispose();
  });

  it('with no spears left, the round is lost once everything has settled', () => {
    const { round, finished, logs } = siege('outpost', { spears: 3 });
    round.throw('aimed', { yaw: 0, tilt: 5 * DEG });
    run(round, 900);
    expect(round.phase).toBe('done');
    expect(finished[0]?.won).toBe(false);
    expect(finished[0]?.used).toBe(3);
    expect(finished[0]?.recovered).toBe(0);
    const end = logs.find((event) => event.type === 'siege.end');
    expect(end?.data).toMatchObject({
      won: false,
      throws: 1,
      throwsPerPosition: [1, 0, 0],
      spearsUsed: 3,
      par: data.siege.forts[0]?.par,
    });
    for (const key of ['blocksBroken', 'guardsDown', 'damage'])
      expect(end?.data).toHaveProperty(key);
    round.dispose();
  });
});

describe('siege guards and positions', () => {
  it('a spear hit brings a guard down: it topples, and it is logged', () => {
    const { round, events, logs } = siege('outpost');
    const guard = round.guards[0];
    if (!guard) throw new Error('No guard');
    const [x, y, z] = guard.guard.at;
    round.throw('aimed', aimAt(round.ballista(), { x, y: y + 1.1, z }));
    run(round, 240);
    expect(events.some((event) => event.type === 'hit' && event.kind === 'guard')).toBe(true);
    expect(guard.down).toBe(true);
    expect(guard.hp).toBe(0);
    expect(tiltOf(round.guardPose(0, pose()).rotation)).toBeGreaterThan(data.siege.guard.downTilt);
    expect(logs.some((event) => event.type === 'siege.guardDown')).toBe(true);
    round.dispose();
  });

  it('with its guards down, a position is won and the ballista rolls on to the next', () => {
    const { round, events, logs } = siege('outpost');
    const feel = data.siege.feel;
    for (const index of [0, 1]) {
      const guard = round.guards[index];
      if (!guard) throw new Error('No guard');
      const [x, y, z] = guard.guard.at;
      for (let shot = 0; shot < 4 && !guard.down; shot++) {
        reload(round);
        round.throw('aimed', aimAt(round.ballista(), { x, y: y + 1.1, z }));
        run(round, 120);
      }
    }
    run(round, 30);
    expect(events.some((event) => event.type === 'positionWon')).toBe(true);
    expect(round.phase).toBe('advance');
    expect(round.canThrow).toBe(false);
    run(round, Math.ceil((feel.advanceDelaySeconds + feel.advanceSeconds) * 60 + 10));
    expect(round.position).toBe(1);
    expect(round.phase).toBe('aim');
    const [sx, sz] = data.siege.forts[0]?.positions[1]?.spots[1] ?? [0, 0];
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
    expect(round.spot).toBe(2);
    expect(logs.find((event) => event.type === 'siege.spot')?.data).toMatchObject({ spot: 2 });
    round.throw('aimed', { yaw: 0, tilt: 10 * DEG });
    const thrown = logs.find((event) => event.type === 'siege.throw');
    expect(thrown?.data).toMatchObject({ mode: 'aimed', spot: 2, position: 0, tilt: 10, yaw: 0 });
    expect(thrown?.data).toHaveProperty('sightBlend');
    round.dispose();
  });

  it('the banner cannot be brought down from the outer wall or the courtyard', () => {
    // Every spot, a fan of aims at every tilt, barrages all: the keep is out of reach.
    const yaws = [-10, -6, -2, 2, 6, 10];
    const tilts = [5, 12, 20, 28, 34, 40];
    const fort = data.siege.forts[0];
    if (!fort) throw new Error('No fort');
    for (const position of [0, 1]) {
      for (let spot = 0; spot < (fort.positions[position]?.spots.length ?? 0); spot++) {
        const { round } = siege('outpost', { position, spears: 100000 });
        round.moveTo(spot);
        run(round, 60);
        expect(round.spot).toBe(spot);
        for (const tilt of tilts) {
          for (const yaw of yaws) {
            if (round.position !== position) break;
            reload(round, 120);
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
        expect(tiltOf(banner.rotation)).toBeLessThan(5);
        round.dispose();
      }
    }
  }, 120_000);

  it('a scripted player takes the Outpost, all three positions, for 25 to 45 spears', () => {
    const spent: number[] = [];
    for (const seed of [1, 2, 3]) {
      const { round, finished } = playOutpost(seed);
      expect(finished[0]?.won, `seed ${String(seed)}`).toBe(true);
      expect(finished[0]?.throwsPerPosition.every((throws) => throws > 0)).toBe(true);
      spent.push(round.used);
      round.dispose();
    }
    const average = spent.reduce((sum, used) => sum + used, 0) / spent.length;
    expect(average).toBeGreaterThanOrEqual(25);
    expect(average).toBeLessThanOrEqual(45);
  }, 60_000);
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

describe('the ballista', () => {
  it('grows its volley with the Command level, and a barrage is three volleys', () => {
    const { start, everyLevels, add } = data.siege.ballista.aimed;
    expect(aimedVolley(data.siege, 1)).toBe(start);
    expect(aimedVolley(data.siege, everyLevels)).toBe(start + add);
    expect(aimedVolley(data.siege, everyLevels * 3 + 1)).toBe(start + add * 3);
    expect(volleySize('aimed', 5, data.siege)).toBe(5);
    expect(volleySize('barrage', 5, data.siege)).toBe(5 * data.siege.ballista.barrageTimes);
  });

  it('shoots what it has: never more spears than are left', () => {
    expect(spearsShot('barrage', 5, 7, data.siege)).toBe(7);
    expect(spearsShot('aimed', 5, 3, data.siege)).toBe(3);
    expect(spearsShot('aimed', 5, 0, data.siege)).toBe(0);
    const spears = shotSpears(
      'barrage',
      startAim(data.siege),
      { x: 0, z: 0 },
      5,
      7,
      data.siege,
      data.siege.feel,
      new Rng(1),
    );
    expect(spears).toHaveLength(7);
    // A first wave of 5, then the next starts a moment later.
    expect(spears.slice(0, 5).every((spear) => spear.wave === 0)).toBe(true);
    expect(spears[5]?.delay).toBeGreaterThanOrEqual(data.siege.feel.barrageStagger);
  });

  it('every spear leaves at the ballista’s one speed, near enough', () => {
    const { speed } = data.siege.ballista;
    const spears = shotSpears(
      'aimed',
      startAim(data.siege),
      { x: 0, z: 0 },
      5,
      5,
      data.siege,
      data.siege.feel,
      new Rng(2),
    );
    for (const spear of spears) {
      const fast = Math.hypot(spear.velocity.x, spear.velocity.y, spear.velocity.z);
      expect(Math.abs(fast - speed) / speed).toBeLessThanOrEqual(data.siege.feel.aimedSpeedStray);
    }
  });

  it('takes each shot’s spears from the warchest, as many as it shoots', () => {
    const { round, warchest, logs } = siege('outpost', { spears: 22 });
    expect(round.throw('barrage', startAim(data.siege))).toBe(true);
    expect(warchest.spears).toBe(22 - 15);
    // Not until the barrage has left and landed (or the reload is up).
    expect(round.throw('aimed', startAim(data.siege))).toBe(false);
    reload(round);
    expect(round.throw('barrage', startAim(data.siege))).toBe(true);
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
        startAim(data.siege),
        { x: 0, z: 0 },
        5,
        15,
        data.siege,
        data.siege.feel,
        new Rng(3),
      );
      const yaws = spears.map((spear) => Math.atan2(spear.velocity.x, -spear.velocity.z));
      return Math.max(...yaws) - Math.min(...yaws);
    };
    expect(spread('barrage')).toBeGreaterThan(spread('aimed') * 3);
  });

  it('a drag turns and tilts it from where it was aimed, kept to its range', () => {
    const feel = data.siege.feel;
    const { tilt } = data.siege.ballista;
    const from = startAim(data.siege);
    // Pull left: aim right. Pull down: aim higher.
    expect(aimFromDrag(from, -50, 0, feel, data.siege).yaw).toBeGreaterThan(0);
    expect(aimFromDrag(from, 0, 50, feel, data.siege).tilt).toBeGreaterThan(from.tilt);
    expect(aimFromDrag(from, 0, 10000, feel, data.siege).tilt).toBeCloseTo(tilt.max * DEG);
    expect(aimFromDrag(from, 0, -10000, feel, data.siege).tilt).toBeCloseTo(tilt.min * DEG);
    expect(Math.abs(aimFromDrag(from, -10000, 0, feel, data.siege).yaw)).toBeCloseTo(
      feel.maxAim * DEG,
    );
  });

  it('the arc preview shows only the first part of the flight, from the shot’s own launch', () => {
    const { round } = siege('outpost');
    const aim = startAim(data.siege);
    const [aimed] = round.preview('aimed', aim, 10);
    expect(round.preview('barrage', aim, 10)).toHaveLength(3);
    const end = aimed?.at(-1);
    if (!end) throw new Error('No arc');
    // Still well up in the air: far short of where it lands.
    expect(end.y).toBeGreaterThan(0.5);
    const muzzle = muzzleAt(round.ballista(), aim, data.siege);
    expect(Math.hypot(end.x - muzzle.x, end.z - muzzle.z)).toBeLessThan(
      farthestShot(data.siege.ballista.speed, 0.01, 0.01, { min: 10, max: 10 }, 9.81) * 0.6,
    );
    round.dispose();
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
    const one = siegeRewards(won(8, 40), fort, data.siege, recovery);
    expect(one.xp).toBe(base);
    expect(one.recovered).toBe(Math.floor(40 * recovery));
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

  it('fails on overlapping blocks', () => {
    fails((raw) => {
      const fort = outpost(raw);
      const first = fort.blocks[0];
      if (first) fort.blocks.push({ ...first, at: [first.at[0] + 0.3, first.at[1], first.at[2]] });
    }, 'Overlaps');
  });

  it('fails on a floating block', () => {
    fails((raw) => {
      outpost(raw).blocks.push({ material: 'wood', size: [1, 1, 1], at: [10, 5, -10] });
    }, 'Floats');
  });

  it('fails on an overhanging block', () => {
    fails((raw) => {
      outpost(raw).blocks.push(
        { material: 'wood', size: [1, 1, 1], at: [10, 0.5, -10] },
        { material: 'wood', size: [1, 1, 1], at: [10.8, 1.5, -10] },
      );
    }, 'Overhangs');
  });

  it('fails on a floating guard, and a guard inside a block', () => {
    fails((raw) => {
      outpost(raw).positions[0]?.guards?.push({ at: [20, 3, -12] });
    }, 'Floats');
    fails((raw) => {
      outpost(raw).positions[0]?.guards?.push({ at: [-2.5, 0, -12] });
    }, 'Overlaps a block or another guard');
  });

  it('fails when the banner is in reach before the last position', () => {
    fails((raw) => {
      const position = outpost(raw).positions[1];
      if (position) position.spots[0] = [0, -40];
    }, 'The banner is in reach');
  });

  it('fails when the last position does not bring the banner down, or guards are missing', () => {
    fails((raw) => {
      const last = outpost(raw).positions.at(-1);
      if (last) last.objective = { kind: 'guards_down' };
    }, 'The last position brings the banner down');
    fails((raw) => {
      const first = outpost(raw).positions[0];
      if (first) first.guards = [];
    }, 'Bringing the guards down needs guards');
  });

  it('fails on an unknown material, a missing banner and a bad tilt range', () => {
    fails((raw) => {
      const block = outpost(raw).blocks[0];
      if (block) block.material = 'marble';
    }, 'Unknown material "marble"');
    fails((raw) => {
      const fort = outpost(raw);
      fort.blocks = fort.blocks.filter((block) => !block.banner);
    }, 'needs a banner');
    fails((raw) => {
      raw.siege.ballista.tilt.min = 50;
    }, 'Needs min under max');
    fails((raw) => {
      raw.siege.ballista.skill = 'juggling';
    }, 'Unknown skill "juggling"');
  });
});
