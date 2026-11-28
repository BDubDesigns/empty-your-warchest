import { describe, expect, it } from 'vitest';
import {
  Game,
  MemoryStore,
  SaveStore,
  ManualClock,
  WorkClock,
  newGameState,
  workerCount,
  workerInputs,
  workerRate,
  type GameState,
} from '../src/core';
import { data, testLogger } from './helpers';

const MINUTE = 60_000;

/** A new game, optionally with `items` in the warchest. */
function newGame(items: Record<string, number> = {}, now = 0) {
  const state: GameState = newGameState(data, now);
  state.inventory = Object.entries(items).map(([item, count]) => ({ item, count }));
  const { logger, sink } = testLogger();
  return { game: new Game(data, state, logger), logger, sink };
}

const count = (game: Game, item: string) => game.inventory.count(item);

describe('workers', () => {
  it('come from Command: 3 to start, one more every 5 levels', () => {
    expect(workerCount(data, 1)).toBe(3);
    expect(workerCount(data, 4)).toBe(3);
    expect(workerCount(data, 5)).toBe(4);
    expect(workerCount(data, 30)).toBe(9);
  });

  it('start with one on each station that has a job, and none on the War tent', () => {
    const { game } = newGame();
    expect(game.crew('tree_line')).toBe(1);
    expect(game.crew('workbench')).toBe(1);
    expect(game.crew('fire_pit')).toBe(1);
    expect(game.crew('war_tent')).toBe(0);
    expect(game.freeWorkers).toBe(0);
  });

  it('move between stations, never more than you have and never below none', () => {
    const { game } = newGame();
    game.assignWorker('tree_line', 1);
    expect(game.crew('tree_line')).toBe(1);
    game.assignWorker('workbench', -1);
    game.assignWorker('workbench', -1);
    expect(game.crew('workbench')).toBe(0);
    expect(game.freeWorkers).toBe(1);
    game.assignWorker('tree_line', 1);
    expect(game.crew('tree_line')).toBe(2);
    game.assignWorker('war_tent', 1);
    expect(game.crew('war_tent')).toBe(0);
  });

  it('say what one makes a minute, and which items they use', () => {
    expect(workerRate(data, 'tree_line')).toEqual({ item: 'log', count: 1 });
    expect(workerRate(data, 'workbench')?.item).toBe('stave');
    expect(workerRate(data, 'workbench')?.count).toBeCloseTo(0.6);
    expect(workerRate(data, 'fire_pit')).toEqual({ item: 'spear', count: 0.5 });
    expect(workerRate(data, 'war_tent')).toBeUndefined();
    expect(workerRate(data, 'hunting_stand')?.item).toBe('feather');
    expect(workerRate(data, 'hunting_stand')?.count).toBeCloseTo(3);
    expect(workerInputs(data).sort()).toEqual(['feather', 'fletched_arrow', 'log', 'stave']);
  });
});

const pile = (game: Game, station: string, item: string) =>
  game.pile(station).find((stack) => stack.item === item)?.count ?? 0;

