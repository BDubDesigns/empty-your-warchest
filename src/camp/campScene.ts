import * as Phaser from 'phaser';
import type { Haptics } from '../app/haptics';
import { itemText } from '../app/itemText';
import { onResize, onTap, text } from '../app/phaserUi';
import { Sfx } from '../app/sfx';
import { theme } from '../app/theme';
import { splitDeposit } from '../app/warchestPour';
import { workerRate, type Game, type Stack } from '../core';
import { campSpots, type CampSpot } from './layout';

export interface CampDeps {
  game: Game;
  haptics: Haptics;
  onStationTap: (stationId: string) => void;
  onChestTap: () => void;
}

const TILE_HEIGHT = 140;
/** The − and + buttons that move workers on and off a station, and the Collect button. */
const WORKER_BUTTON = 44;
const COLLECT_HEIGHT = 30;
/** How high a poured piece arcs over the straight line to the chest, in pixels. */
const POUR_ARC = 110;
const SOUNDS = Object.fromEntries(
  ['log-in-1', 'log-in-2', 'log-in-3', 'chest-latch'].map((name) => [
    name,
    `audio/warchest/${name}.mp3`,
  ]),
);
/** How each item looks flying into the chest: width, height and colour. */
const PIECES: Record<string, { width: number; height: number; color: number }> = {
  log: { width: 24, height: 10, color: 0x8b5a2b },
  stave: { width: 28, height: 5, color: 0xd9b27c },
  spear: { width: 34, height: 4, color: 0xc9cdd2 },
};
const PIECE = { width: 12, height: 12, color: theme.accentHex };

type Tile = ReturnType<CampScene['tile']> & { spot: CampSpot };

/** The top-down camp hub: one tile per station from data, plus the chest. */
export class CampScene extends Phaser.Scene {
  readonly #deps: CampDeps;
  readonly #sfx = new Sfx();
  #tiles: Tile[] = [];
  /** Items flying into the chest: the chest's count holds them back until each lands. */
  #inFlight = 0;

  constructor(deps: CampDeps) {
    super('camp');
    this.#deps = deps;
    this.#sfx.load(SOUNDS);
  }

