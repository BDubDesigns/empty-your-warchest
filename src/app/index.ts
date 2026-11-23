import { mountDebugMenu } from '../debug';
import { bootGame } from './boot';
import { Navigation, type View } from './navigation';
import type { PhaserView } from './phaserView';
import { lazyScreen } from './screen';
import { ScreenSwitcher } from './screenSwitcher';

type ScreenId = 'phaser' | 'three' | 'wood3d';

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
      tuning: [booted.feel.woodcutting],
      choices: [booted.choices.treeStyle, booted.choices.vibration],
      clearings: booted.clearings,
      buildLabel: __BUILD_LABEL__,
    });
  } catch (error) {
    // Bad data or a broken save must fail loudly, not leave a half-working game.
    showFatal(error);
    return;
  }
  const { game, logger, clock, feel, choices, haptics, clearings } = booted;

  const phaserElement = byId('screen-phaser');
  const threeElement = byId('screen-three');
  const wood3dElement = byId('screen-wood3d');
  const backButton = byId('back-button');
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
          haptics,
          clearings,
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
      showScreenStation: (screen) => switcher.show(screen === 'runner' ? 'three' : 'wood3d'),
    },
    (view) => {
      document.body.dataset.view = viewName(view);
      backButton.hidden = view.kind === 'camp';
    },
  );

  backButton.addEventListener(
    'click',
    run(() => navigation.back()),
  );
  await navigation.start().catch(showFatal);
}
