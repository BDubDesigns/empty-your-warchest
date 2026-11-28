import { beforeAll, describe, expect, it } from 'vitest';
import { Rng, type LogEvent } from '../src/core';
import {
  castleBreakableKinds,
  GameDataError,
  layoutCastle,
  parseGameData,
  type GameData,
  type GameDataInput,
} from '../src/data';
import { siegeTunables } from '../src/stations/siege/feel';
import { castleBodies, standsOn, within } from '../src/stations/siege/logic/castleBodies';
import {
  objectiveDone,
  objectiveProgress,
  planRound,
  type RoundPlan,
} from '../src/stations/siege/logic/objectives';
import { loadPhysics, type Physics } from '../src/stations/siege/logic/physics';
import {
  SiegeRound,
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
  volleySize,
  type Aim,
  type ThrowMode,
  type Vec3,
} from '../src/stations/siege/logic/throw';
import { data, editableRawData, testLogger } from './helpers';

let physics: Physics;
beforeAll(async () => {
  physics = await loadPhysics();
});

const DEG = Math.PI / 180;
const WEAPON = siegeWeapon(data.siege);
const AIMED = WEAPON.aimed.start;
const LAYOUT = layoutCastle(data.castle);
const pose = (): Pose => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
const vantage = (id: string) => data.castle.vantages.findIndex((entry) => entry.id === id);
const HILL = vantage('hill');
const LOW = vantage('low');
const TOWER = vantage('tower');

/** The seed's plan with some of it changed. */
function planWith(seed: number, change: Partial<RoundPlan> = {}): RoundPlan {
  return { ...planRound(data.siege, LAYOUT, new Rng((seed ^ 0x9e3779b9) >>> 0)), ...change };
}

/** A round at the castle, with `spears` in a pretend warchest. */
function siege({
  spears = 600,
  aimed = AIMED,
  seed = 7,
  game = data,
  plan,
  vantage: at,
}: Partial<{
  spears: number;
  aimed: number;
  seed: number;
  game: GameData;
  plan: RoundPlan;
  vantage: number;
}> = {}) {
  const { logger } = testLogger();
  const logs: LogEvent[] = [];
  logger.onLog((event) => logs.push(event));
  const warchest = { spears };
  const events: SiegeEvent[] = [];
  const finished: SiegeResult[] = [];
  const round = new SiegeRound(
    physics,
    game,
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
    { aimed, seed, ...(plan && { plan }), ...(at !== undefined && { vantage: at }) },
  );
  return { round, warchest, events, finished, logs };
}

function run(round: SiegeRound, steps: number): void {
  for (let step = 0; step < steps && round.phase !== 'done'; step++) round.step();
}

/** Steps until the weapon can shoot again, at most `steps`. */
function reload(round: SiegeRound, steps = 600): void {
  for (let step = 0; step < steps && !round.canThrow && round.phase !== 'done'; step++) {
    round.step();
  }
}

/** Shoots from where the ballista stands at `target`, allowing for the drop, and watches. */
function shoot(round: SiegeRound, target: Vec3, mode: ThrowMode = 'aimed', watch = 90): boolean {
  reload(round);
  const shot = round.throw(
    mode,
    solveAim(round.mount(), target, WEAPON, data.siege.physics.gravity),
    target,
  );
  run(round, watch);
  return shot;
}

/** Guard `index`'s box middle now. */
function guardAt(round: SiegeRound, index: number): Vec3 {
  return round.guardPose(index, pose()).position;
}

/** The middle of a part as it was built. */
function partMiddle(round: SiegeRound, id: string): Vec3 {
  const index = round.parts.findIndex((part) => part.body.id === id);
  const part = round.parts[index];
  if (!part) throw new Error(`No part "${id}"`);
  const shape = part.body.shapes[0];
  const up = shape?.kind === 'box' ? shape.at[1] : 1;
  const [x, y, z] = part.body.foot;
  return { x, y: y + up, z };
}

/** Breaks the bottom chunk under guard `index` (on a walk) with aimed volleys from the hill. */
function dropColumnUnder(round: SiegeRound, index: number): number {
  round.setVantage(HILL);
  let shots = 0;
  while (!round.guards[index]?.down && shots < 10 && round.phase !== 'done') {
    const at = guardAt(round, index);
    // Low on the wall's outer face, under him.
    shoot(round, { x: at.x, y: 1.5, z: at.z + 1.6 });
    shots++;
  }
  run(round, 120);
  return shots;
}

