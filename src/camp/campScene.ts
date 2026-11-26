import * as Phaser from 'phaser';
import { itemText } from '../app/itemText';
import { onResize, onTap, text } from '../app/phaserUi';
import { theme } from '../app/theme';
import { workerRate, type Game } from '../core';
import { campSpots, type CampSpot } from './layout';

export interface CampDeps {
  game: Game;
  onStationTap: (stationId: string) => void;
  onChestTap: () => void;
}

const TILE_HEIGHT = 124;
/** The − and + buttons that move workers on and off a station. */
const WORKER_BUTTON = 44;

/** The top-down camp hub: one tile per station from data, plus the chest. */
export class CampScene extends Phaser.Scene {
  readonly #deps: CampDeps;

  constructor(deps: CampDeps) {
    super('camp');
    this.#deps = deps;
  }

  create(): void {
    const { game } = this.#deps;
    this.cameras.main.setBackgroundColor(theme.ground);
    const title = text(this, 'Camp', { fontSize: '14px', color: theme.muted });

    const tiles = campSpots(game.data).map((spot) => ({ spot, ...this.#tile(spot) }));
    const refresh = (): void => {
      const free = game.freeWorkers;
      title.setText(free > 0 ? `Camp · 👷 ${String(free)} free` : 'Camp');
      for (const tile of tiles) tile.refresh();
    };
    refresh();
    const unsubscribe = game.onChange(refresh);
    this.events.on(Phaser.Scenes.Events.WAKE, refresh);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    onResize(this, (width, height) => {
      title.setPosition(width / 2, 28);
      const tileWidth = Math.min(width * 0.38, 160);
      for (const tile of tiles) {
        tile.container.setPosition(tile.spot.x * width, tile.spot.y * height);
        tile.resize(tileWidth);
      }
    });
  }

  #tile(spot: CampSpot) {
    const { game } = this.#deps;
    const isChest = spot.kind === 'chest';
    const fill = isChest ? theme.chestHex : theme.tileHex;
    const plate = this.add
      .rectangle(0, 0, 10, TILE_HEIGHT, fill)
      .setStrokeStyle(2, theme.mutedHex, 0.4);
    const name = text(this, isChest ? 'Warchest' : spot.name, {
      fontSize: '17px',
      fontStyle: 'bold',
    });
    const detail = text(this, '', { fontSize: '13px', color: theme.muted });
    // The station's workers: what they make, and − / + to move them on and off.
    const rate = spot.kind === 'station' ? workerRate(game.data, spot.id) : undefined;
    const output = text(this, '', { fontSize: '13px', color: theme.fg });
    const crew = text(this, '', { fontSize: '16px', fontStyle: 'bold' });
    const button = (label: string, change: 1 | -1) => {
      const plateButton = this.add
        .rectangle(0, 0, WORKER_BUTTON, 34, theme.gridHex)
        .setStrokeStyle(1, theme.mutedHex, 0.6);
      const glyph = text(this, label, { fontSize: '20px', fontStyle: 'bold' });
      onTap(plateButton, theme.gridHex, theme.tilePressedHex, () => {
        if (spot.kind === 'station') game.assignWorker(spot.id, change);
      });
      return { plate: plateButton, glyph };
    };
    const less = button('−', -1);
    const more = button('+', 1);
    const workerParts = [output, crew, less.plate, less.glyph, more.plate, more.glyph];
    const container = this.add.container(0, 0, [plate, name, detail, ...workerParts]);
    if (!rate) for (const part of workerParts) part.setVisible(false);

    onTap(plate, fill, isChest ? theme.chestPressedHex : theme.tilePressedHex, () => {
      if (spot.kind === 'chest') this.#deps.onChestTap();
      else this.#deps.onStationTap(spot.id);
    });

    return {
      container,
      resize: (width: number) => {
        plate.setSize(width, TILE_HEIGHT);
        // The tap area was sized when the tile was made; grow it with the tile.
        (plate.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setSize(width, TILE_HEIGHT);
        const centred = !rate;
        name.setPosition(0, centred ? -12 : -42);
        detail.setPosition(0, centred ? 14 : -20);
        output.setPosition(0, 2);
        crew.setPosition(0, 36);
        const side = width / 2 - WORKER_BUTTON / 2 - 6;
        for (const [part, x] of [
          [less, -side],
          [more, side],
        ] as const) {
          part.plate.setPosition(x, 36);
          part.glyph.setPosition(x, 35);
        }
      },
      refresh: () => {
        if (spot.kind === 'chest') {
          const total = game.inventory.stacks().reduce((sum, stack) => sum + stack.count, 0);
          detail.setText(total === 0 ? 'Empty' : `${total} item${total === 1 ? '' : 's'}`);
        } else {
          detail.setText(`${spot.skillName} · Lv ${game.level(spot.skill)}`);
          if (rate) {
            const workers = game.crew(spot.id);
            crew.setText(`👷 ${String(workers)}`);
            output.setText(
              workers > 0
                ? `${itemText(game.data, rate.item, rate.count * workers)}/min`
                : 'No workers',
            );
            output.setColor(workers > 0 ? theme.fg : theme.muted);
            less.plate.setAlpha(workers > 0 ? 1 : 0.4);
            more.plate.setAlpha(game.freeWorkers > 0 ? 1 : 0.4);
          }
        }
      },
    };
  }
}
