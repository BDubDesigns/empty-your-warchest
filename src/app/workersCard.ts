import type { BankedWork, Game, Stack } from '../core';
import { byId } from '../data';
import { itemName, itemText } from './itemText';

/** How long the "workers made" note stays up, in ms. */
const TOAST_MS = 2600;

/**
 * What the workers banked, shown at the camp: a card after time away ("While you were away"),
 * or a short note after time spent playing.
 */
export class WorkersCard {
  readonly #game: Game;
  readonly #card: HTMLElement;
  readonly #title: HTMLElement;
  readonly #away: HTMLElement;
  readonly #list: HTMLElement;
  readonly #toast: HTMLElement;
  #toastTimer: number | undefined;

  constructor(parent: HTMLElement, game: Game) {
    this.#game = game;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };
    this.#card = el('div', 'work-card');
    this.#card.setAttribute('role', 'dialog');
    this.#card.setAttribute('aria-label', 'While you were away');
    this.#card.hidden = true;
    this.#title = el('h2', 'work-title', 'While you were away');
    this.#away = el('p', 'work-away');
    this.#list = el('ul', 'work-list');
    const ok = el('button', 'work-ok', 'Nice');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      this.#card.hidden = true;
    });
    this.#card.append(this.#title, this.#away, this.#list, ok);
    this.#toast = el('div', 'work-toast');
    this.#toast.hidden = true;
    parent.append(this.#card, this.#toast);
  }

  /** Shows what was banked: the card after time away, a note otherwise, nothing if nothing. */
  show(banked: BankedWork): void {
    const working = banked.result.stations.filter((station) => station.workers > 0);
    const made = working.flatMap((station) => station.made);
    if (banked.away >= this.#game.data.workers.cardMinutes) this.#showCard(banked);
    else if (made.length > 0) this.#showToast(made);
  }

  #showCard(banked: BankedWork): void {
    const { data } = this.#game;
    const cap = data.workers.awayCapMinutes;
    const away = `${minutesText(banked.awayReal)} away`;
    this.#away.textContent =
      banked.awayReal > cap + 0.5 ? `${away} · workers work ${minutesText(cap)} at most` : away;
    const rows = banked.result.stations.filter((station) => station.workers > 0);
    this.#list.replaceChildren(
      ...(rows.length === 0
        ? [listItem('No one was working. Put workers on stations at the camp.')]
        : rows.map((station) => {
            const name = byId(data.stations, station.station).name;
            const made =
              station.made.length > 0 ? `+${this.#stacksText(station.made)}` : 'nothing yet';
            const parts = [`${name} · 👷 ${String(station.workers)}: ${made}`];
            if (station.used.length > 0) parts.push(`used ${this.#stacksText(station.used)}`);
            if (station.xp > 0) parts.push(`+${String(station.xp)} XP`);
            if (station.short) parts.push(`ran short of ${itemName(data, station.short)}`);
            return listItem(parts.join(' · '));
          })),
    );
    this.#card.hidden = false;
  }

  /** "24 logs, 6 staves". */
  #stacksText(stacks: readonly Stack[]): string {
    return stacks.map((stack) => itemText(this.#game.data, stack.item, stack.count)).join(', ');
  }

  #showToast(made: Stack[]): void {
    window.clearTimeout(this.#toastTimer);
    this.#toast.textContent = `👷 Workers made +${this.#stacksText(merge(made))}`;
    this.#toast.hidden = false;
    this.#toastTimer = window.setTimeout(() => {
      this.#toast.hidden = true;
    }, TOAST_MS);
  }
}

function listItem(text: string): HTMLLIElement {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}

function minutesText(minutes: number): string {
  if (minutes < 60) return `${String(Math.max(Math.round(minutes), 1))} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  return rest > 0 ? `${String(hours)} h ${String(rest)} min` : `${String(hours)} h`;
}

function merge(stacks: readonly Stack[]): Stack[] {
  const merged: Stack[] = [];
  for (const stack of stacks) {
    const found = merged.find((entry) => entry.item === stack.item);
    if (found) found.count += stack.count;
    else merged.push({ ...stack });
  }
  return merged;
}
