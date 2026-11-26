import { beforeAll, describe, expect, it } from 'vitest';
import { GameDataError, parseGameData, type GameData, type GameDataInput } from '../src/data';
import { objectiveMet } from '../src/stations/siege/logic/objective';
import { loadPhysics, type Physics } from '../src/stations/siege/logic/physics';
import {
  SiegeRound,
  type Pose,
  type SiegeEvent,
  type SiegeResult,
} from '../src/stations/siege/logic/round';
import { siegeRewards, siegeStars } from '../src/stations/siege/logic/score';
import {
  aimFromDrag,
  spearsThrown,
  throwCost,
  throwerCount,
  throwSpears,
} from '../src/stations/siege/logic/throw';
import { Rng, type LogEvent } from '../src/core';
import { data, dataWith, editableRawData, testLogger } from './helpers';

let physics: Physics;
beforeAll(async () => {
  physics = await loadPhysics();
});

const pose = (): Pose => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

/** A round on `fort`, with `spears` in a pretend warchest. */
function siege(
  fort: string,
  {
    spears = 200,
    throwers = 5,
    seed = 7,
    game = data,
  }: Partial<{
    spears: number;
    throwers: number;
    seed: number;
    game: GameData;
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
    { throwers, seed },
  );
  return { round, warchest, events, finished, logs };
}

function run(round: SiegeRound, steps: number): void {
  for (let step = 0; step < steps && round.phase !== 'done'; step++) round.step();
}

type Blocks = GameDataInput['siege']['forts'][number]['blocks'];

