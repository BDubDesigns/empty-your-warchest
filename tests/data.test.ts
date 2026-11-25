import { describe, expect, it } from 'vitest';
import { GameDataError, parseGameData } from '../src/data';
import { data, editableRawData } from './helpers';

function expectInvalid(edit: (raw: ReturnType<typeof editableRawData>) => void, message: string) {
  const raw = editableRawData();
  edit(raw);
  expect(() => parseGameData(raw)).toThrow(GameDataError);
  expect(() => parseGameData(raw)).toThrow(message);
}

describe('game data', () => {
  it('validates the prototype data', () => {
    expect(data.items.map((item) => item.id)).toEqual(['log', 'stave', 'spear']);
    expect(data.stations.map((station) => station.id)).toEqual([
      'tree_line',
      'workbench',
      'fire_pit',
      'war_tent',
    ]);
    expect(data.qualities.map((quality) => quality.name)).toEqual(['Poor', 'Good', 'Perfect']);
  });

  it('fails loudly on a chain exponent that is not positive', () => {
    expectInvalid((raw) => {
      raw.woodcutting.chainExponent = 0;
    }, 'chainExponent');
  });

  it('fails loudly on a recipe that uses an unknown item', () => {
    expectInvalid((raw) => {
      raw.recipes[1]?.inputs.push({ item: 'oak_log', count: 1 });
    }, 'Unknown item "oak_log"');
  });

  it('fails loudly on duplicate ids', () => {
    expectInvalid((raw) => {
      raw.items.push({ id: 'log', name: 'Another log', tiered: false });
    }, 'Duplicate id "log"');
  });

  it('fails loudly on a station with an unknown skill', () => {
    expectInvalid((raw) => {
      if (raw.stations[0]) raw.stations[0].skill = 'mining';
    }, 'Unknown skill "mining"');
  });

  it('requires weapon damage for every quality tier', () => {
    expectInvalid((raw) => {
      if (raw.units[0]) raw.units[0].weapon.damageByQuality = { poor: 1, good: 2 };
    }, 'Missing a value for quality "perfect"');
  });

  it('requires one wall as the last level event', () => {
    expectInvalid((raw) => {
      raw.levels[0]?.events.pop();
    }, 'exactly one wall');
  });

  it('only lets known enemies guard a gate', () => {
    expectInvalid((raw) => {
      raw.levels[0]?.events.unshift({
        type: 'gates',
        at: 0,
        left: { op: 'add', value: 5, guards: { enemy: 'wolf', count: 2, armedShare: 0.5 } },
        right: { op: 'subtract', value: 5 },
      });
    }, 'Unknown enemy "wolf"');
  });

  it('rejects malformed values with the path to the problem', () => {
    expectInvalid((raw) => {
      raw.tuning.xpCurve.maxLevel = 0;
    }, 'tuning.xpCurve.maxLevel');
  });
});
