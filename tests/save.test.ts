import { describe, expect, it } from 'vitest';
import {
  Inventory,
  ManualClock,
  MemoryStore,
  SAVE_VERSION,
  SaveStore,
  type GameState,
  type LoadResult,
} from '../src/core';
import { data, dataWith } from './helpers';

const state: GameState = {
  inventory: [
    { item: 'log', count: 7 },
    { item: 'spear', count: 5 },
  ],
  skills: { woodcutting: 1_154, splitting: 83, firemaking: 40, command: 0 },
  lastSeenAt: 5_000,
  work: {
    crew: { tree_line: 1, workbench: 2, fire_pit: 0 },
    carry: { fell_tree: 0.5 },
    minimums: {},
  },
  done: ['tutorial.woodcutting'],
};

function discardReason(result: LoadResult): string {
  if (result.status !== 'discarded')
    throw new Error(`Expected a discarded save, got ${result.status}`);
  return result.reason;
}

function setup(source = data) {
  const store = new MemoryStore();
  const clock = new ManualClock(10_000);
  return { store, clock, saves: new SaveStore(store, source, clock) };
}

describe('save/load', () => {
  it('starts fresh when there is no save', () => {
    const { saves } = setup();
    const result = saves.load();
    expect(result.status).toBe('new');
    expect(result.state).toEqual({
      inventory: [],
      skills: { woodcutting: 0, splitting: 0, firemaking: 0, command: 0 },
      lastSeenAt: 10_000,
      work: { crew: { tree_line: 1, workbench: 1, fire_pit: 1 }, carry: {}, minimums: {} },
      done: [],
    });
  });

  it('loads a save from before one-time flags existed', () => {
    const { store, saves } = setup();
    const older: Partial<GameState> = { ...state };
    delete older.done;
    store.set('warchest.save', JSON.stringify({ version: SAVE_VERSION, savedAt: 1, state: older }));
    expect(saves.load()).toEqual({ status: 'loaded', state: { ...state, done: [] } });
  });

  it('merges the quality tiers of a save from before tiers were removed', () => {
    const { store, saves } = setup();
    const tiered = {
      ...state,
      inventory: [
        { item: 'spear', count: 2, quality: 'poor' },
        { item: 'spear', count: 3, quality: 'perfect' },
      ],
    };
    store.set(
      'warchest.save',
      JSON.stringify({ version: SAVE_VERSION, savedAt: 1, state: tiered }),
    );
    const result = saves.load();
    expect(result.status).toBe('loaded');
    expect(new Inventory(data, result.state.inventory).count('spear')).toBe(5);
  });

  it('round-trips the full state', () => {
    const { saves } = setup();
    saves.save(state);
    expect(saves.load()).toEqual({ status: 'loaded', state });
  });

  it('survives a second round trip unchanged', () => {
    const { store, saves } = setup();
    saves.save(state);
    const first = store.get('warchest.save');
    const loaded = saves.load();
    saves.save(loaded.state);
    expect(store.get('warchest.save')).toBe(first);
  });

  it('discards a corrupt save', () => {
    const { store, saves } = setup();
    store.set('warchest.save', '{not json');
    const result = saves.load();
    expect(result.status).toBe('discarded');
    expect(result.state.inventory).toEqual([]);
  });

  it('discards a save from another version', () => {
    const { store, saves } = setup();
    store.set('warchest.save', JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 0, state }));
    const result = saves.load();
    expect(discardReason(result)).toContain('version');
  });

  it('discards a save that no longer fits the data', () => {
    const { store, saves } = setup();
    saves.save(state);
    // Spears renamed: the save's spears are no longer an item.
    const changed = dataWith((raw) => {
      for (const item of raw.items) if (item.id === 'spear') item.id = 'javelin';
      for (const recipe of raw.recipes) {
        for (const output of recipe.outputs) if (output.item === 'spear') output.item = 'javelin';
      }
      for (const unit of raw.units) if (unit.weapon.item === 'spear') unit.weapon.item = 'javelin';
    });
    const withoutSpears = new SaveStore(store, changed, new ManualClock(0));
    expect(discardReason(withoutSpears.load())).toContain('spear');
  });

  it('discards a save when the skills in data change', () => {
    const { store, saves } = setup();
    saves.save(state);
    const withMining = dataWith((raw) => {
      raw.skills.push({ id: 'mining', name: 'Mining' });
    });
    const result = new SaveStore(store, withMining, new ManualClock(0)).load();
    expect(discardReason(result)).toContain('mining');
  });

  it('reset deletes the save', () => {
    const { store, saves } = setup();
    saves.save(state);
    saves.reset();
    expect(store.get('warchest.save')).toBeNull();
    expect(saves.load().status).toBe('new');
  });
});
