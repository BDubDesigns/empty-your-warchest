import type { Game } from '../core';

/** How long the fill takes to slide to a new width: matches `.skill-bar-fill`'s transition. */
const FILL_MS = 250;

export interface SkillBarDeps {
  game: Game;
  /** The skill this station trains. */
  skill: string;
}

/** XP already in the save that the bar holds back until whatever earned it arrives on screen. */
export interface XpDeposit {
  /** Another `share` (0 to 1) of what earned it has arrived, e.g. a piece landing in the chest. */
  arrive(share: number): void;
}

/**
 * A station's level bar, top centre: the skill, its level and the bar to the next one, always in
 * view so the player watches it climb. XP held back by a deposit ticks in as what earned it
 * arrives (each log landing in the chest), with an XP drop floating up into the bar; filling it
 * flashes the bar and bumps the level. Shared by every station.
 */
export class SkillBar {
  readonly #game: Game;
  readonly #skill: string;
  readonly #root: HTMLElement;
  readonly #level: HTMLElement;
  readonly #fill: HTMLElement;
  readonly #drop: HTMLElement;
  readonly #unsubscribe: () => void;
  /** XP in the save the bar doesn't show yet. */
  #held = 0;
  #shownLevel = 0;
  /** A level-up is filling the bar to the end; the next render waits for it. */
  #levelTimer: number | undefined;

  constructor(element: HTMLElement, deps: SkillBarDeps) {
    this.#game = deps.game;
    this.#skill = deps.skill;
    const el = (className: string) => {
      const node = document.createElement('div');
      node.className = className;
      return node;
    };
    this.#root = el('skill-bar');
    const label = el('skill-bar-label');
    const name = document.createElement('span');
    name.textContent =
      deps.game.data.skills.find((skill) => skill.id === deps.skill)?.name ?? deps.skill;
    this.#level = document.createElement('span');
    this.#level.className = 'skill-bar-level';
    label.append(name, ' ', this.#level);
    const track = el('skill-bar-track');
    this.#fill = el('skill-bar-fill');
    track.append(this.#fill);
    this.#drop = el('skill-bar-drop');
    this.#root.append(label, track, this.#drop);
    element.append(this.#root);
    // After the change, not during it: whatever earned the XP holds it back straight after.
    this.#unsubscribe = this.#game.onChange(() => {
      queueMicrotask(() => {
        this.#render();
      });
    });
    this.#render();
  }

  /**
   * Call when `xp` has just gone into the save: the bar holds it back, and ticks it in as the
   * deposit says what earned it has arrived.
   */
  hold(xp: number): XpDeposit {
    if (xp <= 0) return { arrive: () => undefined };
    this.#held += xp;
    this.#render();
    let left = xp;
    let arrived = 0;
    return {
      arrive: (share) => {
        if (left <= 0) return;
        if (arrived === 0) this.#showDrop(xp);
        arrived += share;
        // The last piece releases whatever rounding left over.
        const amount = arrived >= 0.999 ? left : Math.min(Math.round(xp * share), left);
        left -= amount;
        this.#held = Math.max(this.#held - amount, 0);
        this.#render();
      },
    };
  }

  /** Shows all the XP at once, with nothing held back (e.g. leaving the station). */
  settle(): void {
    this.#held = 0;
    window.clearTimeout(this.#levelTimer);
    this.#levelTimer = undefined;
    this.#shownLevel = 0;
    this.#render();
  }

  dispose(): void {
    this.#unsubscribe();
    window.clearTimeout(this.#levelTimer);
  }

  #render(): void {
    if (this.#levelTimer !== undefined) return;
    const curve = this.#game.xpCurve;
    const xp = Math.max(this.#game.xp(this.#skill) - this.#held, 0);
    const level = curve.levelForXp(xp);
    this.#root.dataset.level = String(level);
    this.#root.dataset.xp = String(xp);
    if (this.#shownLevel > 0 && level > this.#shownLevel) {
      // Fill to the end, then flash, bump the level and start the next bar from empty.
      this.#fill.style.width = '100%';
      this.#levelTimer = window.setTimeout(() => {
        this.#levelTimer = undefined;
        this.#shownLevel = level;
        this.#level.textContent = String(level);
        this.#fill.classList.add('skill-bar-snap');
        this.#fill.style.width = '0%';
        this.#fill.getBoundingClientRect();
        this.#fill.classList.remove('skill-bar-snap');
        this.#root.classList.remove('skill-bar-up');
        this.#root.getBoundingClientRect();
        this.#root.classList.add('skill-bar-up');
        this.#render();
      }, FILL_MS);
      return;
    }
    this.#shownLevel = level;
    this.#level.textContent = String(level);
    const floor = curve.xpForLevel(level);
    const share =
      level >= curve.maxLevel ? 1 : (xp - floor) / (curve.xpForLevel(level + 1) - floor);
    this.#fill.style.width = `${String(Math.round(share * 1000) / 10)}%`;
  }

  #showDrop(xp: number): void {
    this.#drop.textContent = `+${xp.toLocaleString()} XP`;
    this.#drop.classList.remove('skill-bar-drop-show');
    this.#drop.getBoundingClientRect();
    this.#drop.classList.add('skill-bar-drop-show');
  }
}
