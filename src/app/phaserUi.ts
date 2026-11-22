import * as Phaser from 'phaser';
import { theme } from './theme';

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

/** Crisp text on high-density phone screens. */
export function text(
  scene: Phaser.Scene,
  content: string,
  style: TextStyle = {},
): Phaser.GameObjects.Text {
  return scene.add
    .text(0, 0, content, {
      fontFamily: theme.font,
      fontSize: '16px',
      color: theme.fg,
      resolution: window.devicePixelRatio,
      ...style,
    })
    .setOrigin(0.5);
}

/** Runs `layout` now and on every resize, and stops when the scene shuts down. */
export function onResize(
  scene: Phaser.Scene,
  layout: (width: number, height: number) => void,
): void {
  const run = (): void => {
    layout(scene.scale.width, scene.scale.height);
  };
  run();
  scene.scale.on(Phaser.Scale.Events.RESIZE, run);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, run);
  });
}

/** Calls `onTap` when a press starts and ends on `target`, with pressed feedback. */
export function onTap(
  target: Phaser.GameObjects.Shape,
  fill: number,
  pressedFill: number,
  handler: () => void,
): void {
  // Phaser reports a pointer lifting over the target even when the press started elsewhere
  // (e.g. on the debug panel above the canvas), so only count presses that began here.
  let pressed = false;
  target.setInteractive({ useHandCursor: true });
  target.on('pointerdown', () => {
    pressed = true;
    target.setFillStyle(pressedFill);
  });
  target.on('pointerout', () => {
    pressed = false;
    target.setFillStyle(fill);
  });
  target.on('pointerup', () => {
    target.setFillStyle(fill);
    if (!pressed) return;
    pressed = false;
    handler();
  });
}