describe('work', () => {
  it('flows down the chain, passing things along: 30 minutes from nothing', () => {
    const { game } = newGame();
    const result = game.work(30);
    // 30 logs chopped; logs split at 10, 20 and 30 minutes (18 staves); staves hardened in twos
    // every 4 minutes once there are some (12, 16, 20, 24, 28), each burning a log. The workers
    // take from each other's piles; what's left waits at each station.
    expect(pile(game, 'tree_line', 'log')).toBe(30 - 3 - 5);
    expect(pile(game, 'workbench', 'stave')).toBe(18 - 10);
    expect(pile(game, 'fire_pit', 'spear')).toBe(10);
    expect(game.inventory.stacks()).toEqual([]);
    const fire = result.stations.find((station) => station.station === 'fire_pit');
    expect(fire).toMatchObject({ xp: 10 * 5, short: 'stave' });
    // XP waits with the pile.
    expect(game.pileXp('tree_line')).toBe(30 * 5);
    expect(game.xp('woodcutting')).toBe(0);
  });

  it('pays a pile into the warchest, with its XP, when collected', () => {
    const { game } = newGame();
    game.work(30);
    expect(game.collect('tree_line')).toEqual({ items: [{ item: 'log', count: 22 }], xp: 150 });
    expect(count(game, 'log')).toBe(22);
    expect(game.xp('woodcutting')).toBe(150);
    expect(game.pile('tree_line')).toEqual([]);
    expect(game.collect('tree_line')).toEqual({ items: [], xp: 0 });
  });

  it('never takes an item out of the warchest below the minimum kept back', () => {
    const { game } = newGame({ log: 20, stave: 4 });
    game.assignWorker('tree_line', -1);
    game.setMinimum('log', 20);
    game.setMinimum('stave', 4);
    const result = game.work(30);
    expect(count(game, 'log')).toBe(20);
    expect(count(game, 'stave')).toBe(4);
    expect(pile(game, 'fire_pit', 'spear')).toBe(0);
    expect(result.stations.map((station) => station.short)).toEqual([
      undefined,
      'log',
      'stave',
      undefined,
      undefined,
    ]);
  });

  it('uses the warchest above the minimum when the line runs dry', () => {
    const { game } = newGame({ log: 5 });
    game.assignWorker('tree_line', -1);
    game.setMinimum('log', 3);
    game.work(30);
    // Splits at 10, 20 and 30 minutes would need 3 logs, but only 2 are spare.
    expect(count(game, 'log')).toBe(3);
    expect(pile(game, 'workbench', 'stave')).toBeGreaterThan(0);
  });

  it('carries fractions over, so ten 1-minute stretches make what one 10-minute stretch does', () => {
    const one = newGame({ log: 5, stave: 5 }).game;
    for (let minute = 0; minute < 10; minute++) one.work(1);
    const ten = newGame({ log: 5, stave: 5 }).game;
    ten.work(10);
    expect(one.snapshot().work).toEqual(ten.snapshot().work);
    expect(one.snapshot().inventory).toEqual(ten.snapshot().inventory);
  });

  it('does nothing with no one on the station', () => {
    const { game } = newGame();
    game.assignWorker('tree_line', -1);
    game.work(30);
    expect(game.pile('tree_line')).toEqual([]);
  });

  it('works twice as fast with two', () => {
    const { game } = newGame();
    game.assignWorker('fire_pit', -1);
    game.assignWorker('tree_line', 1);
    game.work(10);
    expect(pile(game, 'tree_line', 'log')).toBe(20 - 1);
  });

  it('logs what it did, and what was collected', async () => {
    const { game, logger } = newGame();
    game.work(5, 5);
    game.collect('tree_line');
    const events = await logger.readAll();
    expect(events.find((event) => event.type === 'workers.work')?.data).toMatchObject({
      minutes: 5,
      away: 5,
    });
    expect(events.find((event) => event.type === 'workers.collect')?.data).toMatchObject({
      station: 'tree_line',
      items: [{ item: 'log', count: 5 }],
    });
  });
});

describe('the work clock', () => {
  it('counts time away up to the cap, and time playing in full', () => {
    const { game } = newGame({}, 0);
    const clock = new WorkClock(game, 2 * 60 * MINUTE);
    expect(clock.owed).toBe(data.workers.awayCapMinutes);
    clock.tick(2 * 60 * MINUTE + 45 * MINUTE);
    expect(clock.owed).toBe(data.workers.awayCapMinutes + 45);
  });

  it('banks what is owed once, and counts again after the game was in the background', () => {
    const { game } = newGame({}, 0);
    const clock = new WorkClock(game, 10 * MINUTE);
    const banked = clock.bank(10 * MINUTE);
    expect(banked).toMatchObject({ away: 10, awayReal: 10 });
    // 10 logs chopped, and one split at the 10-minute mark.
    expect(banked?.result.stations[0]?.made).toEqual([{ item: 'log', count: 10 }]);
    expect(pile(game, 'workbench', 'stave')).toBe(6);
    expect(clock.bank(10 * MINUTE)).toBeUndefined();
    clock.hidden(12 * MINUTE);
    clock.visible(20 * MINUTE);
    expect(clock.owed).toBe(10);
    expect(game.lastSeenAt).toBe(20 * MINUTE);
  });

  it('counts a debug skip as time away', () => {
    const { game } = newGame({}, 0);
    const clock = new WorkClock(game, 0);
    let skipped = 0;
    clock.onSkip(() => (skipped += 1));
    clock.skip(5 * MINUTE);
    expect(clock.owed).toBe(5);
    expect(skipped).toBe(1);
  });
});

describe('saved workers', () => {
  it('keep their crew, carry and minimums, and an older save gets the starting crew', () => {
    const { game } = newGame();
    game.assignWorker('fire_pit', -1);
    game.setMinimum('log', 10);
    game.work(0.5);
    const store = new MemoryStore();
    const saves = new SaveStore(store, data, new ManualClock(0));
    saves.save(game.snapshot());
    const loaded = saves.load();
    expect(loaded.status).toBe('loaded');
    expect(loaded.state.work).toEqual({
      crew: { tree_line: 1, workbench: 1, fire_pit: 0, hunting_stand: 0, fletchers_bench: 0 },
      carry: { fell_tree: 0.5, split_stave: 0.05 },
      minimums: { log: 10 },
      piles: {},
      xp: {},
    });
    const old = JSON.parse(store.get('warchest.save') ?? '{}') as { state: { work?: unknown } };
    delete old.state.work;
    store.set('warchest.save', JSON.stringify(old));
    expect(saves.load().state.work.crew).toEqual({
      tree_line: 1,
      workbench: 1,
      fire_pit: 1,
      hunting_stand: 0,
      fletchers_bench: 0,
    });
  });
});
