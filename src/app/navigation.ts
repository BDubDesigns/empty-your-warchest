import type { Clock, EventLogger } from '../core';
import { byId, type GameData } from '../data';
import { mechanicFor } from '../stations';

export type View = { kind: 'camp' } | { kind: 'warchest' } | { kind: 'station'; stationId: string };

/** What navigation asks the screens to do. */
export interface NavigationTargets {
  showCamp(): Promise<void>;
  showWarchest(): Promise<void>;
  showPhaserStation(sceneKey: string, stationId: string): Promise<void>;
  showThreeStation(stationId: string): Promise<void>;
}

/**
 * Moves between the camp, the warchest view and the stations, and logs where the
 * player goes and for how long.
 */
export class Navigation {
  readonly #data: GameData;
  readonly #logger: EventLogger;
  readonly #clock: Clock;
  readonly #targets: NavigationTargets;
  readonly #onView: (view: View) => void;
  #view: View = { kind: 'camp' };
  #enteredAt = 0;

  constructor(
    data: GameData,
    logger: EventLogger,
    clock: Clock,
    targets: NavigationTargets,
    onView: (view: View) => void = () => undefined,
  ) {
    this.#data = data;
    this.#logger = logger;
    this.#clock = clock;
    this.#targets = targets;
    this.#onView = onView;
  }

  get view(): View {
    return this.#view;
  }

  /** Shows the camp for the first time. */
  async start(): Promise<void> {
    await this.#targets.showCamp();
    this.#enter({ kind: 'camp' });
  }

  async openStation(stationId: string): Promise<void> {
    if (this.#view.kind !== 'camp') return;
    const station = byId(this.#data.stations, stationId);
    const { screen } = mechanicFor(station.mechanic);
    if (screen.kind === 'phaser') await this.#targets.showPhaserStation(screen.scene, station.id);
    else await this.#targets.showThreeStation(station.id);
    this.#enter({ kind: 'station', stationId: station.id });
  }

  async openWarchest(): Promise<void> {
    if (this.#view.kind !== 'camp') return;
    await this.#targets.showWarchest();
    this.#enter({ kind: 'warchest' });
  }

  /** Back to the camp from a station or the warchest view. */
  async back(): Promise<void> {
    if (this.#view.kind === 'camp') return;
    await this.#targets.showCamp();
    this.#enter({ kind: 'camp' });
  }

  #enter(view: View): void {
    const now = this.#clock.now();
    const seconds = Math.round((now - this.#enteredAt) / 100) / 10;
    const previous = this.#view;
    if (previous.kind === 'station') {
      this.#logger.log('station.exit', { station: previous.stationId, seconds });
    } else if (previous.kind === 'warchest') {
      this.#logger.log('warchest.close', { seconds });
    }
    if (view.kind === 'station') this.#logger.log('station.enter', { station: view.stationId });
    else if (view.kind === 'warchest') this.#logger.log('warchest.open');
    else this.#logger.log('camp.enter');
    this.#view = view;
    this.#enteredAt = now;
    this.#onView(view);
  }
}