/** The real data plus a test fort, `test`, of these blocks. */
function fortData(blocks: Blocks): GameData {
  return dataWith((raw) => {
    raw.siege.forts.push({
      id: 'test',
      name: 'Test',
      objective: { kind: 'banner_down' },
      par: 5,
      rewards: { xpPerBlock: 2, winXp: 10 },
      blocks,
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

describe('siege forts', () => {
  it('stand still on their own until hit', () => {
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
      expect(round.blocksDown).toBe(0);
      expect(round.phase).toBe('aim');
      round.dispose();
    }
  });

  it('a well-aimed throw hits the wall, dealing damage', () => {
    const { round, events } = siege('outpost');
    expect(round.throw('aimed', { power: 0.55, yaw: 0 })).toBe(true);
    run(round, 180);
    const hits = events.flatMap((event) => (event.type === 'hit' ? [event] : []));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(round.blocks[hit.block]?.kind).toBe('stone');
    expect(hits.some((hit) => hit.damage > 0)).toBe(true);
    const hurt = round.blocks.filter((block) => block.hp < block.maxHp);
    expect(hurt.length).toBeGreaterThan(0);
    expect(round.damage).toBeGreaterThan(0);
    // Every impact is there for other rules (noise, later) to hook into.
    expect(events.some((event) => event.type === 'impact' && event.by === 'spear')).toBe(true);
    round.dispose();
  });

  it('replays exactly: the same seed and throws on the same steps give the same result', () => {
    const play = () => {
      const { round, events } = siege('outpost', { seed: 42 });
      round.throw('barrage', { power: 0.7, yaw: 0.02 });
      run(round, 90);
      round.throw('aimed', { power: 0.8, yaw: -0.05 });
      run(round, 400);
      const poses = round.blocks.map((_, index) => round.blockPose(index, pose()));
      const outcome = {
        poses,
        hp: round.blocks.map((block) => block.hp),
        events: events.map((event) => event.type),
        used: round.used,
        down: round.blocksDown,
      };
      round.dispose();
      return outcome;
    };
    const first = play();
    expect(first.events).toContain('break');
    expect(play()).toEqual(first);
  });

  it('a stone wall wears down and breaks under repeated hits', () => {
    const { round, events } = siege('outpost', { spears: 1000 });
    for (let throwIndex = 0; throwIndex < 8; throwIndex++) {
      round.throw('aimed', { power: 0.45, yaw: 0 });
      run(round, 70);
    }
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
    round.throw('aimed', { power: 0.2, yaw: 0 });
    run(round, 240);
    expect(events).toContainEqual(expect.objectContaining({ type: 'break', block: 1 }));
    expect(round.blocks[1]?.broken).toBe(true);
    expect(round.blocks[1]?.hp).toBe(0);
    // Gone from the world: no spear thrown later can touch it.
    const hitsBefore = events.filter((event) => event.type === 'hit' && event.block === 1).length;
    round.throw('aimed', { power: 0.2, yaw: 0 });
    run(round, 240);
    expect(events.filter((event) => event.type === 'hit' && event.block === 1)).toHaveLength(
      hitsBefore,
    );
    // The beam it held up has come down at that end.
    const { position } = round.blockPose(2, pose());
    expect(position.y).toBeLessThan(1.3 - 0.3);
    round.dispose();
  });

  it('a banner on the ground wins, and the round ends once the fort settles', () => {
    const game = fortData([BOARD]);
    const { round, events, finished } = siege('test', { game, spears: 40 });
    round.throw('aimed', { power: 0.5, yaw: 0 });
    run(round, 900);
    expect(events.map((event) => event.type)).toContain('bannerFalling');
    expect(events.map((event) => event.type)).toContain('won');
    expect(round.phase).toBe('done');
    expect(finished).toHaveLength(1);
    expect(finished[0]?.won).toBe(true);
    expect(finished[0]?.used).toBe(5);
    expect(finished[0]?.throws).toBe(1);
    expect(finished[0]?.stars).toBe(3);
    round.dispose();
  });

  it('with no spears left, the round is lost once everything has settled', () => {
    const { round, finished, logs } = siege('outpost', { spears: 3 });
    round.throw('aimed', { power: 0.5, yaw: 0 });
    run(round, 900);
    expect(round.phase).toBe('done');
    expect(finished[0]?.won).toBe(false);
    expect(finished[0]?.used).toBe(3);
    expect(finished[0]?.recovered).toBe(0);
    const end = logs.find((event) => event.type === 'siege.end');
    expect(end?.data).toMatchObject({
      won: false,
      throws: 1,
      spearsUsed: 3,
      par: data.siege.forts[0]?.par,
    });
    expect(end?.data).toHaveProperty('blocksBroken');
    expect(end?.data).toHaveProperty('damage');
    round.dispose();
  });
});

describe('the objective', () => {
  it('banner_down is met once the banner is below the win height (or the fort’s own)', () => {
    const rules = data.siege;
    const height = rules.banner.winHeight;
    expect(objectiveMet({ kind: 'banner_down' }, { rules, bannerHeight: height - 0.01 })).toBe(
      true,
    );
    expect(objectiveMet({ kind: 'banner_down' }, { rules, bannerHeight: height + 0.01 })).toBe(
      false,
    );
    expect(objectiveMet({ kind: 'banner_down' }, { rules, bannerHeight: undefined })).toBe(false);
    expect(objectiveMet({ kind: 'banner_down', height: 3 }, { rules, bannerHeight: 2 })).toBe(true);
  });
});

describe('the line of throwers', () => {
  it('grows with the Command level', () => {
    const { start, everyLevels, add } = data.siege.throwers;
    expect(throwerCount(data.siege, 1)).toBe(start);
    expect(throwerCount(data.siege, everyLevels)).toBe(start + add);
    expect(throwerCount(data.siege, everyLevels * 3 + 1)).toBe(start + add * 3);
  });

  it('costs a spear a thrower aimed, and `barrage` a thrower in a barrage', () => {
    expect(throwCost('aimed', 5, data.siege)).toBe(5);
    expect(throwCost('barrage', 5, data.siege)).toBe(5 * data.siege.barrage);
    expect(spearsThrown('barrage', 5, 7, data.siege)).toBe(7);
    expect(spearsThrown('aimed', 5, 3, data.siege)).toBe(3);
    expect(spearsThrown('aimed', 5, 0, data.siege)).toBe(0);
  });

  it('with fewer spears than throwers, only the middle ones throw', () => {
    const spears = throwSpears(
      'aimed',
      { power: 0.5, yaw: 0 },
      5,
      3,
      data.siege,
      data.siege.feel,
      new Rng(1),
    );
    expect(spears.map((spear) => spear.thrower).sort()).toEqual([1, 2, 3]);
    const barrage = throwSpears(
      'barrage',
      { power: 0.5, yaw: 0 },
      5,
      7,
      data.siege,
      data.siege.feel,
      new Rng(1),
    );
    expect(barrage).toHaveLength(7);
    // Everyone throws their first before anyone throws a second, and seconds come later.
    expect(new Set(barrage.slice(0, 5).map((spear) => spear.thrower)).size).toBe(5);
    expect(Math.min(...barrage.slice(5).map((spear) => spear.delay))).toBeGreaterThan(
      Math.max(...barrage.slice(0, 5).map((spear) => spear.delay)) - data.siege.feel.barrageStagger,
    );
  });

  it('takes each throw’s spears from the warchest, as many as the line throws', () => {
    const { round, warchest, logs } = siege('outpost', { spears: 22 });
    expect(round.throw('barrage', { power: 0.6, yaw: 0 })).toBe(true);
    expect(warchest.spears).toBe(22 - 15);
    // Not until the barrage has left and landed (or the reload is up).
    expect(round.throw('aimed', { power: 0.6, yaw: 0 })).toBe(false);
    run(round, 120);
    expect(round.throw('barrage', { power: 0.6, yaw: 0 })).toBe(true);
    expect(warchest.spears).toBe(0);
    expect(round.used).toBe(22);
    run(round, 120);
    expect(round.canThrow).toBe(false);
    const throws = logs.filter((event) => event.type === 'siege.throw');
    expect(throws.map((event) => event.data?.spears)).toEqual([15, 7]);
    expect(throws[0]?.data).toMatchObject({ mode: 'barrage', power: 0.6, angle: 0 });
    round.dispose();
  });

  it('a barrage strays far wider than an aimed throw', () => {
    const spread = (mode: 'aimed' | 'barrage') => {
      const spears = throwSpears(
        mode,
        { power: 0.6, yaw: 0 },
        5,
        15,
        data.siege,
        data.siege.feel,
        new Rng(3),
      );
      // Where each crosses the distance the line aims to meet at: aimed spears group there.
      const reach = data.siege.throwers.converge;
      const xs = spears.map(
        (spear) =>
          spear.position.x + (spear.velocity.x / -spear.velocity.z) * (reach + spear.position.z),
      );
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread('barrage')).toBeGreaterThan(spread('aimed') * 2);
  });

  it('turns a drag back into a throw: longer is harder, sideways turns the other way', () => {
    const feel = data.siege.feel;
    expect(aimFromDrag(0, feel.deadPx / 2, feel)).toBeUndefined();
    expect(aimFromDrag(0, -100, feel)).toBeUndefined();
    expect(aimFromDrag(0, feel.pullPx * 2, feel)?.power).toBe(1);
    const left = aimFromDrag(-40, 120, feel);
    expect(left?.yaw).toBeGreaterThan(0);
    expect(Math.abs(aimFromDrag(-1000, 1, feel)?.yaw ?? 0)).toBeCloseTo(
      (feel.maxAim * Math.PI) / 180,
    );
  });
});

describe('siege stars and rewards', () => {
  const stars = data.siege.stars;
  const won = (throws: number, used = 20) => ({ won: true, used, throws, blocksDown: 10 });

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

  it('pays Command XP per block down plus the win bonus, and recovers a share, both with the star bonus', () => {
    const fort = { par: 3, rewards: { xpPerBlock: 3, winXp: 60 } };
    const recovery = data.tuning.weaponRecoveryOnWin;
    const three = siegeRewards(won(3), fort, data.siege, recovery);
    const base = 10 * 3 + 60;
    expect(three.stars).toBe(3);
    expect(three.xp).toBe(base + Math.round(base * data.siege.starBonus.three));
    const back = Math.floor(20 * recovery);
    expect(three.recovered).toBe(back + Math.round(back * data.siege.starBonus.three));
    const one = siegeRewards(won(8, 40), fort, data.siege, recovery);
    expect(one.xp).toBe(base);
    expect(one.recovered).toBe(Math.floor(40 * recovery));
    const lost = siegeRewards({ ...won(8, 40), won: false }, fort, data.siege, recovery);
    expect(lost).toMatchObject({ stars: 0, xp: 30, recovered: 0 });
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

  it('fails on an unknown material, a missing banner and bad throw ranges', () => {
    fails((raw) => {
      const block = outpost(raw).blocks[0];
      if (block) block.material = 'marble';
    }, 'Unknown material "marble"');
    fails((raw) => {
      const fort = outpost(raw);
      fort.blocks = fort.blocks.filter((block) => !block.banner);
    }, 'needs a banner');
    fails((raw) => {
      raw.siege.feel.minSpeed = raw.siege.feel.maxSpeed + 1;
    }, 'Must be under maxSpeed');
    fails((raw) => {
      raw.siege.throwers.skill = 'juggling';
    }, 'Unknown skill "juggling"');
  });
});
