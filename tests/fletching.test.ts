import { describe, expect, it } from 'vitest';
import { Game, doWork, newGameState, workerRate, type Stack, type WorkState } from '../src/core';
import { GameDataError, parseGameData, type FletchingFeel, type GameData } from '../src/data';
import {
  FletchingRound,
  carefulResult,
  markAngle,
  starsFor,
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
};

interface Bench {
  round: FletchingRound;
  counts: Record<string, number>;
  xp: number;
  banked: Stack[];
  events: FletchingEvent[];
  log: ReturnType<typeof testLogger>;
}

/** A round at the bench with this much in the warchest. */
function bench(
  stock: Record<string, number> = { stave: 5, feather: 30 },
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
      level: 1,
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

/** Taps every mark as it comes to the top, each `offMs` late. */
function tapAll(played: Bench, offMs = 0) {
  const lifted = played.round.now;
  const times = Array.from({ length: rules.marks }, (_, mark) => markTime(mark)).sort(
    (a, b) => a - b,
  );
  for (const time of times) {
    played.round.tick(lifted + time + offMs / 1000 - played.round.now);
    expect(played.round.tap()).toBe(true);
  }
}

/** Waits out the finish beat, so the next shaft's on the bench. */
function next(played: Bench) {
  played.round.tick(feel.finishSeconds);
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

  it('makes a careful arrow fletched only with good tar and every feather on its mark', () => {
    const on = [{ onMark: true }, { onMark: true }, { onMark: true }];
    const off = [{ onMark: true }, { onMark: false }, { onMark: true }];
    expect(carefulResult('good', on)).toBe('fletched');
    expect(carefulResult('good', off)).toBe('duster');
    expect(carefulResult('thick', on)).toBe('duster');
    expect(carefulResult('thin', on)).toBe('bare');
  });

  it('gives stars from fletched arrows made, by the data', () => {
    expect(starsFor(rules.stars, 0)).toBe(0);
    expect(starsFor(rules.stars, rules.stars.one)).toBe(1);
    expect(starsFor(rules.stars, rules.stars.two)).toBe(2);
    expect(starsFor(rules.stars, rules.stars.three - 1)).toBe(2);
    expect(starsFor(rules.stars, rules.stars.three)).toBe(3);
  });
});

