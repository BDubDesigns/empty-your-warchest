import { beforeAll, describe, expect, it } from 'vitest';
import { Rng, type LogEvent } from '../src/core';
import {
  GameDataError,
  parseGameData,
  type FortBlock,
  type GameData,
  type GameDataInput,
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
  aimToward,
  aimedVolley,
  aimDirection,
  muzzleAt,
  shotSpears,
  siegeWeapon,
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

/**
 * The aim that sends a spear from the weapon at `spot` through `target`, allowing for the drop:
 * what a good player has learnt. The lowest tilt that gets there.
 */
function aimAt(spot: Spot, target: Vec3): Aim {
  const gravity = data.siege.physics.gravity;
  const yaw = Math.atan2(target.x - spot.x, -(target.z - spot.z));
  let best = { tilt: WEAPON.tilt.min * DEG, miss: Infinity };
  for (let degrees = WEAPON.tilt.min; degrees <= WEAPON.tilt.max; degrees += 0.05) {
    const aim = { yaw, tilt: degrees * DEG };
    const muzzle = muzzleAt(spot, aim, WEAPON);
    const across = Math.hypot(target.x - muzzle.x, target.z - muzzle.z);
    const time = across / (WEAPON.speed * Math.cos(aim.tilt));
    const y = muzzle.y + WEAPON.speed * Math.sin(aim.tilt) * time - 0.5 * gravity * time * time;
    if (Math.abs(y - target.y) < Math.abs(best.miss)) best = { tilt: aim.tilt, miss: y - target.y };
  }
  return { yaw, tilt: best.tilt };
}

/** The real data with an extra one-position fort, `test`, of these blocks (unchecked). */
function fortData(blocks: Omit<FortBlock, 'piece' | 'pieceKind' | 'banner' | 'weak'>[] & object[]) {
  const game = structuredClone(data);
  game.siege.forts.push({
    id: 'test',
    name: 'Test',
    par: 5,
    rewards: { xpPerBlock: 2, xpPerGuard: 5, winXp: 10 },
    pieces: [],
    blocks: blocks.map((block) => ({
      banner: false,
      weak: false,
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
function play(fort: string, seed: number) {
  const game = siege(fort, { seed, spears: 400 });
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
    const guard = round.guards.find((entry) => entry.position === round.position && !entry.down);
    let target: Vec3;
    if (guard) {
      const [x, y, z] = guard.guard.at;
      target = { x, y: y + height * (tries % 2 === 0 ? 0.6 : 0.85), z };
    } else {
      const weak = round.blocks.find(
        (block) => block.block.weak && !block.broken && block.block.pieceKind === 'keep',
      );
      const [x, y, z] = weak?.block.at ?? [0, 2.5, -41];
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
    for (const kind of ['wall', 'gate', 'cover', 'platform', 'keep']) expect(kinds).toContain(kind);
    expect(fort.blocks.filter((block) => block.banner)).toHaveLength(1);
    expect(fort.positions.map((position) => position.guards.length)).toEqual([2, 3, 0]);
  });

  it('an aimed volley at the outer wall hits it, dealing damage', () => {
    const { round, events } = siege('outpost');
    expect(round.throw('aimed', aimAt(round.ballista(), { x: -3, y: 0.9, z: -11 }))).toBe(true);
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
      round.throw('barrage', aimAt(round.ballista(), { x: 0, y: 1.5, z: -11 }));
      run(round, 90);
      round.moveTo(2);
      run(round, 60);
      round.throw('aimed', aimAt(round.ballista(), { x: 2.5, y: 1.2, z: -11 }));
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
      round.throw('aimed', aimAt(round.ballista(), { x: -2, y: 0.9, z: -11 }));
      volleys++;
      run(round, 60);
    }
    expect(volleys).toBeLessThanOrEqual(3);
    round.dispose();
  });

  it('a gate breaks in one aimed volley', () => {
    const { round, events } = siege('outpost');
    round.throw('aimed', aimAt(round.ballista(), { x: 0, y: 1.5, z: -11 }));
    run(round, 120);
    const broken = events.flatMap((event) => (event.type === 'break' ? [event] : []));
    expect(broken.some((event) => round.blocks[event.block]?.block.pieceKind === 'gate')).toBe(
      true,
    );
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

  it('no shot clears the outer wall: whatever the aim, it hits the wall first', () => {
    // Aimed at the wall either side of the gate (the only way through), at every tilt it has.
    // Only touches before anything broke count: after that a spear may find a hole.
    const wallBack = -11.35;
    for (const tilt of [WEAPON.tilt.min, 0, 4, WEAPON.tilt.max]) {
      for (const yaw of [-18, -13, 13, 18]) {
        const { round, events } = siege('outpost');
        round.throw('aimed', { yaw: yaw * DEG, tilt: tilt * DEG });
        const touched = new Map<number, number>();
        for (let step = 0; step < 120; step++) {
          round.step();
          if (events.some((event) => event.type === 'break')) break;
          round.spears.forEach((spear, index) => {
            if (!spear.flying && !touched.has(index)) {
              touched.set(index, round.spearPose(index, pose()).position.z);
            }
          });
        }
        expect(touched.size).toBeGreaterThan(0);
        for (const z of touched.values()) {
          expect(z, `tilt ${String(tilt)} yaw ${String(yaw)}`).toBeGreaterThan(wallBack - 1.5);
        }
        round.dispose();
      }
    }
  }, 60_000);

  it('the banner cannot be brought down from the first two positions', () => {
    const fort = data.siege.forts[0];
    if (!fort) throw new Error('No fort');
    for (const position of [0, 1]) {
      for (let spot = 0; spot < (fort.positions[position]?.spots.length ?? 0); spot++) {
        const { round } = siege('outpost', { position, spears: 100000 });
        round.moveTo(spot);
        run(round, 60);
        for (const tilt of [-2, 1, 4, 7]) {
          for (const yaw of [-8, -3, 3, 8]) {
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
        round.dispose();
      }
    }
  }, 120_000);

  it('a scripted player takes the Outpost for 25 to 45 spears, and the Stronghold for 45 to 80', () => {
    for (const [fort, low, high] of [
      ['outpost', 25, 45],
      ['stronghold', 45, 80],
    ] as const) {
      const spent: number[] = [];
      for (const seed of [1, 2, 3]) {
        const { round, finished } = play(fort, seed);
        expect(finished[0]?.won, `${fort} seed ${String(seed)}`).toBe(true);
        expect(finished[0]?.throwsPerPosition.every((throws) => throws > 0)).toBe(true);
        spent.push(round.used);
        round.dispose();
      }
      const average = spent.reduce((sum, used) => sum + used, 0) / spent.length;
      expect(average, `${fort}: ${spent.join(', ')}`).toBeGreaterThanOrEqual(low);
      expect(average, `${fort}: ${spent.join(', ')}`).toBeLessThanOrEqual(high);
    }
  }, 120_000);
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

  it('fails when a shot can clear the wall in front', () => {
    const problems = outpost((raw) => {
      for (const piece of raw.siege.forts[0]?.pieces ?? []) {
        if (piece.kind === 'wall' && piece.at[1] === -11) piece.courses = 3;
        if (piece.kind === 'gate' && piece.at[1] === -11) piece.height = 1.8;
      }
    });
    expect(problems.some((message) => message.startsWith('A shot can clear the wall'))).toBe(true);
  });

  it('fails when the keep can be hit before the last position', () => {
    const problems = outpost((raw) => {
      const courtyard = raw.siege.forts[0]?.positions[1];
      if (courtyard)
        courtyard.spots = [
          [-3, -33],
          [0, -33],
          [3, -33],
        ];
    });
    expect(problems).toContain('The keep can be hit before the last position');
  });

  it('fails when a guard is out of reach of every spot', () => {
    const problems = outpost((raw) => {
      for (const piece of raw.siege.forts[0]?.pieces ?? []) {
        if (piece.kind === 'platform') piece.height = 3.5;
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

  it('points straight at the crosshair, not allowing for the drop, within its range', () => {
    const spot = { x: 0, z: 0 };
    const feel = data.siege.feel;
    const point = { x: 2, y: 2, z: -12 };
    const aim = aimToward(spot, point, WEAPON, feel);
    const way = aimDirection(aim);
    const pivot = { x: 0, y: WEAPON.pivotHeight, z: 0 };
    // The bolt's line runs through the point.
    const along = (point.z - pivot.z) / way.z;
    expect(pivot.x + way.x * along).toBeCloseTo(point.x);
    expect(pivot.y + way.y * along).toBeCloseTo(point.y);
    // Kept to the weapon's tilt and turn.
    expect(aimToward(spot, { x: 0, y: 30, z: -10 }, WEAPON, feel).tilt).toBeCloseTo(
      WEAPON.tilt.max * DEG,
    );
    expect(aimToward(spot, { x: 0, y: -30, z: -10 }, WEAPON, feel).tilt).toBeCloseTo(
      WEAPON.tilt.min * DEG,
    );
    expect(aimToward(spot, { x: 50, y: 1, z: -1 }, WEAPON, feel).yaw).toBeCloseTo(
      feel.maxAim * DEG,
    );
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
      fort.pieces.push({ kind: 'wall', at: [-3.2, -11], length: 2, courses: 2, material: 'stone' });
    }, 'Overlaps');
  });

  it('fails on a guard inside a block, and a guard for a position that isn’t there', () => {
    fails((raw) => {
      outpost(raw).pieces.push({ kind: 'post', at: [-3, -11], guard: 0 });
    }, 'Overlaps a block or another guard');
    fails((raw) => {
      outpost(raw).pieces.push({ kind: 'post', at: [10, -5], guard: 7 });
    }, 'No position 7 to guard');
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
