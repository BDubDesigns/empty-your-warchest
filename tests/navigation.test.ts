import { describe, expect, it } from 'vitest';
import { Navigation, type View } from '../src/app/navigation';
import { data, testLogger } from './helpers';

function setup() {
  const { logger, clock } = testLogger();
  const calls: string[] = [];
  const views: View[] = [];
  const navigation = new Navigation(
    data,
    logger,
    clock,
    {
      showCamp: () => Promise.resolve(void calls.push('camp')),
      showWarchest: () => Promise.resolve(void calls.push('warchest')),
      showPhaserStation: (scene, station) =>
        Promise.resolve(void calls.push(`phaser:${scene}:${station}`)),
      showScreenStation: (screen, station) =>
        Promise.resolve(void calls.push(`screen:${screen}:${station}`)),
    },
    (view) => views.push(view),
  );
  return { navigation, logger, clock, calls, views };
}

describe('Navigation', () => {
  it('opens Phaser stations as scenes, and the war tent and workbench on their own screens', async () => {
    const { navigation, calls } = setup();
    await navigation.start();
    await navigation.openStation('fire_pit');
    await navigation.back();
    await navigation.openStation('war_tent');
    await navigation.back();
    await navigation.openStation('workbench');
    await navigation.back();
    expect(calls).toEqual([
      'camp',
      'phaser:station-placeholder:fire_pit',
      'camp',
      'screen:runner:war_tent',
      'camp',
      'screen:rive3d:workbench',
      'camp',
    ]);
  });

  it('logs entering and leaving stations with the time spent', async () => {
    const { navigation, logger, clock } = setup();
    await navigation.start();
    await navigation.openStation('tree_line');
    clock.advance(12_340);
    await navigation.back();
    await navigation.openWarchest();
    clock.advance(3_000);
    await navigation.back();
    const events = (await logger.readAll()).map((event) => ({
      type: event.type,
      data: event.data,
    }));
    expect(events).toEqual([
      { type: 'camp.enter', data: undefined },
      { type: 'station.enter', data: { station: 'tree_line' } },
      { type: 'station.exit', data: { station: 'tree_line', seconds: 12.3 } },
      { type: 'camp.enter', data: undefined },
      { type: 'warchest.open', data: undefined },
      { type: 'warchest.close', data: { seconds: 3 } },
      { type: 'camp.enter', data: undefined },
    ]);
  });

  it('only opens things from the camp, and reports each view', async () => {
    const { navigation, calls, views } = setup();
    await navigation.start();
    await navigation.openStation('fire_pit');
    await navigation.openWarchest();
    await navigation.openStation('tree_line');
    expect(calls).toEqual(['camp', 'phaser:station-placeholder:fire_pit']);
    expect(views).toEqual([{ kind: 'camp' }, { kind: 'station', stationId: 'fire_pit' }]);
    expect(navigation.view).toEqual({ kind: 'station', stationId: 'fire_pit' });
  });
});
