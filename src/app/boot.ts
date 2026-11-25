import {
  EventLogger,
  Game,
  MemorySink,
  openIndexedDbSink,
  SaveStore,
  localStorageStore,
  systemClock,
  type Clock,
  type EventSink,
  type LiveChoice,
  type LiveTuning,
} from '../core';
import type { SplittingFeel, WoodcuttingFeel } from '../data';
import { loadGameData } from '../data';
import { checkMechanics } from '../stations';
import { splittingFeel } from '../stations/splitting/feel';
import {
  ClearingPicker,
  fastFallChoice,
  sceneryChoice,
  treeStyleChoice,
  woodcuttingFeel,
  type FastFall,
  type SceneryDetail,
  type TreeStyle,
} from '../stations/woodcutting';
import { Haptics, vibrationChoice, type Vibration } from './haptics';

export interface Booted {
  game: Game;
  clock: Clock;
  logger: EventLogger;
  saves: SaveStore;
  feel: { woodcutting: LiveTuning<WoodcuttingFeel>; splitting: LiveTuning<SplittingFeel> };
  /** Picks kept on this phone, shown in the debug menu. */
  choices: {
    treeStyle: LiveChoice<TreeStyle>;
    scenery: LiveChoice<SceneryDetail>;
    vibration: LiveChoice<Vibration>;
  };
  haptics: Haptics;
  /** Which clearing each woodcutting round plays. */
  clearings: ClearingPicker;
  /** Woodcutting's fast-fall switch, shown once its level is reached. */
  fastFall: LiveChoice<FastFall>;
}

async function openSink(): Promise<{ sink: EventSink; fallback?: string }> {
  try {
    return { sink: await openIndexedDbSink() };
  } catch (error) {
    // Logging must never stop the game; keep this session's events in memory instead.
    return { sink: new MemorySink(), fallback: String(error) };
  }
}

/** Validates the data, opens the logger, loads the save and starts autosaving. */
export async function bootGame(buildLabel: string): Promise<Booted> {
  const data = loadGameData();
  checkMechanics(data);
  const clock = systemClock;
  const { sink, fallback } = await openSink();
  const logger = new EventLogger(sink, clock, crypto.randomUUID());
  logger.log('session.start', {
    build: buildLabel,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
  });
  if (fallback) logger.log('logger.memoryFallback', { error: fallback });

  const saves = new SaveStore(localStorageStore(), data, clock);
  const loaded = saves.load();
  logger.log(
    `save.${loaded.status}`,
    loaded.status === 'discarded' ? { reason: loaded.reason } : undefined,
  );

  const game = new Game(data, loaded.state, logger);
  const save = (): void => {
    try {
      saves.save(game.snapshot());
    } catch (error) {
      logger.log('save.failed', { error: String(error) });
    }
  };
  game.onChange(save);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      logger.log('app.hidden');
      game.lastSeenAt = clock.now();
    } else {
      logger.log('app.visible');
    }
  });

  const feel = {
    woodcutting: woodcuttingFeel(data.woodcutting.feel, localStorageStore()),
    splitting: splittingFeel(data.splitting.feel, localStorageStore()),
  };
  const choices = {
    treeStyle: treeStyleChoice(localStorageStore()),
    scenery: sceneryChoice(localStorageStore()),
    vibration: vibrationChoice(localStorageStore()),
  };
  const haptics = new Haptics(choices.vibration);
  const clearings = new ClearingPicker(game);
  const fastFall = fastFallChoice(localStorageStore());

  return { game, clock, logger, saves, feel, choices, haptics, clearings, fastFall };
}
