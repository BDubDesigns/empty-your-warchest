import { describe, expect, it } from 'vitest';
import { Game, doWork, newGameState, workerRate, type Stack, type WorkState } from '../src/core';
import { GameDataError, parseGameData, type FletchingFeel, type GameData } from '../src/data';
import {
  FletchingRound,
  arrowsAllowed,
  benchSize,
  carefulResult,
  markAngle,
  nextBenchSize,
  streakAfter,
  pickerSizes,
  starsFor,
  stavesFor,
  tarLevel,
  tarState,
  turnAt,
  wrapDegrees,
  type FletchingEvent,
} from '../src/stations/fletching';
import { data, dataWith, editableRawData, testLogger } from './helpers';

const rules = data.fletching;
const feel = rules.feel;

/** Seconds of tar that land the level in the middle of the green band, under it, and over it. */
const tarSeconds = {
  good: (feel.tarLow + feel.tarHigh) / 2 / feel.tarFill,
  thin: (feel.tarLow * 0.5) / feel.tarFill,
  thick: Math.min(feel.tarHigh + 0.1, 1) / feel.tarFill,
  // Just under the band, but within its near miss.
  nearThin: (feel.tarLow - rules.stars.nearTar / 2) / feel.tarFill,
};

interface Bench {
  round: FletchingRound;
  counts: Record<string, number>;
  xp: number;
  banked: Stack[];
  events: FletchingEvent[];
  log: ReturnType<typeof testLogger>;
}

/** A round at the bench with this much in the warchest, at this level, size and streak. */
function bench(
  stock: Record<string, number> = { stave: 5, feather: 30 },
  pick: { size?: number; streak?: number; level?: number } = {},
  source: GameData = data,
  tuned: Partial<FletchingFeel> = {},
): Bench {
  const log = testLogger();
  const counts: Record<string, number> = { ...stock };
  const played: Bench = {
    round: undefined as unknown as FletchingRound,
    counts,
    xp: 0,
    banked: [],
    events: [],
    log,
  };
  played.round = new FletchingRound(
    source.fletching,
    { ...source.fletching.feel, ...tuned },
    {
      logger: log.logger,
      level: pick.level ?? 1,
      count: (item) => counts[item] ?? 0,
      spend: (item, count) => {
        const has = counts[item] ?? 0;
        if (has < count) throw new Error(`Spent ${String(count)} ${item}, had ${String(has)}`);
        counts[item] = has - count;
      },
      bank: (items, xp) => {
        for (const stack of items) {
          played.banked.push(stack);
          counts[stack.item] = (counts[stack.item] ?? 0) + stack.count;
        }
        played.xp += xp;
      },
      onEvent: (event) => played.events.push(event),
    },
    { size: pick.size ?? 1, streak: pick.streak ?? 1 },
  );
  return played;
}

/** Holds the shaft in the tar for `seconds`, then lifts it. */
function dip(played: Bench, seconds: number) {
  expect(played.round.dip()).toBe(true);
  played.round.tick(seconds);
  expect(played.round.lift()).toBe(true);
}

/** The seconds after the lift at which `mark` is at the top (its first time round). */
function markTime(mark: number) {
  const turn = (360 - markAngle(mark, rules.marks)) % 360;
  return feel.leadSeconds + turn / feel.turnSpeed;
}

/** Taps every mark as it comes to the top, each `offMs` late (or a list, one per tap). */
function tapAll(played: Bench, offMs: number | number[] = 0) {
  const lifted = played.round.now;
  const times = Array.from({ length: rules.marks }, (_, mark) => markTime(mark)).sort(
    (a, b) => a - b,
  );
  times.forEach((time, index) => {
    const off = Array.isArray(offMs) ? (offMs[index] ?? 0) : offMs;
    played.round.tick(lifted + time + off / 1000 - played.round.now);
    expect(played.round.tap()).toBe(true);
  });
}

