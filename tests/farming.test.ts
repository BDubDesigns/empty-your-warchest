import { describe, expect, it } from 'vitest';
import {
  Game,
  ManualClock,
  MemoryStore,
  SaveStore,
  WorkClock,
  growth,
  harvestOf,
  isRipe,
  multiplierFor,
  newGameState,
  plotCount,
  seedBonus,
  stageOf,
  wateringStars,
  type GameState,
  type LogEvent,
  type Watering,
} from '../src/core';
import { parseGameData, type Farming } from '../src/data';
import { canCapacity, soilState, WateringRound } from '../src/stations/farming';
import { plotLayout, plotsCrossed } from '../src/stations/farming/logic/layout';
import { data, editableRawData, testLogger } from './helpers';

const MINUTE = 60_000;
const rules: Farming = data.farming;
const woad = rules.crops.find((crop) => crop.id === 'woad');
const sunflower = rules.crops.find((crop) => crop.id === 'sunflower');
if (!woad || !sunflower) throw new Error('No woad or sunflower in the data');

/** A new game with `items` in the warchest and the farm at `level`. */
function newGame(items: Record<string, number> = {}, level = 1, now = 0) {
  const state: GameState = newGameState(data, now);
  state.inventory = Object.entries(items).map(([item, count]) => ({ item, count }));
  const { logger, sink } = recorder();
  const game = new Game(data, state, logger);
  if (level > 1) game.setLevel('farming', level);
  return { game, logger, sink };
}

/** A logger, and every event it logs as it's logged (the sink stores them in the background). */
function recorder() {
  const { logger } = testLogger();
  const sink: LogEvent[] = [];
  logger.onLog((event) => sink.push(event));
  return { logger, sink };
}

const events = (sink: readonly LogEvent[], type: string) =>
  sink.filter((event) => event.type === type);

/** A watering of `plots` for `game`, with the round's records going into the game. */
function watering(game: Game, plots: { plot: number; crop: string }[], seed = 'test') {
  const { logger, sink } = recorder();
  const round = new WateringRound(rules, rules.feel, plots, canCapacity(rules, game.plots), seed, {
    logger,
    level: 1,
    record: (plot, water) => {
      game.water(plot, water);
    },
    bank: (seeds) => {
      for (const stack of seeds) game.addItems(stack.item, stack.count);
    },
  });
  return { round, sink };
}

/** Pours on `plot` until its gauge reaches `level` (in small steps), then lifts the can. */
function pourTo(round: WateringRound, plot: number, level: number) {
  const gauge = round.gauge(plot);
  if (!gauge) throw new Error(`No gauge on plot ${String(plot)}`);
  round.aim(plot, true);
  for (let step = 0; step < 2000 && gauge.moisture < level && round.water > 0; step++) {
    round.tick(1 / 120);
  }
  round.aim(plot, false);
  round.tick(1 / 120);
}

describe('plots and planting', () => {
  it('opens 4 plots at level 1, more with Farming level', () => {
    expect(plotCount(rules, 1)).toBe(4);
    expect(plotCount(rules, 9)).toBe(4);
    expect(plotCount(rules, 10)).toBe(6);
    expect(plotCount(rules, 99)).toBe(8);
    const { game } = newGame({}, 10);
    expect(game.plots).toBe(6);
  });

  it('gives a starter pack of seeds once, when a crop opens', () => {
    const { game, sink } = newGame();
    expect(game.starterSeeds()).toEqual([
      { item: 'woad_seed', count: woad.starter },
      { item: 'sunflower_seed', count: sunflower.starter },
    ]);
    expect(game.inventory.count('woad_seed')).toBe(woad.starter);
    expect(game.starterSeeds()).toEqual([]);
    expect(events(sink, 'farming.starter')).toHaveLength(2);
  });

  it('plants any crop in any empty open plot, a seed each, and logs the growth starting', () => {
    const { game, sink } = newGame({ woad_seed: 2, sunflower_seed: 1 });
    expect(game.plant(0, 'woad', 0)).toBe(true);
    expect(game.plant(3, 'sunflower', 0)).toBe(true);
    expect(game.inventory.count('woad_seed')).toBe(1);
    expect(game.inventory.count('sunflower_seed')).toBe(0);
    // Taken, out of seeds, or not open yet.
    expect(game.plant(0, 'woad', 0)).toBe(false);
    expect(game.plant(1, 'sunflower', 0)).toBe(false);
    expect(game.plant(4, 'woad', 0)).toBe(false);
    expect(game.farm.plots[0]?.planting).toEqual({ crop: 'woad', plantedAt: 0 });
    expect(game.farm.plots[3]?.planting?.crop).toBe('sunflower');
    expect(events(sink, 'farming.plant').map((event) => event.data)).toEqual([
      { plot: 0, crop: 'woad', at: 0, growMinutes: woad.growMinutes, seedsLeft: 1 },
      { plot: 3, crop: 'sunflower', at: 0, growMinutes: sunflower.growMinutes, seedsLeft: 0 },
    ]);
  });

  it('finds the plots a swipe crosses, in order, even a fast one', () => {
    const { spots } = plotLayout(rules.looks, 4);
    const [first, second, , fourth] = spots;
    if (!first || !second || !fourth) throw new Error('No plots');
    // Across the top row in one move: both plots, left to right.
    expect(plotsCrossed(spots, rules.looks.plotSize, first, second)).toEqual([0, 1]);
    // Corner to corner.
    expect(plotsCrossed(spots, rules.looks.plotSize, first, fourth)).toEqual([0, 3]);
    expect(plotsCrossed(spots, rules.looks.plotSize, { x: 50, z: 50 }, { x: 51, z: 50 })).toEqual(
      [],
    );
  });
});

