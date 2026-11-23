import { GameDataError, type GameData } from '../data';

/** Phaser scene key for stations whose mini game isn't built yet. */
export const PLACEHOLDER_SCENE = 'station-placeholder';

/** Full-screen views outside Phaser (three.js), by id. */
export type ScreenId = 'runner' | 'woodcutting3d';

/** Where a station's mini game runs: a Phaser scene, or its own (three.js) screen. */
export type StationScreen =
  { kind: 'phaser'; scene: string } | { kind: 'screen'; screen: ScreenId };

export interface MechanicModule {
  screen: StationScreen;
  /** Shown while the mini game is still a placeholder. */
  placeholderNote?: string;
}

/**
 * Mini game modules, by the `mechanic` id stations use in data.
 * A new mini game is new data plus one entry here.
 */
export const mechanics: Readonly<Record<string, MechanicModule>> = {
  woodcutting3d: { screen: { kind: 'screen', screen: 'woodcutting3d' } },
  rive: {
    screen: { kind: 'phaser', scene: PLACEHOLDER_SCENE },
    placeholderNote: 'Riving arrives in M4',
  },
  harden: {
    screen: { kind: 'phaser', scene: PLACEHOLDER_SCENE },
    placeholderNote: 'Fire-hardening arrives in M5',
  },
  runner: {
    screen: { kind: 'screen', screen: 'runner' },
    placeholderNote: 'The Attack Run arrives in M7–M8',
  },
};

export function mechanicFor(mechanic: string): MechanicModule {
  const module = mechanics[mechanic];
  if (!module) throw new Error(`No mini game module for mechanic "${mechanic}"`);
  return module;
}

/** Fails loudly at startup if a station names a mechanic with no module. */
export function checkMechanics(data: GameData): void {
  const missing = data.stations.filter((station) => !(station.mechanic in mechanics));
  if (missing.length > 0) {
    const list = missing.map((station) => `${station.id} → "${station.mechanic}"`).join(', ');
    throw new GameDataError(`Stations use mechanics with no mini game module: ${list}`);
  }
}