describe('fletching rules', () => {
  it('fills the tar at its rate, up to a full coat, and reads it against the green band', () => {
    expect(tarLevel(0, feel)).toBe(0);
    expect(tarLevel(1, feel)).toBeCloseTo(Math.min(feel.tarFill, 1));
    expect(tarLevel(99, feel)).toBe(1);
    expect(tarState(feel.tarLow - 0.01, feel)).toBe('thin');
    expect(tarState(feel.tarLow, feel)).toBe('good');
    expect(tarState(feel.tarHigh, feel)).toBe('good');
    expect(tarState(feel.tarHigh + 0.01, feel)).toBe('thick');
  });

  it('turns the shaft so its first mark comes to the top after the lead', () => {
    expect(turnAt(feel.leadSeconds, feel)).toBeCloseTo(0);
    expect(turnAt(feel.leadSeconds + 1, feel)).toBeCloseTo(feel.turnSpeed);
    expect(markAngle(1, 3)).toBe(120);
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-540)).toBe(180);
  });

  it('makes a careful batch fletched only with good tar and every feather on its mark', () => {
    const on = [{ onMark: true }, { onMark: true }, { onMark: true }];
    const off = [{ onMark: true }, { onMark: false }, { onMark: true }];
    expect(carefulResult('good', on)).toBe('fletched');
    expect(carefulResult('good', off)).toBe('duster');
    expect(carefulResult('thick', on)).toBe('duster');
    expect(carefulResult('thin', on)).toBe('bare');
  });

  it('gives stars from the beats: 3 fletched, 2 a near miss, 1 off, and never 3 unfletched', () => {
    const band = (feel.tarLow + feel.tarHigh) / 2;
    const on = [{ offMs: 0 }, { offMs: 30 }, { offMs: -40 }];
    const near = [{ offMs: 0 }, { offMs: rules.stars.nearTapMs - 10 }, { offMs: 0 }];
    const far = [{ offMs: 0 }, { offMs: rules.stars.nearTapMs + 10 }, { offMs: 0 }];
    const stars = (made: 'fletched' | 'duster' | 'bare', tar: number, taps = on) =>
      starsFor(rules, feel, { way: 'careful', made, tar, taps });
    expect(stars('fletched', band)).toBe(3);
    // Feathers just off their marks, or tar just out of the band: a near miss.
    expect(stars('duster', band, near)).toBe(2);
    expect(stars('bare', feel.tarLow - rules.stars.nearTar + 0.01)).toBe(2);
    expect(stars('duster', feel.tarHigh + rules.stars.nearTar - 0.01)).toBe(2);
    // Further off: finished, but 1.
    expect(stars('duster', band, far)).toBe(1);
    expect(stars('bare', feel.tarLow - rules.stars.nearTar - 0.01)).toBe(1);
    expect(stars('duster', feel.tarHigh + rules.stars.nearTar + 0.01, near)).toBe(1);
    // A duster or a bare batch is never 3, however close.
    for (const made of ['duster', 'bare'] as const) {
      for (const tar of [0, feel.tarLow, band, feel.tarHigh, 1]) {
        expect(stars(made, tar)).toBeLessThan(3);
      }
    }
  });

  it('gives the bucket and bare their fixed stars from the data, under 3', () => {
    const beats = { tar: 0.6, taps: [] };
    expect(starsFor(rules, feel, { ...beats, way: 'bucket', made: 'duster' })).toBe(
      rules.stars.bucket,
    );
    expect(rules.stars.bucket).toBe(1);
    expect(starsFor(rules, feel, { ...beats, way: 'bare', made: 'bare' })).toBe(rules.stars.bare);
    expect(rules.stars.bare).toBeLessThan(3);
  });

  it('raises the streak on 3 stars up to its cap, and drops it one step otherwise, never below 1', () => {
    expect(feel.streakDrop).toBe(1);
    expect(feel.streakCap).toBe(3);
    expect(streakAfter(1, 3, feel)).toBe(2);
    expect(streakAfter(2, 3, feel)).toBe(3);
    expect(streakAfter(3, 3, feel)).toBe(3);
    expect(streakAfter(3, 2, feel)).toBe(2);
    expect(streakAfter(2, 1, feel)).toBe(1);
    expect(streakAfter(1, 1, feel)).toBe(1);
    expect(streakAfter(1, 0, feel)).toBe(1);
  });

  it('opens bigger batches with the level, by the data', () => {
    expect(benchSize(rules, 1)).toBe(1);
    expect(benchSize(rules, 4)).toBe(1);
    expect(benchSize(rules, 5)).toBe(2);
    expect(benchSize(rules, 10)).toBe(3);
    expect(benchSize(rules, 15)).toBe(4);
    expect(benchSize(rules, 20)).toBe(5);
    expect(benchSize(rules, 29)).toBe(5);
    expect(benchSize(rules, 30)).toBe(6);
    expect(benchSize(rules, 99)).toBe(6);
    expect(nextBenchSize(rules, 1)).toEqual({ arrows: 2, level: 5 });
    expect(nextBenchSize(rules, 30)).toBeUndefined();
  });

  it('takes a stave per 2 arrows, rounded up', () => {
    expect([1, 2, 3, 4, 5, 6, 18].map((arrows) => stavesFor(rules, arrows))).toEqual([
      1, 1, 2, 2, 3, 3, 9,
    ]);
  });

  it('limits the picker to the bench size, the staves and the feathers, times the streak', () => {
    const arrows = (level: number, streak: number, staves: number, feathers: number) =>
      pickerSizes(rules, level, streak, staves, feathers).map((batch) => batch.arrows);
    // Plenty of everything: 1 up to the bench's size, times the streak.
    expect(arrows(1, 1, 99, 999)).toEqual([1]);
    expect(arrows(10, 1, 99, 999)).toEqual([1, 2, 3]);
    expect(arrows(30, 3, 99, 999)).toEqual([3, 6, 9, 12, 15, 18]);
    // 2 staves make 4 arrows: at ×2 that's sizes 1 and 2; at ×3, 3 then the last 1.
    expect(arrows(30, 1, 2, 999)).toEqual([1, 2, 3, 4]);
    expect(arrows(30, 2, 2, 999)).toEqual([2, 4]);
    expect(arrows(30, 3, 2, 999)).toEqual([3, 4]);
    // 9 feathers fletch 3 carefully.
    expect(arrows(30, 1, 99, 9)).toEqual([1, 2, 3]);
    // Too few for even one careful arrow: as many bare arrows as the staves make.
    expect(arrowsAllowed(rules, 2, 2)).toEqual({ arrows: 4, bareOnly: true });
    expect(arrows(30, 1, 2, 0)).toEqual([1, 2, 3, 4]);
    // No staves, nothing.
    expect(arrows(30, 1, 0, 999)).toEqual([]);
  });
});

