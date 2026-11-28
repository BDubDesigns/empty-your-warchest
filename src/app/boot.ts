import {
  EventLogger,
  Game,
  GraphicsSettings,
  MemorySink,
  openIndexedDbSink,
  SaveStore,
  localStorageStore,
  systemClock,
  WorkClock,
  type Clock,
  type EventSink,
  type LiveChoice,
  type LiveTuning,
} from '../core';
import { deviceHints } from './deviceHints';
import { watchForTrouble } from './trouble';
import type {
  ArcheryFeel,
  BrewingFeel,
  FiremakingFeel,
  FletchingFeel,
  RunnerFeel,
  SiegeFeel,
  SplittingFeel,
  WoodcuttingFeel,
} from '../data';
import { loadGameData } from '../data';
import {
  liftModeChoice,
  runnerFeel,
  spearSourceChoice,
  type LiftMode,
  type SpearSource,
} from '../runner/feel';
import { checkMechanics } from '../stations';
import { archeryFeel } from '../stations/archery/feel';
import { brewingFeel } from '../stations/brewing/feel';
import { checkBrews } from '../stations/brewing/logic/brew';
import { firemakingFeel } from '../stations/firemaking/feel';
import { fletchingFeel } from '../stations/fletching/feel';
import {
  ghostChoice,
  hitBoxChoice,
  siegeFeel,
  warTentChoice,
  type GhostLine,
  type HitBoxes,
  type WarTent,
} from '../stations/siege/feel';
import { splittingFeel } from '../stations/splitting/feel';
import {
  ClearingPicker,
  fastFallChoice,
  sceneryChoice,
  treeStyleChoice,
  woodcuttingFeel,
  type FastFall,
  type SceneryDetail,
  type TreeStyleSetting,
} from '../stations/woodcutting';
import { Haptics, vibrationChoice, type Vibration } from './haptics';

export interface Booted {
  game: Game;
  clock: Clock;
  logger: EventLogger;
  saves: SaveStore;
  feel: {
    woodcutting: LiveTuning<WoodcuttingFeel>;
    splitting: LiveTuning<SplittingFeel>;
    firemaking: LiveTuning<FiremakingFeel>;
    brewing: LiveTuning<BrewingFeel>;
    archery: LiveTuning<ArcheryFeel>;
    fletching: LiveTuning<FletchingFeel>;
    siege: LiveTuning<SiegeFeel>;
    runner: LiveTuning<RunnerFeel>;
  };
  /** Picks kept on this phone, shown in the debug menu. */
  choices: {
    treeStyle: LiveChoice<TreeStyleSetting>;
    scenery: LiveChoice<SceneryDetail>;
    vibration: LiveChoice<Vibration>;
    runnerSpears: LiveChoice<SpearSource>;
    runnerLift: LiveChoice<LiftMode>;
    warTent: LiveChoice<WarTent>;
    siegeGhost: LiveChoice<GhostLine>;
    siegeHitBoxes: LiveChoice<HitBoxes>;
  };
  haptics: Haptics;
  /** The graphics tier (high or low) every 3D screen draws at; Debug → Graphics. */
  graphics: GraphicsSettings;
  /** Which clearing each woodcutting round plays. */
  clearings: ClearingPicker;
  /** Woodcutting's fast-fall switch, shown once its level is reached. */
  fastFall: LiveChoice<FastFall>;
  /** The workers' time, banked at the camp. */
  work: WorkClock;
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
  // Every brew must have a 3-star answer within the fill, wherever its target lands.
  checkBrews(data);
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
  watchForTrouble(logger);

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

  // The workers' time: away since the save was last seen, then playing and away from here on.
  const work = new WorkClock(game, clock.now());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      logger.log('app.hidden');
      work.hidden(clock.now());
    } else {
      logger.log('app.visible');
      work.visible(clock.now());
    }
  });

  const feel = {
    woodcutting: woodcuttingFeel(data.woodcutting.feel, localStorageStore()),
    splitting: splittingFeel(data.splitting.feel, localStorageStore()),
    firemaking: firemakingFeel(data.firemaking.feel, localStorageStore()),
    brewing: brewingFeel(data.brewing.feel, localStorageStore()),
    archery: archeryFeel(data.archery.feel, localStorageStore()),
    fletching: fletchingFeel(data.fletching.feel, localStorageStore()),
    siege: siegeFeel(data.siege.feel, localStorageStore()),
    runner: runnerFeel(data.runner.feel, localStorageStore()),
  };
  const choices = {
    treeStyle: treeStyleChoice(localStorageStore()),
    scenery: sceneryChoice(localStorageStore()),
    vibration: vibrationChoice(localStorageStore()),
    runnerSpears: spearSourceChoice(localStorageStore()),
    runnerLift: liftModeChoice(localStorageStore()),
    warTent: warTentChoice(localStorageStore()),
    siegeGhost: ghostChoice(localStorageStore()),
    siegeHitBoxes: hitBoxChoice(localStorageStore()),
  };
  const haptics = new Haptics(choices.vibration);
  const graphics = new GraphicsSettings(data.graphics, localStorageStore(), logger, deviceHints());
  const clearings = new ClearingPicker(game);
  const fastFall = fastFallChoice(localStorageStore());

  return {
    game,
    clock,
    logger,
    saves,
    feel,
    choices,
    haptics,
    graphics,
    clearings,
    fastFall,
    work,
  };
}