describe('the castle as bodies', () => {
  it('makes every part that can come apart a body, and the round’s spear rack', () => {
    const plan = planWith(1);
    const bodies = castleBodies(data.castle, LAYOUT, data.siege.bodies, plan.rack);
    const breakable = LAYOUT.parts.filter((part) => castleBreakableKinds.includes(part.kind));
    expect(bodies.parts).toHaveLength(breakable.length + 1);
    expect(bodies.parts.at(-1)).toMatchObject({ kind: 'rack', id: plan.rack });
    expect(bodies.parts.every((part) => part.shapes.length > 0)).toBe(true);
    // The keep's lower storeys, the wall inside the towers, the stair and the props never break.
    expect(bodies.solids.length).toBeGreaterThan(10);
  });

  it('rests each part on what it is built on', () => {
    const bodies = castleBodies(data.castle, LAYOUT, data.siege.bodies, undefined);
    const byId = (id: string) => bodies.parts.findIndex((part) => part.id === id);
    const part = (id: string) => bodies.parts[byId(id)];
    // A wall's upper chunk on the one under it; a battlement on its column's top chunk.
    expect(part('front_left.wallChunk.1')?.supports).toEqual([byId('front_left.wallChunk.0')]);
    expect(part('front_left.wallChunk.0')?.supports).toEqual([]);
    expect(part('front_left.battlement.0')?.supports).toEqual([byId('front_left.wallChunk.1')]);
    // A tower's rows on the rows under them; a roof on its tower's top row.
    const sectors = data.castle.towerChunks.sectors;
    expect(part(`north_west.towerChunk.${String(sectors)}`)?.supports).toEqual([
      byId('north_west.towerChunk.0'),
    ]);
    expect(part('north_west.towerRoof.0')?.supports).toHaveLength(sectors);
    // And the whole row under it holds a tower's row up: with too few wedges left, it comes down.
    expect(part(`north_west.towerChunk.${String(sectors)}`)?.holds).toEqual({
      parts: Array.from({ length: sectors }, (_, sector) =>
        byId(`north_west.towerChunk.${String(sector)}`),
      ),
      atLeast: data.siege.bodies.towerHold,
    });
    expect(part('north_west.towerChunk.0')?.holds).toBeUndefined();
    // The gatehouse's blocks on the ones under them, the lowest over the gate between the piers',
    // and its merlons on its top row.
    const gatehouse = bodies.parts.filter((entry) => entry.kind === 'gatehouseChunk');
    const over = gatehouse.filter((entry) => entry.foot[0] === 0);
    expect(over.map((entry) => entry.supports.length).sort()).toEqual([1, 1, 2, 2]);
    const merlonOn = part('gatehouse.merlon.0')?.supports ?? [];
    expect(merlonOn).toHaveLength(1);
    expect(bodies.parts[merlonOn[0] ?? -1]?.kind).toBe('gatehouseChunk');
    // The top row carries the parapet (more shapes than the block itself).
    expect(bodies.parts[merlonOn[0] ?? -1]?.shapes.length).toBeGreaterThan(1);
    // The keep's roof on its top storey's blocks, which stand on the storeys that never break.
    const storey = bodies.parts.filter((entry) => entry.kind === 'storeyChunk');
    expect(part('keep.roof.0')?.supports).toHaveLength(storey.length);
    expect(storey.every((entry) => entry.supports.length === 0)).toBe(true);
  });

  it('knows which block of the keep a point is in', () => {
    const bodies = castleBodies(data.castle, LAYOUT, data.siege.bodies, undefined);
    const window = LAYOUT.anchors.captainWindows[0];
    if (!window) throw new Error('No captain window');
    const inside: [number, number, number] = [
      window.at[0] - window.out[0] * 0.2,
      window.at[1],
      window.at[2] - window.out[1] * 0.2,
    ];
    const blocks = bodies.parts.filter((entry) => within(entry, inside));
    expect(blocks.map((entry) => entry.kind)).toEqual(['storeyChunk']);
  });

  it('knows where a guard stands: on a wall’s walk, or on a tower’s top', () => {
    const bodies = castleBodies(data.castle, LAYOUT, data.siege.bodies, undefined);
    const walk = LAYOUT.anchors.guardPaths.find((path) => path.id === 'front_left_walk');
    const [x, y, z] = walk?.points[0]?.at ?? [0, 0, 0];
    const under = bodies.parts.filter((part) => standsOn(part, [x, y, z], 0.2));
    expect(under.map((part) => part.kind)).toEqual(['wallChunk']);
    for (const part of under) expect(standsOn(part, [x, y + 2, z], 0.2)).toBe(false);
    const lookout = LAYOUT.anchors.lookouts[0];
    const top = bodies.parts.filter((part) => lookout && standsOn(part, lookout.at, 0.2));
    expect(top.map((part) => part.kind)).toEqual(['towerChunk']);
  });
});

