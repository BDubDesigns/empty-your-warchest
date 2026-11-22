import * as Phaser from 'phaser';
import { onResize, text } from '../app/phaserUi';
import { theme } from '../app/theme';
import type { Game } from '../core';
import { byId } from '../data';
import { mechanicFor, PLACEHOLDER_SCENE } from './registry';

/** Stands in for a station whose mini game isn't built yet. The shell's back button returns to camp. */
export class StationPlaceholderScene extends Phaser.Scene {
  readonly #game: Game;
  #stationId = '';

  constructor(game: Game) {
    super(PLACEHOLDER_SCENE);
    this.#game = game;
  }

  init(data: { stationId: string }): void {
    this.#stationId = data.stationId;
  }

  create(): void {
    const station = byId(this.#game.data.stations, this.#stationId);
    const skill = byId(this.#game.data.skills, station.skill);
    this.cameras.main.setBackgroundColor(theme.bg);

    const name = text(this, station.name, { fontSize: '28px', fontStyle: 'bold' });
    const level = text(this, `${skill.name} · Lv ${this.#game.level(skill.id)}`, {
      fontSize: '17px',
      color: theme.muted,
    });
    const note = text(this, mechanicFor(station.mechanic).placeholderNote ?? '', {
      fontSize: '16px',
      color: theme.muted,
    });

    onResize(this, (width, height) => {
      name.setPosition(width / 2, height * 0.4);
      level.setPosition(width / 2, height * 0.4 + 40);
      note.setPosition(width / 2, height * 0.4 + 80);
    });
  }
}