describe('a round at the bench', () => {
  it('splits a stave into its shafts as one is needed, the spare waiting in the warchest', () => {
    const played = bench({ stave: 2, feather: 0 });
    expect(played.counts.stave).toBe(1);
    expect(played.counts.arrow_shaft).toBe(rules.shaftsPerStave - 1);
    expect(played.round.arrow?.step).toBe('shaft');
    expect(played.round.shaftsLeft).toBe(rules.shaftsPerStave * 2 - 1);
  });

  it('fletches an arrow: good tar, a feather on each mark as it comes to the top', () => {
    const played = bench();
    dip(played, tarSeconds.good);
    expect(played.round.arrow?.tarState).toBe('good');
    tapAll(played);
    const arrow = played.round.arrows[0];
    expect(arrow?.made).toBe('fletched');
    expect(arrow?.way).toBe('careful');
    expect(arrow?.taps.map((tap) => tap.mark).sort()).toEqual([0, 1, 2]);
    expect(arrow?.taps.every((tap) => Math.abs(tap.offMs) < 1)).toBe(true);
    expect(played.counts.fletched_arrow).toBe(1);
    expect(played.counts.feather).toBe(30 - rules.feathers.careful);
    expect(played.xp).toBe(rules.arrows.fletched.xp);
    // The next shaft comes once the finish beat's over.
    expect(played.round.arrow?.step).toBe('made');
    next(played);
    expect(played.round.arrow?.step).toBe('shaft');
    expect(played.round.arrow?.index).toBe(1);
  });

  it('puts a feather on its mark within the window, and off it outside, either side', () => {
    const window = feel.markWindowMs;
    const inside = bench();
    dip(inside, tarSeconds.good);
    tapAll(inside, window - 5);
    expect(inside.round.arrows[0]?.made).toBe('fletched');
    expect(inside.round.arrows[0]?.taps[0]?.offMs).toBeCloseTo(window - 5, 0);
    const late = bench();
    dip(late, tarSeconds.good);
    tapAll(late, window + 10);
    expect(late.round.arrows[0]?.taps.every((tap) => !tap.onMark)).toBe(true);
    expect(late.round.arrows[0]?.made).toBe('duster');
    const early = bench();
    dip(early, tarSeconds.good);
    tapAll(early, -(window + 10));
    expect(early.round.arrows[0]?.taps[0]?.offMs).toBeLessThan(-window);
    expect(early.round.arrows[0]?.made).toBe('duster');
  });

  it('makes a lopsided duster from a feather between marks, which claims the nearest bare one', () => {
    const played = bench();
    dip(played, tarSeconds.good);
    // Halfway between the first mark and the next: 60° off whichever it takes.
    played.round.tick(markTime(0) + 60 / feel.turnSpeed);
    played.round.tap();
    const tap = played.round.arrow?.taps[0];
    expect(Math.abs(tap?.offDegrees ?? 0)).toBeCloseTo(60, 0);
    expect(tap?.onMark).toBe(false);
  });

  it('globs too much tar into a duster, however well the feathers go on', () => {
    const played = bench();
    dip(played, tarSeconds.thick);
    expect(played.round.arrow?.tarState).toBe('thick');
    tapAll(played);
    expect(played.round.arrows[0]?.made).toBe('duster');
    expect(played.counts.duster_arrow).toBe(1);
    expect(played.xp).toBe(rules.arrows.duster.xp);
  });

  it('lets the feathers slide off too little tar: a bare arrow, the feathers lost', () => {
    const played = bench();
    dip(played, tarSeconds.thin);
    tapAll(played);
    const arrow = played.round.arrows[0];
    expect(arrow?.made).toBe('bare');
    expect(arrow?.lost).toBe(rules.feathers.careful);
    expect(played.counts.feather).toBe(30 - rules.feathers.careful);
    expect(played.counts.bare_arrow).toBe(1);
  });

  it('shoves a tarred shaft in the bucket: a duster at once, for twice the feathers', () => {
    const played = bench();
    // Not before it's tarred.
    expect(played.round.bucket()).toBe(false);
    dip(played, tarSeconds.thin);
    expect(played.round.bucket()).toBe(true);
    const arrow = played.round.arrows[0];
    expect(arrow?.way).toBe('bucket');
    expect(arrow?.made).toBe('duster');
    expect(arrow?.feathers).toBe(rules.feathers.bucket);
    expect(rules.feathers.bucket).toBe(rules.feathers.careful * 2);
    expect(played.counts.feather).toBe(30 - rules.feathers.bucket);
    expect(played.counts.duster_arrow).toBe(1);
  });

  it('makes a bare arrow on purpose, before the tar or after, using no feathers', () => {
    const played = bench({ stave: 1, feather: 0 });
    expect(played.round.bare()).toBe(true);
    next(played);
    dip(played, tarSeconds.good);
    // No feathers: neither careful nor the bucket, but bare always works.
    expect(played.round.tap()).toBe(false);
    expect(played.round.bucket()).toBe(false);
    expect(played.round.bare()).toBe(true);
    expect(played.counts.bare_arrow).toBe(2);
    expect(played.counts.feather).toBe(0);
  });

  it('ends when the shafts run out, with stars and a bonus from the fletched arrows', () => {
    const shafts = rules.stars.three;
    const played = bench({ arrow_shaft: shafts, feather: 99 });
    for (let index = 0; index < shafts; index++) {
      dip(played, tarSeconds.good);
      tapAll(played);
      next(played);
    }
    expect(played.round.phase).toBe('done');
    const result = played.round.result;
    expect(result?.reason).toBe('out');
    expect(result?.made.fletched).toBe(shafts);
    expect(result?.stars).toBe(3);
    const bonus = Math.round(shafts * rules.starBonus.three);
    expect(result?.bonus).toBe(bonus);
    expect(played.counts.fletched_arrow).toBe(shafts + bonus);
    expect(result?.xp).toBe(shafts * rules.arrows.fletched.xp);
  });

  it('ends on time, putting the unfinished shaft back', () => {
    const played = bench({ arrow_shaft: 3, feather: 9 });
    dip(played, tarSeconds.good);
    played.round.tick(rules.round.seconds);
    expect(played.round.phase).toBe('done');
    expect(played.round.result?.reason).toBe('time');
    expect(played.round.result?.arrows).toBe(0);
    expect(played.counts.arrow_shaft).toBe(3);
    expect(played.counts.feather).toBe(9);
  });

  it('puts the shaft in hand back on leaving mid-round', async () => {
    const played = bench({ arrow_shaft: 2 });
    played.round.exit();
    await played.log.logger.flush();
    expect(played.counts.arrow_shaft).toBe(2);
    expect(played.log.sink.events.map((event) => event.type)).toContain('fletching.leave');
  });

  it('logs the feel at the start, every arrow, and the end', async () => {
    const played = bench({ arrow_shaft: 1, feather: 9 });
    dip(played, tarSeconds.good);
    tapAll(played, 20);
    next(played);
    await played.log.logger.flush();
    const events = played.log.sink.events;
    const start = events.find((event) => event.type === 'fletching.roundStart');
    expect(start?.data).toMatchObject({ shafts: 1, feathers: 9, feel });
    const arrow = events.find((event) => event.type === 'fletching.arrow');
    expect(arrow?.data).toMatchObject({ way: 'careful', made: 'fletched', tarState: 'good' });
    expect(arrow?.data?.taps).toEqual([
      { mark: 0, ms: 20, onMark: true },
      { mark: 2, ms: 20, onMark: true },
      { mark: 1, ms: 20, onMark: true },
    ]);
    const end = events.find((event) => event.type === 'fletching.roundEnd');
    expect(end?.data).toMatchObject({ reason: 'out', arrows: 1, careful: 1, bucket: 0 });
  });

  it('plays the same for the same inputs at the same times', () => {
    const run = () => {
      const played = bench();
      dip(played, 0.93);
      played.round.tick(0.41);
      played.round.tap();
      played.round.tick(0.77);
      played.round.tap();
      played.round.tick(0.5);
      played.round.tap();
      return played.round.arrows[0];
    };
    expect(run()).toEqual(run());
  });
});

