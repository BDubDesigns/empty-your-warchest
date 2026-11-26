import { byId as entryById } from '../data';
import { mountDebugMenu } from '../debug';
import { BackButton } from './backButton';
import { bootGame } from './boot';
import { LoadingCard, noticeIfSlow } from './loadingCard';
import { Navigation, type View } from './navigation';
import type { PhaserView } from './phaserView';
import { Preloader, whenIdle } from './preloader';
import { lazyScreen, type LazyScreen } from './screen';
import { ScreenSwitcher } from './screenSwitcher';
import { mechanicFor, type ScreenId as StationScreenId } from '../stations/registry';

type ScreenId = 'phaser' | 'three' | 'wood3d' | 'splitting3d' | 'firemaking3d';

/** The shell screen each station screen runs on. */
const SCREENS: Record<StationScreenId, ScreenId> = {
  runner: 'three',
  woodcutting3d: 'wood3d',
  splitting3d: 'splitting3d',
  firemaking3d: 'firemaking3d',
};

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html`);
  return element;
}

function showFatal(error: unknown): void {
  const message = document.createElement('pre');
  message.className = 'fatal';
  message.textContent = `Something broke:\n${error instanceof Error ? error.message : String(error)}`;
  byId('app').append(message);
}

function viewName(view: View): string {
  return view.kind === 'station' ? `station:${view.stationId}` : view.kind;
}

/** Resolves once the next frame has been drawn. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

// Each station view's code, split out of the main bundle (one download, however often it's asked for).
const woodcuttingView = () => import('../stations/woodcutting/three/woodcutting3dView');
const splittingView = () => import('../stations/splitting/three/splitting3dView');
const firemakingView = () => import('../stations/firemaking/three/firemaking3dView');

/** Boots the game core, the debug menu, and the camp. */
export async function startApp(): Promise<void> {
  byId('build-label').textContent = __BUILD_LABEL__;

  let booted;
  try {
    booted = await bootGame(__BUILD_LABEL__);
    mountDebugMenu(byId('app'), {
      ...booted,
      tuning: [booted.feel.woodcutting, booted.feel.splitting, booted.feel.firemaking],
      choices: [booted.choices.treeStyle, booted.choices.scenery, booted.choices.vibration],
      clearings: booted.clearings,
      buildLabel: __BUILD_LABEL__,
    });
  } catch (error) {
    // Bad data or a broken save must fail loudly, not leave a half-working game.
    showFatal(error);
    return;
  }
  const { game, logger, clock, feel, choices, haptics, clearings, fastFall } = booted;

  const phaserElement = byId('screen-phaser');
  const threeElement = byId('screen-three');
  const wood3dElement = byId('screen-wood3d');
  const splitting3dElement = byId('screen-splitting3d');
  const firemaking3dElement = byId('screen-firemaking3d');
  const backButton = new BackButton(byId('back-button'), () => {
    run(() => navigation.back())();
  });
  let phaser: PhaserView | undefined;
  const run = (action: () => Promise<void>) => () => {
    action().catch(showFatal);
  };

  const screens: Record<ScreenId, LazyScreen> = {
    phaser: lazyScreen(phaserElement, async () => {
      const { PhaserView } = await import('./phaserView');
      phaser = await PhaserView.create(phaserElement, {
        game,
        onStationTap: (stationId) => {
          run(() => navigation.openStation(stationId))();
        },
        onChestTap: run(() => navigation.openWarchest()),
        onWarchestClose: run(() => navigation.back()),
      });
      return phaser;
    }),
    wood3d: lazyScreen(
      wood3dElement,
      async () => {
        const { Woodcutting3DView } = await woodcuttingView();
        return Woodcutting3DView.create(wood3dElement, {
          game,
          logger,
          feel: feel.woodcutting,
          treeStyle: choices.treeStyle,
          scenery: choices.scenery,
          haptics,
          clearings,
          fastFall,
          onLeave: run((): Promise<void> => navigation.back()),
          backButton,
        });
      },
      async () => {
        await (await woodcuttingView()).Woodcutting3DView.preload();
      },
    ),
    splitting3d: lazyScreen(
      splitting3dElement,
      async () => {
        const { Splitting3DView } = await splittingView();
        return Splitting3DView.create(splitting3dElement, {
          game,
          logger,
          feel: feel.splitting,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      },
      async () => {
        await (await splittingView()).Splitting3DView.preload();
      },
    ),
    firemaking3d: lazyScreen(
      firemaking3dElement,
      async () => {
        const { Firemaking3DView } = await firemakingView();
        return Firemaking3DView.create(firemaking3dElement, {
          game,
          logger,
          feel: feel.firemaking,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      },
      async () => {
        await (await firemakingView()).Firemaking3DView.preload();
      },
    ),
    three: lazyScreen(
      threeElement,
      async () => {
        const { ThreeView } = await import('./threeView');
        return new ThreeView(threeElement, 'War tent · Attack Run placeholder · drag to spin');
      },
      async () => {
        await import('./threeView');
      },
    ),
  };
  const switcher = new ScreenSwitcher<ScreenId>(screens, (id) => {
    document.body.dataset.screen = id;
  });

  // At the camp, each station's screen (code and models, no renderer yet) loads in the
  // background while the browser is idle, in data order (the Tree line first), so tapping a
  // station opens it without a pause. Paused while in a station; it carries on back at the camp.
  const { screens: screenTuning } = game.data.tuning;
  const stationScreens = [
    ...new Set(
      game.data.stations.flatMap((station) => {
        const { screen } = mechanicFor(station.mechanic);
        return screen.kind === 'screen' ? [SCREENS[screen.screen]] : [];
      }),
    ),
  ];
  const preloader = new Preloader(
    stationScreens.map((id) => ({ id, run: () => screens[id].preload() })),
    {
      schedule: whenIdle(screenTuning.preloadIdleTimeoutMs),
      now: () => performance.now(),
      skip: (id) => switcher.isMounted(id),
      onDone: (screen, ms) => {
        logger.log('screen.preload', { screen, ms: Math.round(ms) });
      },
      onFailed: (screen, error) => {
        logger.log('screen.preloadFailed', { screen, error: String(error) });
      },
    },
  );
  const loadingCard = new LoadingCard(byId('app'));

  /**
   * Shows a station's screen. The first time, its view is built (and loaded, if the preload
   * hasn't got to it), so the loading card shows if that's slow, and the wait is logged.
   */
  const showStationScreen = async (screen: ScreenId, stationId: string): Promise<void> => {
    // Background loads would only compete with this one.
    preloader.pause();
    if (switcher.isMounted(screen)) {
      await switcher.show(screen);
      return;
    }
    const preload = preloader.state(screen) ?? 'none';
    const started = performance.now();
    loadingCard.setText(`Heading to the ${entryById(game.data.stations, stationId).name}…`);
    // Until the screen has drawn its first frame, so the card never gives way to a blank screen.
    const card = await noticeIfSlow(
      switcher.show(screen).then(nextFrame),
      screenTuning.loadingCardDelayMs,
      loadingCard,
    );
    const ms = Math.round(performance.now() - started);
    logger.log('screen.load', { screen, station: stationId, ms, preload, card });
  };

  const phaserView = async (): Promise<PhaserView> => {
    await switcher.show('phaser');
    if (!phaser) throw new Error('Phaser did not start');
    return phaser;
  };

  const navigation = new Navigation(
    game.data,
    logger,
    clock,
    {
      showCamp: async () => {
        (await phaserView()).showCamp();
      },
      showWarchest: async () => {
        (await phaserView()).showWarchest();
      },
      showPhaserStation: async (sceneKey, stationId) => {
        (await phaserView()).showStation(sceneKey, stationId);
      },
      showScreenStation: (screen, stationId) => showStationScreen(SCREENS[screen], stationId),
    },
    (view) => {
      document.body.dataset.view = viewName(view);
      backButton.setShown(view.kind !== 'camp');
      if (view.kind === 'camp') preloader.resume();
    },
  );

  await navigation.start().catch(showFatal);
}
