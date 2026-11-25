import * as Phaser from 'phaser';
import { onResize, onTap, text } from '../app/phaserUi';
import { theme } from '../app/theme';
import type { Game } from '../core';
import { warchestRows } from './warchestRows';

export interface WarchestDeps {
  game: Game;
  onClose: () => void;
}

/** The warchest view: every item and its count, over the camp. */
export class WarchestScene extends Phaser.Scene {
  readonly #deps: WarchestDeps;

  constructor(deps: WarchestDeps) {
    super('warchest');
    this.#deps = deps;
  }

  create(): void {
    const { game } = this.#deps;
    // Dimmed with object alpha, so the tap feedback's fill reset keeps it see-through.
    const backdrop = this.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0).setAlpha(0.65);
    // Tapping outside the panel closes it.
    onTap(backdrop, 0x000000, 0x000000, () => {
      this.#deps.onClose();
    });
    const panel = this.add
      .rectangle(0, 0, 10, 10, theme.chestHex)
      .setStrokeStyle(2, theme.mutedHex, 0.6);
    panel.setInteractive(); // swallow taps so they don't reach the backdrop
    const title = text(this, 'Warchest', { fontSize: '22px', fontStyle: 'bold' });

    const rows = warchestRows(game.data, game.inventory).map((row) => ({
      name: text(this, row.name, { fontSize: '17px', fontStyle: 'bold' }).setOrigin(0, 0.5),
      detail: text(this, row.detail, { fontSize: '15px', color: theme.fg }).setOrigin(1, 0.5),
    }));

    const closePlate = this.add.rectangle(0, 0, 140, 48, theme.accentHex);
    const closeLabel = text(this, 'Close', {
      fontSize: '18px',
      fontStyle: 'bold',
      color: theme.bg,
    });
    onTap(closePlate, theme.accentHex, theme.accentPressedHex, () => {
      this.#deps.onClose();
    });

    onResize(this, (width, height) => {
      backdrop.setSize(width, height);
      const panelWidth = Math.min(width - 32, 380);
      const panelHeight = 140 + rows.length * 44;
      const top = Math.max(80, (height - panelHeight) / 2);
      panel.setSize(panelWidth, panelHeight).setPosition(width / 2, top + panelHeight / 2);
      title.setPosition(width / 2, top + 34);
      const left = width / 2 - panelWidth / 2 + 20;
      const right = width / 2 + panelWidth / 2 - 20;
      rows.forEach((row, index) => {
        const y = top + 80 + index * 44;
        row.name.setPosition(left, y);
        row.detail.setPosition(right, y);
      });
      closePlate.setPosition(width / 2, top + panelHeight - 36);
      closeLabel.setPosition(width / 2, top + panelHeight - 36);
    });
  }
}