describe('siege objectives', () => {
  it('picks the objectives and places them from the seed: the same seed, the same castle', () => {
    const plan = (seed: number) => planRound(data.siege, LAYOUT, new Rng(seed));
    expect(plan(5)).toEqual(plan(5));
    const first = plan(5);
    expect(first.objectives.map((objective) => objective.kind)).toEqual([
      'captain',
      'rack',
      'guards',
    ]);
    const battlement = data.siege.objectives.pool.find((objective) => objective.kind === 'guards');
    expect(first.guards).toHaveLength(battlement?.kind === 'guards' ? battlement.guards : 0);
    // Each guard his own stretch.
    const slots = first.guards.map((guard) => JSON.stringify(guard.slot));
    expect(new Set(slots).size).toBe(slots.length);
    // Across seeds, they're placed in different places.
    const seeds = Array.from({ length: 30 }, (_, seed) => plan(seed));
    expect(new Set(seeds.map((entry) => entry.captainWindow)).size).toBeGreaterThan(2);
    expect(new Set(seeds.map((entry) => entry.rack)).size).toBeGreaterThan(1);
    expect(
      new Set(seeds.map((entry) => entry.guards.map((guard) => guard.slot.post).join())).size,
    ).toBeGreaterThan(3);
  });

  it('picks only as many as the data asks, from its pool', () => {
    const fewer = structuredClone(data.siege);
    fewer.objectives.count = 1;
    const kinds = Array.from({ length: 20 }, (_, seed) =>
      planRound(fewer, LAYOUT, new Rng(seed)).objectives.map((o) => o.kind),
    );
    expect(kinds.every((list) => list.length === 1)).toBe(true);
    expect(new Set(kinds.flat()).size).toBe(3);
  });

  it('checks each kind: the captain down, the rack broken, enough guards down', () => {
    const view = { captainDown: false, rackBroken: false, guardsDown: 2 };
    const battlement = {
      kind: 'guards' as const,
      name: 'x',
      guards: 5,
      kill: 3,
      posts: [],
      slot: 2,
    };
    expect(objectiveProgress(battlement, view)).toEqual({ done: 2, needed: 3 });
    expect(objectiveDone(battlement, { ...view, guardsDown: 4 })).toBe(true);
    expect(objectiveDone({ kind: 'captain' }, view)).toBe(false);
    expect(objectiveDone({ kind: 'captain' }, { ...view, captainDown: true })).toBe(true);
    expect(objectiveDone({ kind: 'rack' }, { ...view, rackBroken: true })).toBe(true);
  });
});

