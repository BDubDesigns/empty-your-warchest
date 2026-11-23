import type { WarchestRow } from '../camp/warchestRows';
import type { ScreenPoint } from './warchestHud';

/** How long the panel takes to fold back into the chest, in ms (matches the CSS). */
export const PANEL_CLOSE_MS = 180;
/** When each row's count starts and how long it takes to tick up, in ms. */
const ROW_DELAY = 120;
const ROW_STAGGER = 45;
const COUNT_UP = 420;

interface ShownRow {
  element: HTMLElement;
  detail: HTMLElement;
  /** The count text it ends on; every number in it ticks up from 0. */
  value: string;
}

/**
 * The warchest's contents over a station: a panel that bursts out of the HUD chest, rows sliding
 * in one after another with their counts ticking up, and folds back into the chest on close.
 * Counts stay live while it's open. Any station's HUD chest can open it.
 */
export class WarchestPanel {
  readonly #overlay: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #list: HTMLElement;
  readonly #burst: HTMLElement;
  readonly #highlight: string | undefined;
  #rows = new Map<string, ShownRow>();
  #openedAt = 0;
  #countUp = 0;
  #hideTimer: number | undefined;

  constructor(parent: HTMLElement, options: { onClose: () => void; highlight?: string }) {
    this.#highlight = options.highlight;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };
    this.#overlay = el('div', 'warchest-overlay');
    this.#overlay.hidden = true;
    const backdrop = el('div', 'warchest-backdrop');
    this.#burst = el('div', 'warchest-burst');
    this.#panel = el('div', 'warchest-panel');
    this.#panel.setAttribute('role', 'dialog');
    this.#panel.setAttribute('aria-label', 'Warchest');
    this.#list = el('ul', 'warchest-rows');
    const close = el('button', 'warchest-close', 'Close');
    close.type = 'button';
    this.#panel.append(el('h2', 'warchest-title', 'Warchest'), this.#list, close);
    this.#overlay.append(backdrop, this.#burst, this.#panel);
    parent.append(this.#overlay);
    // Tapping outside the panel, or Close, folds it away.
    for (const target of [backdrop, close]) {
      target.addEventListener('click', () => {
        options.onClose();
      });
    }
  }

  get isOpen(): boolean {
    return this.#overlay.dataset.state === 'open';
  }

  /** Bursts the panel out of the chest at `from` (the chest's centre on screen). */
  open(rows: WarchestRow[], from: ScreenPoint): void {
    window.clearTimeout(this.#hideTimer);
    this.#overlay.hidden = false;
    this.#overlay.dataset.state = '';
    this.#build(rows);
    this.#panel.style.transformOrigin = `${String(from.x - this.#panel.offsetLeft)}px ${String(
      from.y - this.#panel.offsetTop,
    )}px`;
    Object.assign(this.#burst.style, { left: `${String(from.x)}px`, top: `${String(from.y)}px` });
    // Lay out closed first, so the open state animates.
    this.#overlay.getBoundingClientRect();
    this.#overlay.dataset.state = 'open';
    this.#openedAt = performance.now();
    cancelAnimationFrame(this.#countUp);
    this.#tick();
  }

  /** Shows new counts while open, popping any row that changed. */
  update(rows: WarchestRow[]): void {
    if (!this.isOpen) return;
    for (const row of rows) {
      const shown = this.#rows.get(row.item);
      if (!shown || shown.value === row.detail) continue;
      shown.value = row.detail;
      shown.detail.textContent = row.detail;
      shown.element.classList.remove('warchest-row-pop');
      shown.element.getBoundingClientRect();
      shown.element.classList.add('warchest-row-pop');
    }
  }

  /** Folds the panel back into the chest. */
  close(): void {
    if (!this.isOpen) return;
    this.#overlay.dataset.state = 'closing';
    cancelAnimationFrame(this.#countUp);
    this.#hideTimer = window.setTimeout(() => {
      this.#overlay.hidden = true;
    }, PANEL_CLOSE_MS);
  }

  /** Gone at once, e.g. when leaving the station. */
  hide(): void {
    window.clearTimeout(this.#hideTimer);
    cancelAnimationFrame(this.#countUp);
    this.#overlay.dataset.state = '';
    this.#overlay.hidden = true;
  }

  #build(rows: WarchestRow[]): void {
    this.#list.replaceChildren();
    this.#rows.clear();
    rows.forEach((row, index) => {
      const element = document.createElement('li');
      element.className = 'warchest-row';
      if (row.item === this.#highlight) element.classList.add('warchest-row-here');
      element.style.setProperty('--i', String(index));
      const name = document.createElement('span');
      name.className = 'warchest-row-name';
      name.textContent = row.name;
      const detail = document.createElement('span');
      detail.className = 'warchest-row-detail';
      element.append(name, detail);
      this.#list.append(element);
      this.#rows.set(row.item, { element, detail, value: row.detail });
    });
  }

  /** Ticks every count up from 0, each row starting a little after the one above. */
  #tick(): void {
    const elapsed = performance.now() - this.#openedAt;
    let done = true;
    let index = 0;
    for (const row of this.#rows.values()) {
      const p = Math.min(Math.max((elapsed - ROW_DELAY - index * ROW_STAGGER) / COUNT_UP, 0), 1);
      if (p < 1) done = false;
      const eased = 1 - (1 - p) ** 3;
      row.detail.textContent = row.value.replace(/\d+/g, (digits) =>
        String(Math.round(Number(digits) * eased)),
      );
      index += 1;
    }
    if (!done) {
      this.#countUp = requestAnimationFrame(() => {
        this.#tick();
      });
    }
  }
}
