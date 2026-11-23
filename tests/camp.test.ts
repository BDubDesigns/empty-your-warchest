import { describe, expect, it } from 'vitest';
import { campSpots, warchestRows } from '../src/camp';
import { Inventory } from '../src/core';
import { GameDataError } from '../src/data';
import { checkMechanics } from '../src/stations';
import { data, dataWith } from './helpers';

describe('camp layout', () => {
  it('shows every station from data, plus the chest', () => {
    const spots = campSpots(data);
    expect(spots.filter((spot) => spot.kind === 'station').map((spot) => spot.id)).toEqual([
      'tree_line',
      'workbench',
      'fire_pit',
      'war_tent',
    ]);
    expect(spots).toContainEqual({ kind: 'chest', ...data.camp.chest });
    expect(spots).toContainEqual(
      expect.objectContaining({ id: 'tree_line', skillName: 'Woodcutting', x: 0.27, y: 0.2 }),
    );
  });

  it('adds a station to the camp when it is added to the data', () => {
    const withSawmill = dataWith((raw) => {
      raw.stations.push({
        id: 'sawmill',
        name: 'Sawmill',
        skill: 'woodcutting',
        mechanic: 'woodcutting3d',
        camp: { x: 0.2, y: 0.7 },
      });
    });
    checkMechanics(withSawmill);
    expect(campSpots(withSawmill)).toContainEqual(
      expect.objectContaining({ kind: 'station', id: 'sawmill', name: 'Sawmill', x: 0.2, y: 0.7 }),
    );
  });

  it('fails loudly when a station uses a mechanic with no module', () => {
    const broken = dataWith((raw) => {
      if (raw.stations[0]) raw.stations[0].mechanic = 'fishing';
    });
    expect(() => {
      checkMechanics(broken);
    }).toThrow(GameDataError);
    expect(() => {
      checkMechanics(broken);
    }).toThrow('tree_line → "fishing"');
  });

  it('fails loudly when a camp spot is off screen', () => {
    expect(() =>
      dataWith((raw) => {
        if (raw.stations[0]) raw.stations[0].camp.x = 1.4;
      }),
    ).toThrow('stations[0].camp.x');
  });
});

describe('warchest view', () => {
  it('lists every item, with tiered items by quality', () => {
    const inventory = new Inventory(data, [
      { item: 'log', count: 12 },
      { item: 'spear', count: 4, quality: 'poor' },
      { item: 'spear', count: 1, quality: 'perfect' },
    ]);
    expect(warchestRows(data, inventory)).toEqual([
      { item: 'log', name: 'Log', detail: '12' },
      { item: 'stave', name: 'Stave', detail: '0' },
      { item: 'spear', name: 'Spear', detail: 'Poor 4 · Good 0 · Perfect 1' },
    ]);
  });
});
