import * as Phaser from 'phaser';
import { onResize, onTap, text } from '../app/phaserUi';
import { theme } from '../app/theme';
import type { Game } from '../core';
import { campSpots, type CampSpot } from './layout';

export interface CampDeps {
  game: Game;
  onStationTap: (stationId: string) => void;
  onChestTap: () => void;
}

const TILE_HEIGHT = 96;

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
    // Idle progress, filled in by M6.
    const idleTrack = this.add.rectangle(0, 0, 10, 6).setStrokeStyle(1, theme.mutedHex, 0.6);
    const container = this.add.container(0, 0, [plate, name, detail, idleTrack]);
    if (isChest) idleTrack.setVisible(false);

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
        name.setPosition(0, -22);
        detail.setPosition(0, 4);
        idleTrack.setSize(width - 32, 6).setPosition(0, 30);
      },
      refresh: () => {
        if (spot.kind === 'chest') {
          const total = game.inventory.stacks().reduce((sum, stack) => sum + stack.count, 0);
          detail.setText(total === 0 ? 'Empty' : `${total} item${total === 1 ? '' : 's'}`);
        } else {
          detail.setText(`${spot.skillName} · Lv ${game.level(spot.skill)}`);
        }
      },
    };
  }
}