  create(): void {
    const { game } = this.#deps;
    this.cameras.main.setBackgroundColor(theme.ground);
    const title = text(this, 'Camp', { fontSize: '14px', color: theme.muted });

    this.#tiles = campSpots(game.data).map((spot) => ({ spot, ...this.tile(spot) }));
    const refresh = (): void => {
      const free = game.freeWorkers;
      title.setText(free > 0 ? `Camp · 👷 ${String(free)} free` : 'Camp');
      for (const tile of this.#tiles) tile.refresh();
    };
    refresh();
    const unsubscribe = game.onChange(refresh);
    this.events.on(Phaser.Scenes.Events.WAKE, refresh);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    onResize(this, (width, height) => {
      title.setPosition(width / 2, 28);
      const tileWidth = Math.min(width * 0.38, 160);
      for (const tile of this.#tiles) {
        tile.container.setPosition(tile.spot.x * width, tile.spot.y * height);
        tile.resize(tileWidth);
      }
    });
  }

  /** A tile: a station (its level, its workers and what they've made), or the chest. */
  tile(spot: CampSpot) {
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
    // The station's workers: what they make a minute, − / + to move them on and off, and a
    // Collect button for what they've made.
    const rate = spot.kind === 'station' ? workerRate(game.data, spot.id) : undefined;
    const output = text(this, '', { fontSize: '12px', color: theme.fg });
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
    const collectPlate = this.add.rectangle(0, 0, 10, COLLECT_HEIGHT, theme.accentHex);
    const collectLabel = text(this, '', {
      fontSize: '13px',
      fontStyle: 'bold',
      color: theme.bg,
    });
    onTap(collectPlate, theme.accentHex, theme.accentPressedHex, () => {
      if (spot.kind === 'station') this.#collect(spot.id, collectPlate);
    });
    const workerParts = [output, crew, less.plate, less.glyph, more.plate, more.glyph];
    const container = this.add.container(0, 0, [
      plate,
      name,
      detail,
      ...workerParts,
      collectPlate,
      collectLabel,
    ]);
    if (!rate) for (const part of workerParts) part.setVisible(false);
    // Only stations have piles to collect.
    collectPlate.setVisible(false);
    collectLabel.setVisible(false);

    onTap(plate, fill, isChest ? theme.chestPressedHex : theme.tilePressedHex, () => {
      if (spot.kind === 'chest') this.#deps.onChestTap();
      else this.#deps.onStationTap(spot.id);
    });

    return {
      container,
      plate,
      resize: (width: number) => {
        plate.setSize(width, TILE_HEIGHT);
        // The tap area was sized when the tile was made; grow it with the tile.
        (plate.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setSize(width, TILE_HEIGHT);
        const centred = !rate;
        name.setPosition(0, centred ? -12 : -52);
        detail.setPosition(0, centred ? 14 : -32);
        output.setPosition(0, -14);
        collectPlate.setSize(width - 16, COLLECT_HEIGHT).setPosition(0, 12);
        (collectPlate.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setSize(
          width - 16,
          COLLECT_HEIGHT,
        );
        collectLabel.setPosition(0, 12);
        crew.setPosition(0, 47);
        const side = width / 2 - WORKER_BUTTON / 2 - 6;
        for (const [part, x] of [
          [less, -side],
          [more, side],
        ] as const) {
          part.plate.setPosition(x, 47);
          part.glyph.setPosition(x, 46);
        }
      },
      refresh: () => {
        if (spot.kind === 'chest') {
          const total =
            game.inventory.stacks().reduce((sum, stack) => sum + stack.count, 0) - this.#inFlight;
          detail.setText(total === 0 ? 'Empty' : `${String(total)} item${total === 1 ? '' : 's'}`);
          return;
        }
        detail.setText(`${spot.skillName} · Lv ${String(game.level(spot.skill))}`);
        const pile = game.pile(spot.id).filter((stack) => stack.count > 0);
        collectPlate.setVisible(pile.length > 0);
        collectLabel.setVisible(pile.length > 0);
        collectLabel.setText(
          `Collect ${pile.map((stack) => itemText(game.data, stack.item, stack.count)).join(', ')}`,
        );
        if (!rate) return;
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
      },
    };
  }

  /** Collects a station's pile and pours it into the chest, piece by piece. */
  #collect(stationId: string, from: Phaser.GameObjects.Rectangle): void {
    const { game } = this.#deps;
    this.#sfx.unlock();
    const items = game.pile(stationId).filter((stack) => stack.count > 0);
    const held = items.reduce((sum, stack) => sum + stack.count, 0);
    // Held back first, so the chest's count starts where it was and ticks up as pieces land.
    this.#inFlight += held;
    const collected = game.collect(stationId).items;
    this.#pour(collected, from);
  }

  #pour(items: readonly Stack[], from: Phaser.GameObjects.Rectangle): void {
    const chest = this.#tiles.find((tile) => tile.spot.kind === 'chest');
    if (!chest) return;
    const { pour } = this.#deps.game.data.workers;
    const start = from.getWorldTransformMatrix();
    const end = chest.plate.getWorldTransformMatrix();
    let delay = 0;
    for (const stack of items) {
      const look = PIECES[stack.item] ?? PIECE;
      for (const piece of splitDeposit(stack.count, 1, pour.maxPieces, pour.staggerSeconds)) {
        this.#fly(
          look,
          { x: start.tx + (Math.random() - 0.5) * 40, y: start.ty },
          { x: end.tx + (Math.random() - 0.5) * 30, y: end.ty - 10 },
          (delay + piece.delay) * 1000,
          () => {
            this.#inFlight -= piece.share;
            this.#landed(chest);
          },
        );
      }
      delay += Math.min(stack.count, pour.maxPieces) * pour.staggerSeconds;
    }
  }

  /** One piece arcing from `a` to `b`, spinning as it goes. */
  #fly(
    look: { width: number; height: number; color: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
    delayMs: number,
    onLand: () => void,
  ): void {
    const { pour } = this.#deps.game.data.workers;
    const piece = this.add.rectangle(a.x, a.y, look.width, look.height, look.color);
    piece.setStrokeStyle(1, 0x000000, 0.35).setVisible(false).setDepth(10);
    const spin = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3);
    const arc = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - POUR_ARC };
    this.tweens.addCounter({
      from: 0,
      to: 1,
      delay: delayMs,
      duration: pour.flightSeconds * 1000,
      ease: 'Sine.easeIn',
      onStart: () => piece.setVisible(true),
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        // A quadratic curve up over the camp and down into the chest.
        const u = 1 - t;
        piece.setPosition(
          u * u * a.x + 2 * u * t * arc.x + t * t * b.x,
          u * u * a.y + 2 * u * t * arc.y + t * t * b.y,
        );
        piece.setRotation(spin * t);
        piece.setScale(1 - 0.35 * t);
      },
      onComplete: () => {
        piece.destroy();
        onLand();
      },
    });
  }

  /** A piece lands in the chest: a thunk, a buzz, a bounce and the count ticks up. */
  #landed(chest: Tile): void {
    const { haptics, game } = this.#deps;
    this.#sfx.play(`log-in-${String(1 + Math.floor(Math.random() * 3))}`, 0.4, Math.random() * 300);
    haptics.pulse(game.data.workers.pour.buzzMs);
    chest.refresh();
    this.tweens.killTweensOf(chest.container);
    chest.container.setScale(1.06);
    this.tweens.add({ targets: chest.container, scale: 1, duration: 160, ease: 'Back.easeOut' });
    if (this.#inFlight === 0) this.#sfx.play('chest-latch', 0.5);
  }
}