describe('the siege round', () => {
  it('stands still on its own until hit, guards and all', () => {
    const { round } = siege();
    run(round, 180);
    expect(round.parts.every((part) => part.mode === 'fixed')).toBe(true);
    expect(round.guards.every((guard) => !guard.down)).toBe(true);
    // The battlement's guards walk their stretches.
    const walker = round.guards.findIndex((guard) => guard.slot?.kind === 'path');
    const before = { ...guardAt(round, walker) };
    run(round, 60);
    const after = guardAt(round, walker);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.1);
    round.dispose();
  });

  it('logs the round’s start with its objectives and the feel values', () => {
    const { round, logs } = siege();
    const start = logs.find((event) => event.type === 'siege.roundStart');
    expect(start?.data).toMatchObject({
      seed: 7,
      par: data.siege.par,
      vantage: 'hill',
      feel: data.siege.feel,
    });
    expect((start?.data?.objectives as unknown[]).length).toBe(data.siege.objectives.count);
    // Each guard's look, from the seed.
    const looks = (start?.data?.guards as { look: string }[]).map((guard) => guard.look);
    expect(looks).toEqual(
      round.guards.filter((guard) => guard.role === 'guard').map((guard) => guard.look),
    );
    round.dispose();
  });

  it('dresses each guard in a look from the seed, apart from the rules: the same seed, the same looks', () => {
    const looksOf = (seed: number) => {
      const { round } = siege({ seed });
      const looks = round.guards.map((guard) => guard.look);
      const plan = round.plan;
      round.dispose();
      return { looks, plan };
    };
    const first = looksOf(7);
    expect(looksOf(7).looks).toEqual(first.looks);
    const guards = first.looks.slice(0, -1);
    // Five guards, five looks: each a different one; the captain his own.
    expect(new Set(guards).size).toBe(Math.min(guards.length, data.characters.guards.length));
    for (const look of guards) expect(data.characters.guards).toContain(look);
    expect(first.looks.at(-1)).toBe(data.siege.skins.captain.character);
    // Other seeds dress them otherwise, but the looks never move what the rules place.
    const seeds = [1, 2, 3, 4, 5, 6, 8, 9];
    expect(seeds.some((seed) => looksOf(seed).looks.join() !== first.looks.join())).toBe(true);
    expect(looksOf(7).plan).toEqual(first.plan);
  });

  it('a volley through his window brings the captain down: an objective done, and logged', () => {
    const { round, logs, events } = siege({ plan: planWith(7, { captainWindow: 0 }) });
    const captain = round.guards.findIndex((guard) => guard.role === 'captain');
    const objective = round.plan.objectives.findIndex((entry) => entry.kind === 'captain');
    // What the camera sees there is the captain: Fire aims at what the rules have under it.
    const eye = data.castle.vantages[HILL]?.at ?? [0, 0, 0];
    const at = guardAt(round, captain);
    const from = { x: eye[0], y: eye[1], z: eye[2] };
    const seen = round.rayHit(from, { x: at.x - from.x, y: at.y - from.y, z: at.z - from.z }, 200);
    expect(Math.hypot((seen?.x ?? 0) - at.x, (seen?.z ?? 0) - at.z)).toBeLessThan(1);
    expect(shoot(round, at)).toBe(true);
    expect(round.guards[captain]?.down).toBe(true);
    expect(round.guards[captain]?.by).toBe('spear');
    expect(round.progress[objective]).toEqual({ done: 1, needed: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'objective', objective, complete: true }),
    );
    expect(logs.find((event) => event.type === 'siege.objective')?.data).toMatchObject({
      kind: 'captain',
      complete: true,
      vantage: 'hill',
    });
    round.dispose();
  });

  it('an aimed volley at a guard’s chest over the parapet brings him down, from each vantage', () => {
    for (const vantage of [HILL, TOWER]) {
      const { round } = siege({ vantage });
      const guard = round.guards.findIndex((entry) => entry.slot?.kind === 'lookout');
      expect(guard).toBeGreaterThanOrEqual(0);
      const at = guardAt(round, guard);
      // His chest: a little over his box's middle, over the parapet.
      shoot(round, { x: at.x, y: at.y + 0.3, z: at.z });
      expect(round.guards[guard]).toMatchObject({ down: true, by: 'spear' });
      round.dispose();
    }
  });

  it('knocking the wall out from under the battlement brings its guards down with it', () => {
    const { round, events } = siege();
    const guard = round.guards.findIndex((entry) => entry.slot?.kind === 'path');
    const shots = dropColumnUnder(round, guard);
    expect(shots).toBeLessThanOrEqual(3);
    expect(round.guards[guard]).toMatchObject({ down: true, by: 'fall' });
    // The chunk broke, and what stood on it came loose and fell.
    expect(events.some((event) => event.type === 'break')).toBe(true);
    expect(events.some((event) => event.type === 'loose')).toBe(true);
    expect(round.partsDown).toBeGreaterThanOrEqual(2);
    const objective = round.plan.objectives.findIndex((entry) => entry.kind === 'guards');
    expect(round.progress[objective]?.done).toBeGreaterThanOrEqual(1);
    round.dispose();
  });

  it('the spear rack breaks to a spear from the siege tower, where it can be seen', () => {
    const { round } = siege({ plan: planWith(7, { rack: 'spear_rack' }), vantage: TOWER });
    const objective = round.plan.objectives.findIndex((entry) => entry.kind === 'rack');
    shoot(round, partMiddle(round, 'spear_rack'));
    expect(round.parts.find((part) => part.kind === 'rack')?.mode).toBe('broken');
    expect(round.progress[objective]).toEqual({ done: 1, needed: 1 });
    round.dispose();
  });

  it('every objective done: won, and once it settles, the round ends with stars by par', () => {
    const plan = planWith(7, {
      objectives: [{ kind: 'captain' }, { kind: 'rack' }],
      captainWindow: 0,
      rack: 'spear_rack',
      guards: [],
    });
    const { round, finished, warchest } = siege({ plan, vantage: HILL });
    const captain = round.guards.findIndex((guard) => guard.role === 'captain');
    shoot(round, guardAt(round, captain));
    expect(round.phase).toBe('aim');
    round.setVantage(TOWER);
    shoot(round, partMiddle(round, 'spear_rack'), 'aimed', 0);
    run(round, 600);
    expect(round.phase).toBe('done');
    const [result] = finished;
    expect(result).toMatchObject({
      ending: 'all',
      done: 2,
      total: 2,
      throws: 2,
      stars: 3,
      won: true,
    });
    // Half the spears back, and the star bonus on top.
    expect(result?.recovered).toBeGreaterThan(0);
    expect(warchest.spears).toBe(600 - AIMED * 2);
    expect(result?.xp).toBeGreaterThan(data.siege.rewards.winXp);
    round.dispose();
  });

  it('out of spears with nothing done is a loss: no stars, no spears back', () => {
    const { round, finished } = siege({ spears: AIMED });
    // Into the field, well short of the castle.
    shoot(round, { x: -20, y: 0, z: 45 }, 'aimed', 0);
    run(round, 900);
    expect(round.phase).toBe('done');
    expect(finished[0]).toMatchObject({ ending: 'spears', won: false, stars: 0, recovered: 0 });
    round.dispose();
  });

  it('out of spears with some done is one star, and withdrawing ends it with what’s done', () => {
    const plan = planWith(7, { captainWindow: 0 });
    const some = siege({ spears: AIMED, plan });
    const captain = some.round.guards.findIndex((guard) => guard.role === 'captain');
    shoot(some.round, guardAt(some.round, captain), 'aimed', 0);
    run(some.round, 900);
    expect(some.finished[0]).toMatchObject({ ending: 'spears', won: true, stars: 1, done: 1 });
    some.round.dispose();

    const left = siege({ plan });
    shoot(left.round, guardAt(left.round, captain));
    left.round.withdraw();
    expect(left.round.phase).toBe('done');
    expect(left.finished[0]).toMatchObject({ ending: 'withdrew', stars: 1, done: 1 });
    left.round.dispose();
  });

  it('an aimed volley that lands on one wall chunk breaks it, and its column comes down', () => {
    const { round, logs } = siege();
    const chunk = round.parts.findIndex((part) => part.body.id === 'front_left.wallChunk.2');
    const middle = partMiddle(round, 'front_left.wallChunk.2');
    shoot(round, { x: middle.x, y: middle.y, z: middle.z + 1.5 }, 'aimed', 300);
    expect(round.parts[chunk]?.mode).toBe('broken');
    // What stood on it fell, and broke as it landed.
    for (const id of ['front_left.wallChunk.3', 'front_left.battlement.1']) {
      const part = round.parts.find((entry) => entry.body.id === id);
      expect(part?.fallen || part?.mode === 'broken').toBe(true);
    }
    // What the throw did is logged once it's known: when the next goes, or at the end.
    expect(logs.some((event) => event.type === 'siege.throwDone')).toBe(false);
    round.withdraw();
    const done = logs.find((event) => event.type === 'siege.throwDone')?.data;
    expect(done).toMatchObject({ throw: 1, mode: 'aimed' });
    expect(done?.partsBroken).toBeGreaterThanOrEqual(1);
    expect(done?.partsLoosened).toBeGreaterThanOrEqual(2);
    round.dispose();
  });

  it('a tower that loses half its bottom row comes down, and its lookout with it', () => {
    const lookout = planWith(7).guards.find((guard) => guard.slot.kind === 'lookout');
    const guards = planWith(7).guards.map((guard, index) =>
      index === 0
        ? { ...guard, slot: { post: 'south_west_top', kind: 'lookout' as const } }
        : guard,
    );
    const { round, logs } = siege({ plan: planWith(7, lookout ? {} : { guards }) });
    const tower = round.parts.filter((part) => part.body.owner === 'south_west');
    const sectors = data.castle.towerChunks.sectors;
    for (const x of [-19.5, -18, -16.5]) shoot(round, { x, y: 1.5, z: 19.3 }, 'aimed', 240);
    const bottom = tower.slice(0, sectors).filter((part) => part.mode === 'fixed');
    expect(bottom.length).toBeLessThan(data.siege.bodies.towerHold);
    // Everything above came loose: nothing up there is where it was built.
    expect(tower.slice(sectors).every((part) => part.mode !== 'fixed')).toBe(true);
    expect(logs.find((event) => event.type === 'siege.collapse')?.data).toMatchObject({
      owner: 'south_west',
      needed: data.siege.bodies.towerHold,
    });
    const onTop = round.guards.filter((guard) => guard.slot?.post === 'south_west_top');
    expect(onTop.length).toBeGreaterThan(0);
    expect(onTop.every((guard) => guard.down)).toBe(true);
    round.dispose();
  });

  it('a pier of the gatehouse knocked out brings down what it held, merlons and all', () => {
    const { round, events } = siege({ vantage: LOW });
    const mode = (id: string) => round.parts.find((part) => part.body.id === id)?.mode;
    shoot(round, { x: 3, y: 1.5, z: 20 }, 'aimed', 240);
    // The front block of the right pier's foot went; the pier's blocks on it came loose, and the
    // stonework over the gate that they held.
    expect(mode('gatehouse.gatehouseChunk.2')).toBe('broken');
    const loose = events.flatMap((event) =>
      event.type === 'loose' ? [round.parts[event.part]?.body.id] : [],
    );
    expect(loose).toEqual(
      expect.arrayContaining([
        'gatehouse.gatehouseChunk.7',
        'gatehouse.gatehouseChunk.13',
        'gatehouse.gatehouseChunk.9',
      ]),
    );
    expect(loose.some((id) => id?.startsWith('gatehouse.merlon'))).toBe(true);
    round.dispose();
  });

  it('breaking the block of the keep the captain stands in brings him down', () => {
    // A top-storey window: his block comes apart (the storeys under it never do).
    const { round, events } = siege({ plan: planWith(7, { captainWindow: 0 }) });
    const captain = round.guards.findIndex((guard) => guard.role === 'captain');
    const objective = round.plan.objectives.findIndex((entry) => entry.kind === 'captain');
    const at = guardAt(round, captain);
    // Well to the side of him, on the same block's face.
    shoot(round, { x: at.x - 2.3, y: at.y, z: at.z }, 'aimed', 240);
    expect(round.parts.find((part) => part.body.id === 'keep.storeyChunk.1')?.mode).toBe('broken');
    expect(events.some((event) => event.type === 'hit' && event.target.kind === 'guard')).toBe(
      false,
    );
    expect(round.guards[captain]).toMatchObject({ down: true, by: 'fall' });
    expect(round.progress[objective]).toEqual({ done: 1, needed: 1 });
    // The roof lost a block under it and came loose. A lower window's captain has no such block.
    expect(events).toContainEqual({
      type: 'loose',
      part: round.parts.findIndex((part) => part.kind === 'roof'),
    });
    round.dispose();
    const lower = siege({ plan: planWith(7, { captainWindow: 2 }) });
    const below = lower.round.guards.findIndex((guard) => guard.role === 'captain');
    const low = guardAt(lower.round, below);
    shoot(lower.round, { x: low.x - 2.3, y: low.y, z: low.z }, 'aimed', 240);
    expect(lower.round.guards[below]?.down).toBe(false);
    lower.round.dispose();
  });

  it('the spear rack crushed by falling stone counts as broken', () => {
    // The rack moved into the gate's passage, under the stonework over the gate.
    const game = structuredClone(data);
    const prop = game.castle.props.find((entry) => entry.id === 'spear_rack');
    if (!prop) throw new Error('No spear rack');
    prop.at = [0, 13.6];
    prop.turn = 0;
    const { round, events } = siege({
      game,
      plan: planWith(7, { rack: 'spear_rack' }),
      vantage: TOWER,
    });
    const rack = round.parts.findIndex((part) => part.kind === 'rack');
    const objective = round.plan.objectives.findIndex((entry) => entry.kind === 'rack');
    // The back of the right pier's foot, low on its courtyard side (spears that go on through it
    // come down short of the rack): what's over the gate rests on it.
    for (let shot = 0; shot < 4 && round.parts[rack]?.mode !== 'broken'; shot++) {
      shoot(round, { x: 4.5, y: 0.8, z: 13.2 }, 'aimed', 300);
    }
    expect(round.parts[rack]?.mode).toBe('broken');
    expect(
      events.some(
        (event) =>
          event.type === 'hit' && event.target.kind === 'part' && event.target.index === rack,
      ),
    ).toBe(false);
    expect(round.progress[objective]).toEqual({ done: 1, needed: 1 });
    round.dispose();
  });

  it('tells what can be seen from a vantage point: the captain at his window, not behind the keep', () => {
    const { round } = siege({ plan: planWith(7, { captainWindow: 0 }) });
    const captain = round.guards.findIndex((guard) => guard.role === 'captain');
    const eye = (id: number) => {
      const [x, y, z] = data.castle.vantages[id]?.at ?? [0, 0, 0];
      return { x, y, z };
    };
    const at = guardAt(round, captain);
    expect(round.sees(eye(HILL), at, 1.2)).toBe(true);
    // From the low ground the front wall stands in the way.
    expect(round.sees(eye(LOW), at, 1.2)).toBe(false);
    expect(round.sees(eye(HILL), { x: at.x, y: 1, z: at.z - 12 }, 1.2)).toBe(false);
    round.dispose();
  });

  it('landed spears stop being bodies, and loose chunks are fixed where they settle', () => {
    const { round } = siege();
    const guard = round.guards.findIndex((entry) => entry.slot?.kind === 'path');
    dropColumnUnder(round, guard);
    shoot(round, { x: 0, y: 6, z: 17 }, 'barrage', 0);
    expect(round.spearBodies).toBeGreaterThan(0);
    run(round, 600);
    expect(round.spearBodies).toBe(0);
    expect(round.partsLoose).toBe(0);
    expect(round.parts.some((part) => part.mode === 'frozen')).toBe(true);
    // Each spear still drawn somewhere sensible: on the field or in the castle, not lost.
    round.spears.forEach((spear, index) => {
      if (spear.gone) return;
      expect(spear.frozen).toBe(true);
      expect(round.spearPose(index, pose()).position.y).toBeGreaterThan(-1);
    });
    round.dispose();
  });

  it('replays exactly: the same seed and shots on the same steps give the same result', () => {
    const play = () => {
      const game = siege({ seed: 11 });
      const { round } = game;
      const guard = round.guards.findIndex((entry) => entry.slot?.kind === 'path');
      dropColumnUnder(round, guard);
      round.setVantage(LOW);
      shoot(round, { x: 0, y: 3, z: 19 }, 'barrage', 30);
      round.setVantage(TOWER);
      shoot(round, { x: 14, y: 8, z: 0 }, 'barrage', 400);
      round.withdraw();
      const poses = round.parts.map((_, index) => round.partPose(index, pose()));
      const spears = round.spears.map((_, index) => round.spearPose(index, pose()));
      const result = game.finished[0];
      round.dispose();
      return { result, poses, spears, plan: round.plan };
    };
    const first = play();
    const second = play();
    expect(second.result).toEqual(first.result);
    expect(second.poses).toEqual(first.poses);
    expect(second.spears).toEqual(first.spears);
    expect(first.result?.partsDown).toBeGreaterThan(0);
    // Another seed, another castle.
    expect(planWith(12)).not.toEqual(first.plan);
  });

  it('moves between vantage points at any time, and shoots from where it stands, logged', () => {
    const { round, logs } = siege();
    const hill = round.mount();
    expect(round.setVantage(LOW)).toBe(true);
    expect(round.setVantage(LOW)).toBe(false);
    const low = round.mount();
    expect(Math.hypot(low.x - hill.x, low.y - hill.y, low.z - hill.z)).toBeGreaterThan(10);
    // At the low ground the ballista stands on the field.
    expect(low.y).toBeCloseTo(0, 1);
    shoot(round, { x: 0, y: 3, z: 20 });
    const thrown = logs.find((event) => event.type === 'siege.throw')?.data;
    expect(thrown).toMatchObject({
      mode: 'aimed',
      vantage: 'low',
      power: WEAPON.speed,
      spears: AIMED,
    });
    expect(thrown?.aim).toMatchObject({ at: { x: 0, y: 3, z: 20 } });
    expect(logs.some((event) => event.type === 'siege.vantage')).toBe(true);
    round.dispose();
  });

  it('takes each shot’s spears from the warchest, as many as it shoots', () => {
    const { round, warchest, logs } = siege({ spears: 22 });
    const target = { x: 0, y: 5, z: 17 };
    expect(shoot(round, target, 'barrage', 0)).toBe(true);
    expect(warchest.spears).toBe(22 - 15);
    expect(round.throw('aimed', { yaw: 0, tilt: 0 })).toBe(false);
    expect(shoot(round, target, 'barrage', 0)).toBe(true);
    expect(warchest.spears).toBe(0);
    expect(round.used).toBe(22);
    reload(round, 120);
    expect(round.canThrow).toBe(false);
    const throws = logs.filter((event) => event.type === 'siege.throw');
    expect(throws.map((event) => event.data?.spears)).toEqual([15, 7]);
    round.dispose();
  });
});