describe('watering', () => {
  it('gives each plot a gauge with its crop band, starting dry', () => {
    const { game } = newGame({ woad_seed: 1, sunflower_seed: 1 });
    game.plant(0, 'woad', 0);
    game.plant(1, 'sunflower', 0);
    const { round } = watering(game, [
      { plot: 0, crop: 'woad' },
      { plot: 1, crop: 'sunflower' },
    ]);
    const [thirsty, sunny] = round.gauges;
    expect(thirsty?.band).toEqual(woad.band);
    expect(sunny?.band).toEqual(sunflower.band);
    // Woad is thirstier than sunflowers.
    expect(woad.band.low).toBeGreaterThan(sunflower.band.high);
    for (const gauge of round.gauges) {
      expect(gauge.moisture).toBeGreaterThanOrEqual(rules.watering.start.min);
      expect(gauge.moisture).toBeLessThanOrEqual(rules.watering.start.max);
      expect(gauge.state).toBe('dry');
    }
  });

  it('pours only while held over a plot in the watering, at the pour rate', () => {
    const { game } = newGame({ woad_seed: 1 });
    game.plant(0, 'woad', 0);
    const { round } = watering(game, [{ plot: 0, crop: 'woad' }]);
    const gauge = round.gauge(0);
    if (!gauge) throw new Error('No gauge');
    const start = gauge.moisture;
    // Held over a plot not being watered, or over the plot but not held: nothing.
    round.aim(2, true);
    round.tick(1);
    round.aim(0, false);
    round.tick(1);
    expect(gauge.moisture).toBe(start);
    round.aim(0, true);
    round.tick(0.5);
    expect(gauge.moisture).toBeCloseTo(start + rules.feel.pourRate * 0.5);
    expect(round.water).toBeCloseTo(round.capacity - rules.feel.pourRate * 0.5);
  });

  it('reads each gauge against its band: dry, in it, or mud past it', () => {
    expect(soilState(0.2, woad.band)).toBe('dry');
    expect(soilState(woad.band.low, woad.band)).toBe('good');
    expect(soilState(woad.band.high, woad.band)).toBe('good');
    expect(soilState(woad.band.high + 0.01, woad.band)).toBe('mud');
  });

  it('turns a plot to mud when it is poured past its band, a miss that stays', () => {
    const { game } = newGame({ sunflower_seed: 1 });
    game.plant(0, 'sunflower', 0);
    const { round, sink } = watering(game, [{ plot: 0, crop: 'sunflower' }]);
    pourTo(round, 0, sunflower.band.high + 0.1);
    expect(round.gauge(0)?.state).toBe('mud');
    round.finish();
    expect(round.result).toMatchObject({ stars: 0, inBand: 0, mud: 1 });
    expect(game.farm.plots[0]?.planting?.water).toMatchObject({ inBand: false, by: 'player' });
    const [pour] = events(sink, 'farming.pour');
    expect(pour?.data).toMatchObject({ plot: 0, crop: 'sunflower', state: 'mud', hit: false });
  });

  it('holds a set amount of water: four plots of woad take most of the can', () => {
    const { game } = newGame({}, 1);
    expect(canCapacity(rules, game.plots)).toBeCloseTo(rules.watering.can.perPlot * 4);
    const needed = 4 * (woad.band.low - rules.watering.start.min);
    const topped = 4 * (woad.band.high - rules.watering.start.max);
    expect(canCapacity(rules, 4)).toBeGreaterThan(needed);
    expect(canCapacity(rules, 4)).toBeLessThan(4 * woad.band.high);
    expect(topped).toBeGreaterThan(0);
  });

  it('runs dry: the can stops pouring and the watering ends soon after', () => {
    const { game } = newGame({ woad_seed: 4 });
    for (let plot = 0; plot < 4; plot++) game.plant(plot, 'woad', 0);
    const plots = [0, 1, 2, 3].map((plot) => ({ plot, crop: 'woad' }));
    const { round } = watering(game, plots);
    // Soak the first plots to the brim: the last one gets what's left, if any.
    for (const plot of [0, 1, 2, 3]) pourTo(round, plot, 1);
    expect(round.water).toBe(0);
    for (let step = 0; step < 200 && round.phase === 'water'; step++) round.tick(1 / 60);
    expect(round.result?.reason).toBe('dry');
    const poured = round.gauges.reduce((sum, gauge) => sum + gauge.poured, 0);
    expect(poured).toBeCloseTo(round.capacity);
  });

  it('gives stars from the share of plots in their band', () => {
    const { stars } = rules.watering;
    expect(wateringStars(stars, 4, 4)).toBe(3);
    expect(wateringStars(stars, 3, 4)).toBe(2);
    expect(wateringStars(stars, 2, 4)).toBe(2);
    expect(wateringStars(stars, 1, 4)).toBe(1);
    expect(wateringStars(stars, 0, 4)).toBe(0);
    expect(wateringStars(stars, 1, 1)).toBe(3);
  });

  it('3 stars: every plot in its band, the bigger multiplier and extra seeds', () => {
    const { game, sink } = newGame({ woad_seed: 2, sunflower_seed: 2 });
    for (const [plot, crop] of [
      [0, 'woad'],
      [1, 'woad'],
      [2, 'sunflower'],
      [3, 'sunflower'],
    ] as const) {
      game.plant(plot, crop, 0);
    }
    const plots = game.farm.plots.map((entry, plot) => ({
      plot,
      crop: entry.planting?.crop ?? '',
    }));
    const { round, sink: roundSink } = watering(game, plots);
    for (const { plot, crop } of plots) {
      const band = crop === 'woad' ? woad.band : sunflower.band;
      pourTo(round, plot, (band.low + band.high) / 2);
    }
    round.finish();
    expect(round.result).toMatchObject({ stars: 3, inBand: 4, plots: 4, reason: 'done' });
    // Half a seed back a plot, rounded down: one of each.
    expect(round.result?.bonus).toEqual([
      { item: 'woad_seed', count: 1 },
      { item: 'sunflower_seed', count: 1 },
    ]);
    expect(game.inventory.count('woad_seed')).toBe(1);
    for (const plot of [0, 1, 2, 3]) {
      expect(game.farm.plots[plot]?.planting?.water).toMatchObject({ stars: 3, inBand: true });
    }
    expect(events(roundSink, 'farming.pour')).toHaveLength(4);
    expect(events(roundSink, 'farming.waterEnd')[0]?.data).toMatchObject({ stars: 3, inBand: 4 });
    expect(events(sink, 'farming.plant')).toHaveLength(4);
  });

  it('never makes seeds from nothing: one plot at 3 stars gives none back', () => {
    expect(seedBonus(rules, 3, ['woad'])).toEqual([]);
    expect(seedBonus(rules, 2, ['woad', 'woad', 'woad', 'woad'])).toEqual([]);
    expect(seedBonus(rules, 3, ['woad', 'woad', 'woad', 'woad'])).toEqual([
      { item: 'woad_seed', count: 2 },
    ]);
  });

  it('is once per planting', () => {
    const { game } = newGame({ woad_seed: 1 });
    game.plant(0, 'woad', 0);
    const water: Watering = { stars: 2, inBand: true, moisture: 0.7, by: 'player' };
    expect(game.water(0, water)).toBe(true);
    expect(game.water(0, { ...water, stars: 3 })).toBe(false);
    expect(game.farm.plots[0]?.planting?.water?.stars).toBe(2);
    // Nothing to water in an empty plot.
    expect(game.water(1, water)).toBe(false);
  });

  it('plays out the same for the same pours at the same times (seeded)', () => {
    const play = () => {
      const { game } = newGame({ woad_seed: 2 });
      game.plant(0, 'woad', 0);
      game.plant(1, 'woad', 0);
      const { round, sink } = watering(game, [
        { plot: 0, crop: 'woad' },
        { plot: 1, crop: 'woad' },
      ]);
      const script: [number | undefined, boolean, number][] = [
        [0, true, 1.4],
        [undefined, false, 0.3],
        [1, true, 2.1],
        [1, false, 0.1],
      ];
      for (const [plot, held, seconds] of script) {
        round.aim(plot, held);
        for (let t = 0; t < seconds; t += 1 / 60) round.tick(1 / 60);
      }
      round.finish();
      return { result: round.result, gauges: round.gauges, logs: sink.map((event) => event.data) };
    };
    expect(play()).toEqual(play());
    // A different seed starts the soil differently.
    const { game } = newGame({ woad_seed: 1 });
    game.plant(0, 'woad', 0);
    const a = watering(game, [{ plot: 0, crop: 'woad' }], 'a').round.gauges[0]?.start;
    const b = watering(game, [{ plot: 0, crop: 'woad' }], 'b').round.gauges[0]?.start;
    expect(a).not.toBe(b);
  });
});

