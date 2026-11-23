import * as Phaser from 'phaser';
import { CampScene, type CampDeps } from '../camp/campScene';
import { WarchestScene } from '../camp/warchestScene';
import { StationPlaceholderScene } from '../stations/placeholderScene';
import type { ScreenView } from './screen';
import { theme } from './theme';

export interface PhaserDeps extends CampDeps {
  onWarchestClose: () => void;
}

const STATION_SCENES = ['station-placeholder'];

/** The Phaser game: camp, station scenes, and the warchest view on top. */
export class PhaserView implements ScreenView {
  readonly #game: Phaser.Game;

  private constructor(game: Phaser.Game) {
    this.#game = game;
  }

  static create(element: HTMLElement, deps: PhaserDeps): Promise<PhaserView> {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: element,
      backgroundColor: theme.bg,
      banner: false,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      // Only react to touches on the canvas itself, not on DOM overlays above it
      // (debug panel, back button).
      input: { windowEvents: false },
      // Later scenes draw on top: the warchest view sits over the camp.
      scene: [
        new CampScene(deps),
        new StationPlaceholderScene(deps.game),
        new WarchestScene({ game: deps.game, onClose: deps.onWarchestClose }),
      ],
    });
    return new Promise((resolve) => {
      game.events.once(Phaser.Core.Events.READY, () => {
        resolve(new PhaserView(game));
      });
    });
  }

  showCamp(): void {
    const scenes = this.#game.scene;
    for (const key of [...STATION_SCENES, 'warchest']) {
      if (scenes.isActive(key) || scenes.isPaused(key)) scenes.stop(key);
    }
    if (scenes.isSleeping('camp')) scenes.wake('camp');
    else if (!scenes.isActive('camp')) scenes.start('camp');
    scenes.getScene('camp').input.enabled = true;
  }

  showStation(sceneKey: string, stationId: string): void {
    const scenes = this.#game.scene;
    if (scenes.isActive('warchest')) scenes.stop('warchest');
    if (scenes.isActive('camp')) scenes.sleep('camp');
    scenes.start(sceneKey, { stationId });
  }

  showWarchest(): void {
    const scenes = this.#game.scene;
    scenes.getScene('camp').input.enabled = false;
    scenes.start('warchest');
  }

  start(): void {
    // The container was hidden, so pick up any size change from while it was away. A resize while
    // hidden measured it as 0×0: measure again now it's visible, or refresh keeps the 0.
    const scale = this.#game.scale;
    scale.getParentBounds();
    scale.refresh();
    this.#game.resume();
  }

  stop(): void {
    this.#game.pause();
  }
}