describe('the weapon', () => {
  const at = { x: 0, y: 22, z: 50 };
  const ahead: Aim = { yaw: 0, tilt: -10 * DEG };

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
    const spears = shotSpears('barrage', ahead, at, 5, 7, WEAPON, data.siege.feel, new Rng(1));
    expect(spears).toHaveLength(7);
    expect(spears.slice(0, 5).every((spear) => spear.wave === 0)).toBe(true);
    expect(spears[5]?.delay).toBeGreaterThanOrEqual(data.siege.feel.barrageStagger);
  });

  it('keeps the aim within the weapon’s tilt, turning all the way round', () => {
    expect(clampAim({ yaw: 0, tilt: 60 * DEG }, WEAPON).tilt).toBeCloseTo(WEAPON.tilt.max * DEG);
    expect(clampAim({ yaw: 0, tilt: -70 * DEG }, WEAPON).tilt).toBeCloseTo(WEAPON.tilt.min * DEG);
    expect(clampAim({ yaw: 2, tilt: 0 }, WEAPON).yaw).toBe(2);
  });

  it('aims the middle spear through the point under the sight from up high, drop and all', () => {
    const gravity = data.siege.physics.gravity;
    for (const target of [
      { x: -2, y: 7.8, z: -4 },
      { x: 6.5, y: 0.5, z: 0.5 },
      { x: 10, y: 1.5, z: 17.4 },
    ]) {
      const aim = solveAim(at, target, WEAPON, gravity);
      const { position, velocity } = launchFrom(at, aim, WEAPON.speed, 0, WEAPON);
      const out = Math.hypot(target.x - position.x, target.z - position.z);
      const t = out / Math.hypot(velocity.x, velocity.z);
      expect(position.x + velocity.x * t).toBeCloseTo(target.x, 2);
      expect(position.z + velocity.z * t).toBeCloseTo(target.z, 2);
      expect(position.y + velocity.y * t - 0.5 * gravity * t * t).toBeCloseTo(target.y, 2);
    }
  });

  it('a barrage strays far wider than an aimed volley', () => {
    const spread = (mode: ThrowMode) => {
      const spears = shotSpears(mode, ahead, at, 5, 15, WEAPON, data.siege.feel, new Rng(3));
      const yaws = spears.map((spear) => Math.atan2(spear.velocity.x, -spear.velocity.z));
      return Math.max(...yaws) - Math.min(...yaws);
    };
    expect(spread('barrage')).toBeGreaterThan(spread('aimed') * 3);
  });
});