describe('growth and harvest', () => {
  it('multiplies the yield by the stars only for plots in their band; never below the base', () => {
    const { watering } = rules;
    expect(multiplierFor(watering)).toBe(1);
    expect(multiplierFor(watering, { stars: 3, inBand: false, moisture: 0.95, by: 'player' })).toBe(
      1,
    );
    expect(multiplierFor(watering, { stars: 0, inBand: true, moisture: 0.7, by: 'player' })).toBe(
      1,
    );
    expect(multiplierFor(watering, { stars: 1, inBand: true, moisture: 0.7, by: 'worker' })).toBe(
      watering.multiplier.one,
    );
    expect(multiplierFor(watering, { stars: 3, inBand: true, moisture: 0.7, by: 'player' })).toBe(
      watering.multiplier.three,
    );
    const planting = { crop: 'woad', plantedAt: 0 };
    expect(harvestOf(rules, 0, planting).count).toBe(woad.yield);
    const watered = {
      ...planting,
      water: { stars: 3, inBand: true, moisture: 0.7, by: 'player' as const },
    };
    expect(harvestOf(rules, 0, watered)).toMatchObject({
      item: 'woad',
      count: woad.yield * watering.multiplier.three,
      xp: woad.yield * watering.multiplier.three * woad.xp,
    });
  });

  it('grows on the farm clock through its stages, and a ripe crop waits (nothing dies)', () => {
    const planting = { crop: 'woad', plantedAt: 5 };
    expect(growth(rules, planting, 5)).toBe(0);
    expect(growth(rules, planting, 5 + woad.growMinutes / 2)).toBeCloseTo(0.5);
    expect(isRipe(rules, planting, 5 + woad.growMinutes - 0.01)).toBe(false);
    expect(isRipe(rules, planting, 5 + woad.growMinutes)).toBe(true);
    expect(growth(rules, planting, 5 + woad.growMinutes * 100)).toBe(1);
    const { stages } = rules.looks;
    expect(stageOf(stages, 0)).toBe('seed');
    expect(stageOf(stages, stages.sprout)).toBe('sprout');
    expect(stageOf(stages, stages.young)).toBe('young');
    expect(stageOf(stages, stages.grown)).toBe('grown');
    expect(stageOf(stages, 1)).toBe('ripe');
    // Each crop takes 5 to 15 minutes.
    for (const crop of rules.crops) {
      expect(crop.growMinutes).toBeGreaterThanOrEqual(5);
      expect(crop.growMinutes).toBeLessThanOrEqual(15);
    }
  });

  it('grows on real time, while away too, up to the shared away cap', () => {
    const clock = new ManualClock(0);
    const { game, sink } = newGame({ woad_seed: 1, sunflower_seed: 1 });
    const work = new WorkClock(game, clock.now());
    game.plant(0, 'sunflower', 0);
    game.plant(1, 'woad', 0);
    // Four minutes playing: counted live (owed), not banked yet.
    clock.advance(4 * MINUTE);
    const now = () => game.farm.minutes + work.owedAt(clock.now());
    expect(now()).toBeCloseTo(4);
    // Away for two hours: only the cap counts.
    work.hidden(clock.now());
    clock.advance(120 * MINUTE);
    work.visible(clock.now());
    expect(now()).toBeCloseTo(4 + data.workers.awayCapMinutes);
    work.bank(clock.now());
    expect(game.farm.minutes).toBeCloseTo(4 + data.workers.awayCapMinutes);
    expect(work.owedAt(clock.now())).toBe(0);
    const ripe = events(sink, 'farming.ripe').map((event) => event.data?.plot);
    expect(ripe.sort()).toEqual([0, 1]);
  });

  it('harvests a ripe plot into the warchest with its XP, and logs it; not an unripe one', () => {
    const { game, sink } = newGame({ woad_seed: 1, sunflower_seed: 1 });
    game.plant(0, 'woad', 0);
    game.plant(1, 'sunflower', 0);
    game.water(0, { stars: 2, inBand: true, moisture: 0.7, by: 'player' });
    const at = sunflower.growMinutes;
    expect(game.harvest(0, at)).toBeUndefined();
    const harvest = game.harvest(1, at);
    expect(harvest).toMatchObject({ item: 'sunflower_petals', count: sunflower.yield });
    expect(game.inventory.count('sunflower_petals')).toBe(sunflower.yield);
    expect(game.xp('farming')).toBe(sunflower.yield * sunflower.xp);
    expect(game.farm.plots[1]).toEqual({ last: 'sunflower' });
    const woadHarvest = game.harvest(0, woad.growMinutes);
    const count = Math.round(woad.yield * rules.watering.multiplier.two);
    expect(woadHarvest?.count).toBe(count);
    expect(game.inventory.count('woad')).toBe(count);
    // Harvests give crops, not seeds.
    expect(game.inventory.count('woad_seed')).toBe(0);
    expect(events(sink, 'farming.harvest').map((event) => event.data?.crop)).toEqual([
      'sunflower',
      'woad',
    ]);
  });
});

