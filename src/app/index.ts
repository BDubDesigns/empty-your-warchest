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
  message.textContent = `Something broke while starting a screen:\n${String(error)}`;
  byId('app').append(message);
}

/** Boots the app shell: one Phaser screen and one three.js screen, shown one at a time. */
export function startApp(): void {
  byId('build-label').textContent = __BUILD_LABEL__;

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
