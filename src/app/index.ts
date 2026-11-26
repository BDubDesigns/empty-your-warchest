import { mountDebugMenu } from '../debug';
import { BackButton } from './backButton';
import { bootGame } from './boot';
import { Navigation, type View } from './navigation';
import type { PhaserView } from './phaserView';
import { lazyScreen } from './screen';
import { ScreenSwitcher } from './screenSwitcher';
import type { ScreenId as StationScreenId } from '../stations/registry';

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
  const { game, logger, clock, feel, choices, haptics, clearings, fastFall, work } = booted;

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
  const backButton = new BackButton(byId('back-button'), () => {
    run(() => navigation.back())();
  });
  let phaser: PhaserView | undefined;
  const run = (action: () => Promise<void>) => () => {
    action().catch(showFatal);
  };

  const switcher = new ScreenSwitcher<ScreenId>(
    {
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
        return phaser;
      }),
      wood3d: lazyScreen(wood3dElement, async () => {
        const { Woodcutting3DView } =
          await import('../stations/woodcutting/three/woodcutting3dView');
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
      }),
      splitting3d: lazyScreen(splitting3dElement, async () => {
        const { Splitting3DView } = await import('../stations/splitting/three/splitting3dView');
        return Splitting3DView.create(splitting3dElement, {
          game,
          logger,
          feel: feel.splitting,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      }),
      firemaking3d: lazyScreen(firemaking3dElement, async () => {
        const { Firemaking3DView } = await import('../stations/firemaking/three/firemaking3dView');
        return Firemaking3DView.create(firemaking3dElement, {
          game,
          logger,
          feel: feel.firemaking,
          haptics,
          onLeave: run((): Promise<void> => navigation.back()),
        });
      }),
      three: lazyScreen(threeElement, async () => {
        const { ThreeView } = await import('./threeView');
        return new ThreeView(threeElement, 'War tent · Attack Run placeholder · drag to spin');
      }),
    },
    (id) => {
      document.body.dataset.screen = id;
    },
  );

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
      showScreenStation: (screen) => switcher.show(SCREENS[screen]),
    },
    (view) => {
      document.body.dataset.view = viewName(view);
      backButton.setShown(view.kind !== 'camp');
      if (view.kind === 'camp') bankWork();
    },
  );

  await navigation.start().catch(showFatal);
}