describe('farm workers', () => {
  it('tend a plot every 15 minutes: harvest onto the pile, replant what was there at 1 star', () => {
    const { game, sink } = newGame({ woad_seed: 3 });
    game.setLevel('command', 5);
    game.assignWorker('farm', 1);
    expect(game.crew('farm')).toBe(1);
    game.plant(0, 'woad', 0);
    game.water(0, { stars: 3, inBand: true, moisture: 0.7, by: 'player' });
    // 15 minutes: one tend, of the ripe plot (its own 3-star watering).
    game.work(15);
    expect(game.pile('farm')).toEqual([
      { item: 'woad', count: woad.yield * rules.watering.multiplier.three },
    ]);
    expect(game.pileXp('farm')).toBe(woad.yield * rules.watering.multiplier.three * woad.xp);
    const replanted = game.farm.plots[0]?.planting;
    expect(replanted).toMatchObject({ crop: 'woad', plantedAt: 15 });
    expect(replanted?.water).toMatchObject({
      stars: rules.worker.stars,
      inBand: true,
      by: 'worker',
    });
    expect(game.inventory.count('woad_seed')).toBe(1);
    const tend = events(sink, 'farming.tend')[0]?.data;
    expect(tend).toMatchObject({ workers: 1, replanted: [{ plot: 0, crop: 'woad' }] });
    // Collecting pays the XP, like any station's pile.
    game.collect('farm');
    expect(game.inventory.count('woad')).toBe(woad.yield * rules.watering.multiplier.three);
    expect(game.xp('farming')).toBeGreaterThan(0);
  });

  it('replant an empty plot that had a crop, and stop when the seeds run out', () => {
    const { game } = newGame({ sunflower_seed: 1 });
    game.setLevel('command', 5);
    game.assignWorker('farm', 1);
    game.plant(0, 'sunflower', 0);
    game.harvest(0, sunflower.growMinutes);
    expect(game.inventory.count('sunflower_seed')).toBe(0);
    const result = game.work(15);
    expect(result.stations.find((work) => work.station === 'farm')?.short).toBe('sunflower_seed');
    expect(game.farm.plots[0]?.planting).toBeUndefined();
    game.addItems('sunflower_seed', 1);
    game.work(15);
    expect(game.farm.plots[0]?.planting?.crop).toBe('sunflower');
  });

  it('are about a tenth of playing', () => {
    const job = data.workers.jobs.find((entry) => 'plots' in entry);
    if (!job) throw new Error('No farm job');
    // Played: four woad plots at 3 stars every growing time. A worker: a plot a tend at 1 star.
    const played = (4 * woad.yield * rules.watering.multiplier.three) / woad.growMinutes;
    const worker = job.perMinute * woad.yield * rules.watering.multiplier.one;
    expect(worker / played).toBeGreaterThan(0.05);
    expect(worker / played).toBeLessThan(0.2);
  });

  it('move the farm clock on even with no one there', () => {
    const { game } = newGame();
    game.work(7.5);
    expect(game.farm.minutes).toBeCloseTo(7.5);
  });
});

