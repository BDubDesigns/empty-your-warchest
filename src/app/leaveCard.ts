import type { LeavePrompt } from './leaveGuard';

/** The "Leave this round?" card, over whatever screen is up. Built once, shown by the guard. */
export class LeaveCard implements LeavePrompt {
  readonly #root: HTMLElement;
  readonly #text: HTMLElement;
  readonly #keep: HTMLButtonElement;
  #answer: ((leave: boolean) => void) | undefined;

  constructor(parent: HTMLElement) {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };
    this.#root = make('div', 'leave-layer');
    this.#root.hidden = true;
    const card = make('div', 'leave-card');
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-label', 'Leave this round?');
    const title = make('div', 'leave-title', 'Leave this round?');
    this.#text = make('div', 'leave-text');
    const buttons = make('div', 'leave-buttons');
    this.#keep = make('button', 'leave-button', 'Keep playing');
    this.#keep.type = 'button';
    const leave = make('button', 'leave-button leave-secondary', 'Leave');
    leave.type = 'button';
    this.#keep.addEventListener('click', () => this.#answer?.(false));
    leave.addEventListener('click', () => this.#answer?.(true));
    buttons.append(this.#keep, leave);
    card.append(title, this.#text, buttons);
    this.#root.append(card);
    this.#root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.#answer?.(false);
    });
    parent.append(this.#root);
  }

  show(cost: string, answer: (leave: boolean) => void): void {
    this.#answer = answer;
    this.#text.textContent = cost;
    this.#root.hidden = false;
    this.#keep.focus();
  }

  hide(): void {
    this.#answer = undefined;
    this.#root.hidden = true;
  }
}