describe('siege stars and rewards', () => {
  const par = data.siege.par;
  it('3 for every objective at or under par, 2 for every objective, 1 for some, none for none', () => {
    expect(siegeStars({ done: 3, objectives: 3, throws: par }, par)).toBe(3);
    expect(siegeStars({ done: 3, objectives: 3, throws: par + 1 }, par)).toBe(2);
    expect(siegeStars({ done: 2, objectives: 3, throws: 1 }, par)).toBe(1);
    expect(siegeStars({ done: 0, objectives: 3, throws: 1 }, par)).toBe(0);
  });

  it('pays Command XP for parts, guards and objectives, and recovers a share on a win', () => {
    const recovery = data.tuning.weaponRecoveryOnWin;
    const { rewards, starBonus } = data.siege;
    const outcome = { done: 3, objectives: 3, throws: par, used: 40, partsDown: 6, guardsDown: 4 };
    const three = siegeRewards(outcome, data.siege, recovery);
    const base =
      6 * rewards.xpPerPart + 4 * rewards.xpPerGuard + 3 * rewards.xpPerObjective + rewards.winXp;
    expect(three.stars).toBe(3);
    expect(three.xp).toBe(base + Math.round(base * starBonus.three));
    const back = Math.floor(40 * recovery);
    expect(three.recovered).toBe(back + Math.round(back * starBonus.three));
    const lost = siegeRewards({ ...outcome, done: 0 }, data.siege, recovery);
    expect(lost).toMatchObject({ stars: 0, won: false, recovered: 0 });
    expect(lost.xp).toBe(6 * rewards.xpPerPart + 4 * rewards.xpPerGuard);
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
  const battlement = (raw: GameDataInput) => {
    const objective = raw.siege.objectives.pool.find((entry) => entry.kind === 'guards');
    if (objective?.kind !== 'guards') throw new Error('No battlement objective');
    return objective;
  };

  it('is valid as shipped', () => {
    expect(() => parseGameData(editableRawData())).not.toThrow();
  });

  it('fails on a post the castle hasn’t got, too many to kill, or no room for the guards', () => {
    fails((raw) => {
      battlement(raw).posts.push('the_moon');
    }, 'Unknown post "the_moon"');
    fails((raw) => {
      battlement(raw).kill = 9;
    }, 'Kill no more guards than there are');
    fails((raw) => {
      const objective = battlement(raw);
      objective.posts = ['south_west_top'];
    }, 'Room for 1 guards');
  });

  it('fails on picking more objectives than the pool has', () => {
    fails((raw) => {
      raw.siege.objectives.count = 4;
    }, 'Pick no more objectives than the pool has');
  });

  it('fails on an unknown material, a bad tilt range or weapon, or shadows unlike the castle’s', () => {
    fails((raw) => {
      raw.siege.parts.gate.material = 'marble';
    }, 'Unknown material "marble"');
    fails((raw) => {
      const weapon = raw.siege.weapons[0];
      if (weapon) weapon.tilt.min = 50;
    }, 'Needs min under max');
    fails((raw) => {
      raw.siege.weapon = 'trebuchet';
    }, 'Unknown weapon "trebuchet"');
    fails((raw) => {
      raw.siege.looks.tiers.low.shadows = 'map';
    }, 'Shadows as the castle draws them');
  });

  it('fails on a captain or clip the characters haven’t got, or a box too small for the body', () => {
    fails((raw) => {
      raw.siege.skins.captain.character = 'king';
    }, 'Unknown character "king"');
    fails((raw) => {
      raw.siege.skins.guard.clips.hit = 'flinch';
    }, 'Unknown clip "flinch"');
    fails((raw) => {
      raw.siege.guard.size = [0.5, 2, 0.62];
    }, 'Too small for the body');
  });

  it('boxes a guard round the knight’s body, a little more than it, every look the same', () => {
    const [width, height, depth] = data.siege.guard.size;
    const [bodyWidth, bodyHeight, bodyDepth] = data.characters.body;
    // About 10% round the body: near misses count, but not empty air.
    for (const [box, body] of [
      [width, bodyWidth],
      [height, bodyHeight],
      [depth, bodyDepth],
    ] as const) {
      expect(box / body).toBeGreaterThan(1.05);
      expect(box / body).toBeLessThan(1.2);
    }
  });
});
