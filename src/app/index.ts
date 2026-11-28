import { quickFromUrl, type QuickOverrides } from '../bench/logic/quick';
import { byId as entryById } from '../data';
import { mountDebugMenu } from '../debug';
import { BackButton } from './backButton';
import { bootGame } from './boot';
import { gpuOf } from './deviceHints';
import { LeaveCard } from './leaveCard';
import { LeaveGuard } from './leaveGuard';
import { LoadingCard, noticeIfSlow } from './loadingCard';
import { Navigation, type View } from './navigation';
import { PhoneBack } from './phoneBack';
import type { PhaserView } from './phaserView';
import { Preloader, whenIdle } from './preloader';
import { lazyScreen, type LazyScreen } from './screen';
import { ScreenSwitcher } from './screenSwitcher';
import { noteContext } from './trouble';
import { mechanicFor, type ScreenId as StationScreenId } from '../stations/registry';

type ScreenId =
  | 'phaser'
  | 'three'
  | 'wood3d'
  | 'splitting3d'
  | 'firemaking3d'
  | 'brewing3d'
  | 'archery3d'
  | 'fletching3d'
  | 'farming3d'
  | 'siege3d';

/** The shell screen each station screen runs on. */
const SCREENS: Record<StationScreenId, ScreenId> = {
  runner: 'three',
  woodcutting3d: 'wood3d',
  splitting3d: 'splitting3d',
  firemaking3d: 'firemaking3d',
  brewing3d: 'brewing3d',
  archery3d: 'archery3d',
  fletching3d: 'fletching3d',
  farming3d: 'farming3d',
  siege3d: 'siege3d',
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
const brewingView = () => import('../stations/brewing/three/brewing3dView');
const archeryView = () => import('../stations/archery/three/archery3dView');
const fletchingView = () => import('../stations/fletching/three/fletching3dView');
const farmingView = () => import('../stations/farming/three/farming3dView');
const siegeView = () => import('../stations/siege/three/siege3dView');
const runnerView = () => import('../runner/view');
const benchScreen = () => import('../bench/view/benchScreen');
const castlePreview = () => import('../castle/view/castlePreview');
const characterPreview = () => import('../characters/view/characterPreview');

/** Boots the game core, the debug menu, and the camp. */
export async function startApp(): Promise<void> {
  byId('build-label').textContent = __BUILD_LABEL__;
  // ?bench=quick: straight into the stress test's quick run (a device gets about a minute on a
  // free BrowserStack trial), its code loading alongside the boot. The camp, and the background
  // loading of the stations' screens, wait until the stress test is closed.
  const quick = quickFromUrl(window.location.search);
  if (quick) void benchScreen().catch(() => undefined);

  let booted;
  try {
    booted = await bootGame(__BUILD_LABEL__);
    mountDebugMenu(byId('app'), {
      ...booted,
      tuning: [
        booted.feel.woodcutting,
        booted.feel.splitting,
        booted.feel.firemaking,
        booted.feel.brewing,
        booted.feel.archery,
        booted.feel.fletching,
        booted.feel.farming,
        booted.feel.siege,
        booted.feel.runner,
      ],
      choices: [
        booted.graphics,
        booted.choices.treeStyle,
        booted.choices.scenery,
        booted.choices.vibration,
        booted.choices.warTent,
        booted.choices.siegeGhost,
        booted.choices.siegeHitBoxes,
        booted.choices.runnerSpears,
        booted.choices.runnerLift,
      ],
      clearings: booted.clearings,
      buildLabel: __BUILD_LABEL__,
      stressTest: () => {
        void openStressTest();
      },
      castlePreview: () => {
        void openCastlePreview();
      },
      characterPreview: () => {
        void openCharacterPreview();
      },
    });
  } catch (error) {
    // Bad data or a broken save must fail loudly, not leave a half-working game.
    showFatal(error);
    return;
  }
  const { game, logger, clock, feel, choices, haptics, graphics, clearings, fastFall, work } =
    booted;

  // The workers' work is done at the camp only, so they never use what a station has out. What
  // they make waits on their stations' piles until it's collected.
  const atCamp = () => document.body.dataset.view === 'camp';
  const bankWork = () => {
    work.bank(clock.now());
  };
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (atCamp()) bankWork();
    else work.tick(clock.now());
  }, 60_000);
  work.onSkip(() => {
    if (atCamp()) bankWork();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && atCamp()) bankWork();
  });

  const phaserElement = byId('screen-phaser');
  const threeElement = byId('screen-three');
  const wood3dElement = byId('screen-wood3d');
  const splitting3dElement = byId('screen-splitting3d');
  const firemaking3dElement = byId('screen-firemaking3d');
  const brewing3dElement = byId('screen-brewing3d');
  const archery3dElement = byId('screen-archery3d');
  const fletching3dElement = byId('screen-fletching3d');
  const farming3dElement = byId('screen-farming3d');
  const siege3dElement = byId('screen-siege3d');
  let phaser: PhaserView | undefined;
  const run = (action: () => Promise<void>) => () => {
    action().catch((error: unknown) => {
      logger.log('app.error', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? '') : '',
        screen: document.body.dataset.screen ?? 'none',
      });
      showFatal(error);
    });
  };

  // Back to camp asks first when leaving would lose something (each station view says what);
  // the card is shared, and the phone's back goes through the same guard.
  const leaveGuard = new LeaveGuard({
    cost: () => {
      const id = switcher.current;
      return id === undefined ? undefined : screens[id].leaveCost?.();
    },
    where: () => {
      const { view } = navigation;
      return view.kind === 'station' ? view.stationId : view.kind;
    },
    prompt: new LeaveCard(byId('app')),
    leave: run(() => navigation.back()),
    log: (type, data) => {
      logger.log(type, data);
    },
  });
  const backButton = new BackButton(byId('back-button'), () => {
    leaveGuard.request();
  });
  // The phone's back acts like the button: its own action (woodcutting's End round) when a
  // station has one, else Back to camp through the guard.
  const phoneBack = new PhoneBack(window.history, () => {
    if (backButton.hasAction) {
      logger.log('app.backButton', { action: true });
      backButton.press();
    } else {
      leaveGuard.phoneBack();
    }
  });
  window.addEventListener('popstate', () => {
    phoneBack.popped(navigation.view.kind !== 'camp');
  });
  const screens: Record<ScreenId, LazyScreen> = {
    phaser: lazyScreen(phaserElement, async () => {
      const { PhaserView } = await import('./phaserView');
      phaser = await PhaserView.create(phaserElement, {
        game,
        haptics,
        onStationTap: (stationId) => {
          run(() => navigation.openStation(stationId))();
        },
        onChestTap: run(() => navigation.openWarchest()),
        onWarchestClose: run(() => navigation.back()),
      });
      const gl = phaser.glContext();
      if (gl) {
        noteContext(gl);
        // The first WebGL context: the GPU's name, for the graphics tier.
        graphics.noteGpu(gpuOf(gl).gpu);
      }
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
          graphics,
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
    brewing3d: lazyScreen(
      brewing3dElement,
      async () => {
        const { Brewing3DView } = await brewingView();
        return Brewing3DView.create(brewing3dElement, {
          game,
          logger,
          feel: feel.brewing,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      },
      async () => {
        await (await brewingView()).Brewing3DView.preload();
      },
    ),
    archery3d: lazyScreen(
      archery3dElement,
      async () => {
        const { Archery3DView } = await archeryView();
        return Archery3DView.create(archery3dElement, {
          game,
          logger,
          feel: feel.archery,
          graphics,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      },
      async () => {
        await (await archeryView()).Archery3DView.preload();
      },
    ),
    fletching3d: lazyScreen(
      fletching3dElement,
      async () => {
        const { Fletching3DView } = await fletchingView();
        return Fletching3DView.create(fletching3dElement, {
          game,
          logger,
          feel: feel.fletching,
          graphics,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      },
      async () => {
        await (await fletchingView()).Fletching3DView.preload();
      },
    ),
    farming3d: lazyScreen(
      farming3dElement,
      async () => {
        const { Farming3DView } = await farmingView();
        return Farming3DView.create(farming3dElement, {
          game,
          logger,
          clock,
          work,
          feel: feel.farming,
          graphics,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      },
      async () => {
        await (await farmingView()).Farming3DView.preload();
      },
    ),
    siege3d: lazyScreen(
      siege3dElement,
      async () => {
        const { Siege3DView } = await siegeView();
        return Siege3DView.create(siege3dElement, {
          game,
          logger,
          feel: feel.siege,
          ghost: choices.siegeGhost,
          hitBoxes: choices.siegeHitBoxes,
          graphics,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      },
      async () => {
        // The physics engine's wasm starts here too, so the first throw never waits for it, and
        // the castle's kit and the characters' files are fetched.
        await (
          await siegeView()
        ).Siege3DView.preload(
          game.data.siege.skins,
          game.data.castle.kit,
          game.data.characters,
          graphics.tier,
        );
      },
    ),
    three: lazyScreen(
      threeElement,
      async () => {
        const { RunnerView } = await runnerView();
        return RunnerView.create(threeElement, {
          game,
          spearSource: choices.runnerSpears,
          liftMode: choices.runnerLift,
          data: game.data,
          logger,
          feel: feel.runner,
          haptics,
        });
      },
      async () => {
        await runnerView();
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

  /**
   * Debug → Stress test: its own screen over everything, its code and models loaded only now. The
   * screen on show (and the background loading) pauses while it's open, so it measures alone.
   * `quick` starts its quick run straight away. Resolves once it's closed.
   */
  function openStressTest(quick?: QuickOverrides): Promise<void> {
    preloader.pause();
    return new Promise((resolve) => {
      run(async () => {
        try {
          await switcher.aside(async () => {
            const { openBench } = await benchScreen();
            await openBench(byId('app'), {
              logger,
              buildLabel: __BUILD_LABEL__,
              ...(quick ? { quick } : {}),
            });
          });
        } finally {
          if (document.body.dataset.view === 'camp') preloader.resume();
          resolve();
        }
      })();
    });
  }

  /**
   * Debug → Castle preview: over everything like the stress test, its code and models loaded only
   * now. Resolves once it's closed.
   */
  function openCastlePreview(): Promise<void> {
    preloader.pause();
    return new Promise((resolve) => {
      run(async () => {
        try {
          await switcher.aside(async () => {
            const { openCastlePreview: open } = await castlePreview();
            await open(byId('app'), { castle: game.data.castle, logger, graphics });
          });
        } finally {
          if (document.body.dataset.view === 'camp') preloader.resume();
          resolve();
        }
      })();
    });
  }

  /** Debug → Character preview: as the castle preview, its code and models loaded only now. */
  function openCharacterPreview(): Promise<void> {
    preloader.pause();
    return new Promise((resolve) => {
      run(async () => {
        try {
          await switcher.aside(async () => {
            const { openCharacterPreview: open } = await characterPreview();
            await open(byId('app'), { characters: game.data.characters, logger, graphics });
          });
        } finally {
          if (document.body.dataset.view === 'camp') preloader.resume();
          resolve();
        }
      })();
    });
  }

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
      showScreenStation: (screen, stationId) =>
        showStationScreen(
          // Debug → Options → War tent opens: the gate runner the siege replaced, to compare.
          screen === 'siege3d' && choices.warTent.value === 'runner' ? 'three' : SCREENS[screen],
          stationId,
        ),
    },
    (view) => {
      document.body.dataset.view = viewName(view);
      backButton.setShown(view.kind !== 'camp');
      leaveGuard.dismiss();
      phoneBack.follow(view.kind !== 'camp');
      if (view.kind === 'camp') {
        bankWork();
        preloader.resume();
      }
    },
  );

  if (quick) await openStressTest(quick);
  await navigation.start().catch(showFatal);
}