describe('saving the farm', () => {
  it('keeps the plots and the clock, and an older save gets an empty farm', () => {
    const { game } = newGame({ woad_seed: 1 });
    game.plant(2, 'woad', 3);
    game.work(1);
    const store = new MemoryStore();
    const saves = new SaveStore(store, data, new ManualClock(0));
    saves.save(game.snapshot());
    const loaded = saves.load();
    expect(loaded.status).toBe('loaded');
    expect(loaded.state.farm).toEqual({
      minutes: 1,
      plots: [{}, {}, { planting: { crop: 'woad', plantedAt: 3 } }],
    });
    const old = JSON.parse(store.get('warchest.save') ?? '{}') as { state: { farm?: unknown } };
    delete old.state.farm;
    store.set('warchest.save', JSON.stringify(old));
    expect(saves.load().state.farm).toEqual({ minutes: 0, plots: [] });
  });

  it('discards a save with a plot of a crop the data no longer has', () => {
    const { game } = newGame({ woad_seed: 1 });
    game.plant(0, 'woad', 0);
    const store = new MemoryStore();
    const saves = new SaveStore(store, data, new ManualClock(0));
    const snapshot = game.snapshot();
    const plot = snapshot.farm.plots[0];
    if (plot?.planting) plot.planting.crop = 'turnip';
    saves.save(snapshot);
    expect(saves.load().status).toBe('discarded');
  });
});

