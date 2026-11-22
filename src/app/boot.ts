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
  type LiveTuning,
} from '../core';
import type { WoodcuttingFeel } from '../data';
import { loadGameData } from '../data';
import { checkMechanics } from '../stations';
import { woodcuttingFeel } from '../stations/woodcutting';

export interface Booted {
  game: Game;
  clock: Clock;
  logger: EventLogger;
  saves: SaveStore;
  feel: { woodcutting: LiveTuning<WoodcuttingFeel> };
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

  const feel = { woodcutting: woodcuttingFeel(data.woodcutting.feel, localStorageStore()) };

  return { game, clock, logger, saves, feel };
}
