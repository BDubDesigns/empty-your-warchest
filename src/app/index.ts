import { mountDebugMenu } from '../debug';
import { bootGame } from './boot';
import { lazyScreen } from './screen';
import { ScreenSwitcher } from './screenSwitcher';

type ScreenId = 'phaser' | 'three';

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

/** Boots the game core, the debug menu, and the app shell's screens. */
export async function startApp(): Promise<void> {
  byId('build-label').textContent = __BUILD_LABEL__;

  try {
    const booted = await bootGame(__BUILD_LABEL__);
    mountDebugMenu(byId('app'), { ...booted, buildLabel: __BUILD_LABEL__ });
  } catch (error) {
    // Bad data or a broken save must fail loudly, not leave a half-working game.
    showFatal(error);
    return;
  }

  const phaserElement = byId('screen-phaser');
  const threeElement = byId('screen-three');
  const go = (id: ScreenId) => () => {
    switcher.show(id).catch(showFatal);
  };

  const switcher = new ScreenSwitcher<ScreenId>(
    {
      phaser: lazyScreen(phaserElement, async () => {
        const { PhaserView } = await import('./phaserView');
        return PhaserView.create(phaserElement, go('three'));
      }),
      three: lazyScreen(threeElement, async () => {
        const { ThreeView } = await import('./threeView');
        return new ThreeView(threeElement, go('phaser'));
      }),
    },
    (id) => {
      document.body.dataset.screen = id;
    },
  );

  go('phaser')();
}