describe('farming data', () => {
  const invalid = (edit: (raw: ReturnType<typeof editableRawData>) => void, message: string) => {
    const raw = editableRawData();
    edit(raw);
    expect(() => parseGameData(raw)).toThrow(message);
  };

  it("checks each crop's seed and harvest are real items, the seed from a bird", () => {
    invalid((raw) => {
      const crop = raw.farming.crops[0];
      if (crop) crop.seed = 'turnip_seed';
    }, 'Unknown item "turnip_seed"');
    invalid((raw) => {
      const crop = raw.farming.crops[0];
      if (crop) crop.item = 'turnip';
    }, 'Unknown item "turnip"');
    invalid((raw) => {
      const crop = raw.farming.crops[0];
      if (crop) crop.seed = 'feather';
    }, 'No bird drops "feather"');
  });

  it('checks the bands, the plots and the stars make sense', () => {
    invalid((raw) => {
      const crop = raw.farming.crops[0];
      if (crop) crop.band = { low: 0.8, high: 0.6 };
    }, 'The band must start under where it ends');
    invalid((raw) => {
      const crop = raw.farming.crops[0];
      if (crop) crop.band = { low: 0.6, high: 1 };
    }, 'Leave room for mud');
    invalid((raw) => {
      raw.farming.plots = [{ level: 2, count: 4 }];
    }, 'The first plots must be open from level 1');
    invalid((raw) => {
      raw.farming.watering.stars = { one: 0.6, two: 0.5, three: 1 };
    }, 'More stars must not need less');
    invalid((raw) => {
      const job = raw.workers.jobs.find((entry) => 'plots' in entry);
      if (job && 'plots' in job) job.plots = 'tree_line';
    }, 'Must be the farm');
  });
});
