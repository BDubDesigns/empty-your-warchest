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
    expect(data.items.map((item) => item.id)).toEqual([
      'log',
      'stave',
      'spear',
      'sense_potion',
      'moss',
      'red_cap',
      'ash',
      'woad',
      'sunflower_seed',
      'woad_seed',
      'mushroom_spores',
      'feather',
      'fletched_arrow',
      'bare_arrow',
      'arrow_shaft',
      'duster_arrow',
      'sunflower_petals',
    ]);
    expect(data.stations.map((station) => station.id)).toEqual([
      'tree_line',
      'workbench',
      'fire_pit',
      'cauldron',
      'hunting_stand',
      'fletchers_bench',
      'war_tent',
      'farm',
    ]);
    expect(data.skills.map((skill) => skill.id)).toEqual([
      'woodcutting',
      'splitting',
      'firemaking',
      'command',
      'alchemy',
      'archery',
      'fletching',
      'farming',
    ]);
  });

  it('runs the fire pit on Firemaking', () => {
    expect(data.stations.find((station) => station.id === 'fire_pit')?.skill).toBe('firemaking');
  });

  it('fails loudly on a chain exponent that is not positive', () => {
    expectInvalid((raw) => {
      raw.woodcutting.chainExponent = 0;
    }, 'chainExponent');
  });

  it('fails loudly on scenery inside the woodcutting fence', () => {
    expectInvalid((raw) => {
      raw.woodcutting.scenery.woodpile.y = 300;
    }, 'The woodpile must be outside the fence');
    expectInvalid((raw) => {
      raw.woodcutting.scenery.block.x = 180;
      raw.woodcutting.scenery.block.y = 600;
    }, 'The chopping block must be outside the fence');
  });

  it('fails loudly on a scenery range with min above max', () => {
    expectInvalid((raw) => {
      raw.woodcutting.scenery.forest.height = { min: 200, max: 100 };
    }, 'min must not be more than max');
  });

  it('fails loudly on a recipe that uses an unknown item', () => {
    expectInvalid((raw) => {
      raw.recipes[1]?.inputs.push({ item: 'oak_log', count: 1 });
    }, 'Unknown item "oak_log"');
  });

  it('fails loudly on duplicate ids', () => {
    expectInvalid((raw) => {
      raw.items.push({ id: 'log', name: 'Another log', look: 'round' });
    }, 'Duplicate id "log"');
  });

  it('fails loudly on a station with an unknown skill', () => {
    expectInvalid((raw) => {
      if (raw.stations[0]) raw.stations[0].skill = 'mining';
    }, 'Unknown skill "mining"');
  });

  it('fails loudly on a weapon that is not an item', () => {
    expectInvalid((raw) => {
      if (raw.units[0]) raw.units[0].weapon.item = 'sword';
    }, 'Unknown item "sword"');
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

  it('fails loudly on a negative loading card delay', () => {
    expectInvalid((raw) => {
      raw.tuning.screens.loadingCardDelayMs = -1;
    }, 'tuning.screens.loadingCardDelayMs');
  });
});