describe('fletching workers', () => {
  it('make fletched arrows from staves and feathers, about a tenth of playing', () => {
    const rate = workerRate(data, 'fletchers_bench');
    expect(rate?.item).toBe('fletched_arrow');
    // Playing makes about 9 careful arrows a 40 s round: a worker makes about a tenth of that.
    const played = (9 * 60) / rules.round.seconds;
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

  it('fails loudly on stars out of order, a green band upside down, or a missing item', () => {
    invalid((raw) => {
      raw.fletching.stars.two = 9;
    }, 'More stars must not need less');
    invalid((raw) => {
      raw.fletching.feel.tarLow = 0.9;
    }, 'The green band must start under where it ends');
    invalid((raw) => {
      raw.fletching.shaft = 'twig';
    }, 'Unknown item "twig"');
  });

  it('takes a retuned shaft count by data alone', () => {
    const tuned = dataWith((raw) => {
      raw.fletching.shaftsPerStave = 3;
      const recipe = raw.recipes.find((entry) => entry.id === 'fletch_arrows');
      if (!recipe) throw new Error('No recipe');
      recipe.inputs = [
        { item: 'stave', count: 1 },
        { item: 'feather', count: 9 },
      ];
      recipe.outputs = [{ item: 'fletched_arrow', count: 3 }];
      recipe.xp = 30;
    });
    const played = bench({ stave: 1 }, tuned);
    expect(played.counts.arrow_shaft).toBe(2);
  });
});
