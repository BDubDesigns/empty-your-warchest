import * as Phaser from 'phaser';
import type { ScreenView } from './screen';
import { SWITCH_BUTTON_Y, theme } from './theme';

class ShellScene extends Phaser.Scene {
  readonly #onSwitch: () => void;

  constructor(onSwitch: () => void) {
    super('shell');
    this.#onSwitch = onSwitch;
  }

  create(): void {
    const resolution = window.devicePixelRatio;
    const title = this.add
      .text(0, 0, 'Empty Your Warchest', {
        fontFamily: theme.font,
        fontSize: '28px',
        color: theme.fg,
        resolution,
      })
      .setOrigin(0.5);
    const hint = this.add
      .text(0, 0, 'Phaser screen · tap anywhere', {
        fontFamily: theme.font,
        fontSize: '16px',
        color: theme.muted,
        resolution,
      })
      .setOrigin(0.5);

    const plate = this.add
      .rectangle(0, 0, 240, 64, theme.accentHex)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(0, 0, 'Open 3D view', {
        fontFamily: theme.font,
        fontSize: '20px',
        color: theme.bg,
        fontStyle: 'bold',
        resolution,
      })
      .setOrigin(0.5);
    const button = this.add.container(0, 0, [plate, label]);

    plate.on('pointerdown', () => plate.setFillStyle(theme.accentPressedHex));
    plate.on('pointerout', () => plate.setFillStyle(theme.accentHex));
    plate.on('pointerup', () => {
      plate.setFillStyle(theme.accentHex);
      this.#onSwitch();
    });

    // Tap ripples show that touch input reaches Phaser.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const ripple = this.add.circle(pointer.x, pointer.y, 12).setStrokeStyle(3, theme.fgHex);
      this.tweens.add({
        targets: ripple,
        scale: 4,
        alpha: 0,
        duration: 450,
        onComplete: () => {
          ripple.destroy();
        },
      });
    });

    const layout = (): void => {
      const { width, height } = this.scale;
      title.setPosition(width / 2, height * 0.3);
      hint.setPosition(width / 2, height * 0.3 + 40);
      button.setPosition(width / 2, height * SWITCH_BUTTON_Y);
    };
    layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, layout);
  }
}

export class PhaserView implements ScreenView {
  readonly #game: Phaser.Game;

  private constructor(game: Phaser.Game) {
    this.#game = game;
  }

  static create(element: HTMLElement, onSwitch: () => void): Promise<PhaserView> {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: element,
      backgroundColor: theme.bg,
      banner: false,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      scene: new ShellScene(onSwitch),
    });
    return new Promise((resolve) => {
      game.events.once(Phaser.Core.Events.READY, () => {
        resolve(new PhaserView(game));
      });
    });
  }

  start(): void {
    // The container was hidden, so pick up any size change from while it was away.
    this.#game.scale.refresh();
    this.#game.resume();
  }

  stop(): void {
    this.#game.pause();
  }
}
