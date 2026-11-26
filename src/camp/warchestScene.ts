import * as Phaser from 'phaser';
import { onResize, onTap, text } from '../app/phaserUi';
import { theme } from '../app/theme';
import { workerInputs, type Game } from '../core';
import { itemText } from '../app/itemText';
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

    // Items the workers use get a minimum: the workers never take them below it.
    const kept = new Set(workerInputs(game.data));
    const step = game.data.workers.minimumStep;
    const rows = warchestRows(game.data, game.inventory).map((row) => {
      const name = text(this, row.name, { fontSize: '17px', fontStyle: 'bold' }).setOrigin(0, 0.5);
      const detail = text(this, row.detail, { fontSize: '15px', color: theme.fg }).setOrigin(
        1,
        0.5,
      );
      if (!kept.has(row.item)) return { name, detail, height: 44 };
      const label = text(this, '', { fontSize: '13px', color: theme.muted }).setOrigin(0, 0.5);
      const button = (glyph: string, change: number) => {
        const plate = this.add
          .rectangle(0, 0, 44, 34, theme.gridHex)
          .setStrokeStyle(1, theme.mutedHex, 0.6);
        const mark = text(this, glyph, { fontSize: '20px', fontStyle: 'bold' });
        onTap(plate, theme.gridHex, theme.tilePressedHex, () => {
          game.setMinimum(row.item, game.minimum(row.item) + change);
        });
        return { plate, mark };
      };
      const less = button('−', -step);
      const more = button('+', step);
      const show = () => {
        label.setText(`Workers keep ${itemText(game.data, row.item, game.minimum(row.item))}`);
        less.plate.setAlpha(game.minimum(row.item) > 0 ? 1 : 0.4);
      };
      show();
      return { name, detail, height: 88, keep: { label, less, more, show } };
    });
    const unsubscribe = game.onChange(() => {
      for (const row of rows) row.keep?.show();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

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
      const panelHeight = 140 + rows.reduce((sum, row) => sum + row.height, 0);
      const top = Math.max(80, (height - panelHeight) / 2);
      panel.setSize(panelWidth, panelHeight).setPosition(width / 2, top + panelHeight / 2);
      title.setPosition(width / 2, top + 34);
      const left = width / 2 - panelWidth / 2 + 20;
      const right = width / 2 + panelWidth / 2 - 20;
      let y = top + 80;
      for (const row of rows) {
        row.name.setPosition(left, y);
        row.detail.setPosition(right, y);
        if (row.keep) {
          const keepY = y + 40;
          row.keep.label.setPosition(left, keepY);
          row.keep.less.plate.setPosition(right - 72, keepY);
          row.keep.less.mark.setPosition(right - 72, keepY - 1);
          row.keep.more.plate.setPosition(right - 22, keepY);
          row.keep.more.mark.setPosition(right - 22, keepY - 1);
        }
        y += row.height;
      }
      closePlate.setPosition(width / 2, top + panelHeight - 36);
      closeLabel.setPosition(width / 2, top + panelHeight - 36);
    });
  }
}