describe('a round at the bench', () => {
  it('fletches a whole batch with one set of beats: 6 at ×3 is 18', () => {
    const played = bench({ stave: 20, feather: 100 }, { size: 6, streak: 3, level: 30 });
    expect(played.round.batch).toEqual({ size: 6, streak: 3, arrows: 18 });
    // Nothing's used before it's made.
    expect(played.counts).toEqual({ stave: 20, feather: 100 });
    dip(played, tarSeconds.good);
    tapAll(played);
    const result = played.round.result;
    expect(result).toMatchObject({ way: 'careful', made: 'fletched', arrows: 18, stars: 3 });
    expect(played.counts.stave).toBe(20 - 9);
    expect(played.counts.feather).toBe(100 - 18 * rules.feathers.careful);
    expect(result?.xp).toBe(18 * rules.arrows.fletched.xp);
    expect(played.xp).toBe(18 * rules.arrows.fletched.xp);
    // The star bonus on top.
    const bonus = Math.round(18 * rules.starBonus.three);
    expect(result?.bonus).toBe(bonus);
    expect(played.counts.fletched_arrow).toBe(18 + bonus);
    // At the cap, the streak holds.
    expect(result?.streakAfter).toBe(3);
  });

  it('uses up the odd spare shaft: 3 arrows take 2 staves', () => {
    const played = bench({ stave: 2, feather: 30 }, { size: 3, level: 10 });
    expect(played.round.batch.arrows).toBe(3);
    dip(played, tarSeconds.good);
    tapAll(played);
    expect(played.counts.stave).toBe(0);
    expect(played.round.result?.staves).toBe(2);
  });

  it('keeps the size within what the picker allows', () => {
    // Level 1 is a batch of 1, whatever's asked.
    expect(bench({ stave: 9, feather: 99 }, { size: 6 }).round.batch.arrows).toBe(1);
    // 1 stave is 2 arrows, even at ×3.
    const short = bench({ stave: 1, feather: 99 }, { size: 6, streak: 3, level: 30 });
    expect(short.round.batch).toEqual({ size: 1, streak: 3, arrows: 2 });
  });

  it('raises the streak after a 3-star batch, and a near miss drops it one step', () => {
    const good = bench(undefined, { streak: 1 });
    dip(good, tarSeconds.good);
    tapAll(good);
    expect(good.round.result?.streakAfter).toBe(2);
    const near = bench(undefined, { streak: 3, level: 1 });
    dip(near, tarSeconds.good);
    tapAll(near, [0, feel.markWindowMs + 20, 0]);
    expect(near.round.result).toMatchObject({ made: 'duster', stars: 2, streakAfter: 2 });
  });

  it('puts a feather on its mark within the window, and off it outside, either side', () => {
    const window = feel.markWindowMs;
    const inside = bench();
    dip(inside, tarSeconds.good);
    tapAll(inside, window - 5);
    expect(inside.round.result?.made).toBe('fletched');
    expect(inside.round.arrow.taps[0]?.offMs).toBeCloseTo(window - 5, 0);
    const late = bench();
    dip(late, tarSeconds.good);
    tapAll(late, window + 10);
    expect(late.round.arrow.taps.every((tap) => !tap.onMark)).toBe(true);
    expect(late.round.result).toMatchObject({ made: 'duster', stars: 2 });
    const early = bench();
    dip(early, tarSeconds.good);
    tapAll(early, -(window + 10));
    expect(early.round.arrow.taps[0]?.offMs).toBeLessThan(-window);
    expect(early.round.result?.made).toBe('duster');
  });

  it('makes a lopsided duster from a feather between marks, which claims the nearest bare one', () => {
    const played = bench();
    dip(played, tarSeconds.good);
    // Halfway between the first mark and the next: 60° off whichever it takes.
    played.round.tick(markTime(0) + 60 / feel.turnSpeed);
    played.round.tap();
    const tap = played.round.arrow.taps[0];
    expect(Math.abs(tap?.offDegrees ?? 0)).toBeCloseTo(60, 0);
    expect(tap?.onMark).toBe(false);
  });

  it('globs too much tar into dusters, however well the feathers go on', () => {
    const played = bench({ stave: 5, feather: 30 }, { size: 2, level: 5 });
    dip(played, tarSeconds.thick);
    expect(played.round.arrow.tarState).toBe('thick');
    tapAll(played);
    expect(played.round.result).toMatchObject({ made: 'duster', arrows: 2 });
    expect(played.round.result?.stars).toBeLessThan(3);
    expect(played.counts.duster_arrow).toBe(2);
    expect(played.xp).toBe(2 * rules.arrows.duster.xp);
  });

  it('lets the feathers slide off too little tar: bare arrows, the feathers lost', () => {
    const played = bench({ stave: 5, feather: 30 }, { size: 2, level: 5 });
    dip(played, tarSeconds.thin);
    tapAll(played);
    const result = played.round.result;
    expect(result).toMatchObject({ made: 'bare', stars: 1 });
    expect(result?.lost).toBe(2 * rules.feathers.careful);
    expect(played.counts.feather).toBe(30 - 2 * rules.feathers.careful);
    expect(played.counts.bare_arrow).toBe(2);
    // Just under the band is a near miss.
    const near = bench();
    dip(near, tarSeconds.nearThin);
    tapAll(near);
    expect(near.round.result).toMatchObject({ made: 'bare', stars: 2 });
  });

  it('shoves the tarred shaft in the bucket: all dusters at once, twice the feathers, 1 star', () => {
    const played = bench({ stave: 5, feather: 30 }, { size: 2, streak: 2, level: 5 });
    // Not before it's tarred.
    expect(played.round.bucket()).toBe(false);
    dip(played, tarSeconds.good);
    expect(played.round.bucket()).toBe(true);
    const result = played.round.result;
    expect(result).toMatchObject({ way: 'bucket', made: 'duster', arrows: 4 });
    expect(result?.feathers).toBe(4 * rules.feathers.bucket);
    expect(rules.feathers.bucket).toBe(rules.feathers.careful * 2);
    expect(played.counts.feather).toBe(30 - 4 * rules.feathers.bucket);
    expect(played.counts.duster_arrow).toBe(4);
    // The shortcut never builds a streak.
    expect(result?.stars).toBe(rules.stars.bucket);
    expect(result?.streakAfter).toBe(1);
  });

  it('needs the feathers for the whole batch in the bucket', () => {
    const played = bench({ stave: 5, feather: 12 }, { size: 4, level: 15 });
    expect(played.round.batch.arrows).toBe(4);
    dip(played, tarSeconds.good);
    expect(played.round.canBucket).toBe(false);
    expect(played.round.bucket()).toBe(false);
    expect(played.round.canFletch).toBe(true);
  });

  it('makes bare arrows on purpose, before the tar or after, using no feathers', () => {
    const before = bench({ stave: 1, feather: 9 }, { size: 2, level: 5 });
    expect(before.round.bare()).toBe(true);
    expect(before.round.result).toMatchObject({ way: 'bare', arrows: 2, stars: rules.stars.bare });
    expect(before.counts).toMatchObject({ stave: 0, feather: 9, bare_arrow: 2 });
    const after = bench({ stave: 1, feather: 9 });
    dip(after, tarSeconds.good);
    expect(after.round.bare()).toBe(true);
    expect(after.counts.feather).toBe(9);
  });

  it('with too few feathers for one careful arrow, makes only bare ones, as many as the staves allow', () => {
    const played = bench({ stave: 2, feather: 2 }, { size: 4, level: 15 });
    expect(played.round.bareOnly).toBe(true);
    expect(played.round.batch.arrows).toBe(4);
    expect(played.round.dip()).toBe(false);
    expect(played.round.bare()).toBe(true);
    expect(played.counts).toMatchObject({ stave: 0, feather: 2, bare_arrow: 4 });
  });

  it('ends after the batch beat, once, with its result', () => {
    const played = bench();
    dip(played, tarSeconds.good);
    tapAll(played);
    expect(played.round.phase).toBe('make');
    played.round.tick(feel.finishSeconds);
    expect(played.round.phase).toBe('done');
    played.round.tick(1);
    const ends = played.events.filter((event) => event.type === 'end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ made: 'fletched', arrows: 1 });
  });

  it('uses nothing when left before the batch is made', async () => {
    const played = bench({ stave: 2, feather: 9 });
    dip(played, tarSeconds.good);
    played.round.exit();
    await played.log.logger.flush();
    expect(played.counts).toEqual({ stave: 2, feather: 9 });
    expect(played.log.sink.events.map((event) => event.type)).toContain('fletching.leave');
  });

  it('logs the batch, streak and feel at the start, and the beats and what came of them', async () => {
    const played = bench({ stave: 3, feather: 30 }, { size: 3, streak: 2, level: 10 });
    dip(played, tarSeconds.good);
    tapAll(played, 20);
    await played.log.logger.flush();
    const events = played.log.sink.events;
    const start = events.find((event) => event.type === 'fletching.roundStart');
    expect(start?.data).toMatchObject({
      size: 3,
      streak: 2,
      arrows: 6,
      staves: 3,
      feathers: 30,
      feel,
    });
    const end = events.find((event) => event.type === 'fletching.roundEnd');
    expect(end?.data).toMatchObject({
      way: 'careful',
      made: 'fletched',
      tarState: 'good',
      arrows: 6,
      staves: 3,
      feathers: 18,
      stars: 3,
      streak: 2,
      streakAfter: 3,
    });
    expect(typeof end?.data?.tar).toBe('number');
    expect(end?.data?.taps).toEqual([
      { mark: 0, ms: 20, onMark: true },
      { mark: 2, ms: 20, onMark: true },
      { mark: 1, ms: 20, onMark: true },
    ]);
  });

  it('plays the same for the same inputs at the same times', () => {
    const run = () => {
      const played = bench({ stave: 9, feather: 99 }, { size: 3, streak: 2, level: 10 });
      dip(played, 0.93);
      played.round.tick(0.41);
      played.round.tap();
      played.round.tick(0.77);
      played.round.tap();
      played.round.tick(0.5);
      played.round.tap();
      return { arrow: played.round.arrow, result: played.round.result, counts: played.counts };
    };
    expect(run()).toEqual(run());
  });
});

describe('fletching workers', () => {
  it('make fletched arrows from staves and feathers, about a tenth of playing', () => {
    const rate = workerRate(data, 'fletchers_bench');
    expect(rate?.item).toBe('fletched_arrow');
    // A level-1 round, one arrow with no streak, takes about 7 s: dip, three marks, the card.
    const roundSeconds =
      tarSeconds.good + feel.leadSeconds + 240 / feel.turnSpeed + feel.finishSeconds + 3;
    const played = 60 / roundSeconds;
    expect((rate?.count ?? 0) / played).toBeGreaterThan(0.05);
    expect((rate?.count ?? 0) / played).toBeLessThan(0.15);
    const game = new Game(data, newGameState(data, 0), testLogger().logger);
    game.addItems('stave', 2);
    game.addItems('feather', 12);
    const work: WorkState = {
      crew: { fletchers_bench: 1 },
      carry: {},
      minimums: {},
      piles: {},
      xp: {},
    };
    const result = doWork(data, game.inventory, work, 4);
    const fletcher = result.stations.find((station) => station.station === 'fletchers_bench');
    // A stave per 2 arrows, as at the bench.
    expect(fletcher?.made).toEqual([{ item: 'fletched_arrow', count: 4 }]);
    expect(fletcher?.xp).toBe(4 * rules.arrows.fletched.xp);
    expect(game.inventory.count('stave')).toBe(0);
    expect(game.inventory.count('feather')).toBe(0);
  });
});

describe('fletching data', () => {
  const invalid = (edit: (raw: ReturnType<typeof editableRawData>) => void, message: string) => {
    const raw = editableRawData();
    edit(raw);
    expect(() => parseGameData(raw)).toThrow(GameDataError);
    expect(() => parseGameData(raw)).toThrow(message);
  };

  it('has no arrow shaft item: an odd spare shaft is used up', () => {
    expect(data.items.map((item) => item.id)).not.toContain('arrow_shaft');
  });

  it('makes only arrows the bird hunt can shoot, the duster among them', () => {
    const shootable = data.archery.arrows.map((arrow) => arrow.item);
    for (const kind of Object.values(rules.arrows)) expect(shootable).toContain(kind.item);
    expect(rules.arrows.duster.item).toBe('duster_arrow');
    invalid((raw) => {
      raw.archery.arrows = raw.archery.arrows.filter((arrow) => arrow.item !== 'duster_arrow');
    }, `"duster_arrow" isn't an arrow kind of the bird hunt`);
    invalid((raw) => {
      raw.fletching.arrows.duster.item = 'goose_arrow';
    }, 'Unknown item "goose_arrow"');
    invalid((raw) => {
      raw.fletching.arrows.duster.item = 'fletched_arrow';
    }, 'Twice');
  });

  it('fails loudly on a workers recipe that disagrees with the bench', () => {
    invalid((raw) => {
      raw.fletching.feathers.careful = 4;
    }, '"fletch_arrows" must take 1 stave and 8 feathers for 2 fletched arrows and their XP');
    invalid((raw) => {
      raw.fletching.arrows.fletched.xp = 12;
    }, '"fletch_arrows" must take');
    invalid((raw) => {
      raw.fletching.recipe = 'fletch_everything';
    }, 'Unknown recipe "fletch_everything"');
  });

  it('fails loudly on batch sizes out of order, a near miss inside the window, or 3 for a shortcut', () => {
    invalid((raw) => {
      raw.fletching.batch.sizes[0] = { arrows: 1, level: 2 };
    }, 'The first batch size must be open from level 1');
    invalid((raw) => {
      raw.fletching.batch.sizes[2] = { arrows: 2, level: 10 };
    }, 'Sizes must grow, in level order');
    invalid((raw) => {
      raw.fletching.stars.nearTapMs = raw.fletching.feel.markWindowMs - 1;
    }, 'A near miss must reach past the mark window');
    invalid((raw) => {
      raw.fletching.stars.bucket = 3;
    }, 'Game data is invalid');
    invalid((raw) => {
      raw.fletching.feel.tarLow = 0.9;
    }, 'The green band must start under where it ends');
    invalid((raw) => {
      raw.fletching.stave = 'twig';
    }, 'Unknown item "twig"');
  });

  it('takes a retuned arrows-per-stave by data alone', () => {
    const tuned = dataWith((raw) => {
      raw.fletching.arrowsPerStave = 3;
      const recipe = raw.recipes.find((entry) => entry.id === 'fletch_arrows');
      if (!recipe) throw new Error('No recipe');
      recipe.inputs = [
        { item: 'stave', count: 1 },
        { item: 'feather', count: 9 },
      ];
      recipe.outputs = [{ item: 'fletched_arrow', count: 3 }];
      recipe.xp = 30;
    });
    const played = bench({ stave: 1, feather: 30 }, { size: 3, level: 10 }, tuned);
    expect(played.round.batch.arrows).toBe(3);
    played.round.bare();
    expect(played.counts.stave).toBe(0);
  });
});
