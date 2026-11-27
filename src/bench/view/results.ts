import {
  resultColumns,
  resultsText,
  summaryColumns,
  summaryTitle,
  type ResultRow,
} from '../logic/results';

// The stress test's results, three ways out. On a phone the summary: the device line, then a
// small card a run with the numbers that matter, under headings that stay in view as it scrolls,
// so a couple of screenshots carry a whole Run all (on BrowserStack, screenshots are what reliably
// get back to a PC). The full table, every column, behind a toggle (it scrolls sideways on a
// phone). "Copy as text": the full table, tab-separated, for a spreadsheet. And "Send results":
// the whole log (every run is in it as bench.result) posted to /api/logs, as Debug → Send logs.

type Props<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & {
  dataset?: Record<string, string>;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(element, rest);
  if (dataset) Object.assign(element.dataset, dataset);
  element.append(...children);
  return element;
}

type View = 'summary' | 'table';

export class BenchResults {
  /** Everything: the device line, the view toggle and copy button, and the results. */
  readonly element: HTMLElement;
  readonly #device: HTMLElement;
  readonly #summary: HTMLTableElement;
  readonly #table: HTMLElement;
  readonly #tableBody: HTMLTableSectionElement;
  readonly #fallback: HTMLTextAreaElement;
  readonly #buttons: { button: HTMLButtonElement; view: View }[];
  readonly #say: (text: string) => void;
  readonly #rows: ResultRow[] = [];
  #view: View;

  /**
   * Opens as the summary on screens up to `summaryUpToPx` wide; `say` shows a status line, and
   * `send` sends the log (Send results), resolving once it's done.
   */
  constructor(summaryUpToPx: number, say: (text: string) => void, send: () => Promise<void>) {
    this.#say = say;
    this.#view = window.matchMedia(`(max-width: ${String(summaryUpToPx)}px)`).matches
      ? 'summary'
      : 'table';
    this.#device = el('p', { className: 'bench-device' });

    this.#summary = el('table', { className: 'bench-summary' }, [
      el(
        'colgroup',
        {},
        summaryColumns.map(() => el('col')),
      ),
      el('thead', {}, [
        el(
          'tr',
          {},
          summaryColumns.map((column) =>
            el('th', { scope: 'col' }, [
              column.label,
              ...(column.unit ? [el('span', { textContent: column.unit })] : []),
            ]),
          ),
        ),
      ]),
    ]);

    this.#tableBody = el('tbody');
    this.#table = el('div', { className: 'bench-table' }, [
      el('table', {}, [
        el('thead', {}, [
          el(
            'tr',
            {},
            resultColumns.map((column) => el('th', { textContent: column.label })),
          ),
        ]),
        this.#tableBody,
      ]),
    ]);

    this.#buttons = (
      [
        { label: 'Summary', view: 'summary' },
        { label: 'Full table', view: 'table' },
      ] as const
    ).map(({ label, view }) => {
      const button = el('button', { type: 'button', textContent: label });
      button.addEventListener('click', () => {
        this.#view = view;
        this.#show();
      });
      return { button, view };
    });
    const copy = el('button', { type: 'button', textContent: 'Copy as text' });
    copy.addEventListener('click', () => {
      void this.#copy();
    });
    const sendButton = el('button', { type: 'button', textContent: 'Send results' });
    sendButton.addEventListener('click', () => {
      sendButton.disabled = true;
      void send().finally(() => {
        sendButton.disabled = false;
      });
    });
    this.#fallback = el('textarea', {
      className: 'bench-copy',
      readOnly: true,
      hidden: true,
      ariaLabel: 'Results as text',
    });

    this.element = el('section', { className: 'bench-results', ariaLabel: 'Results' }, [
      this.#device,
      el('div', { className: 'bench-row' }, [
        el(
          'div',
          { className: 'bench-row', role: 'group', ariaLabel: 'Results view' },
          this.#buttons.map(({ button }) => button),
        ),
        copy,
        sendButton,
      ]),
      this.#fallback,
      this.#summary,
      this.#table,
    ]);
    this.#show();
  }

  /** The device and build, shown above the results and first in the copied text. */
  set device(text: string) {
    this.#device.textContent = text;
  }

  add(row: ResultRow, pack: string): void {
    this.#rows.push(row);
    this.#tableBody.append(
      el(
        'tr',
        { dataset: { pack } },
        resultColumns.map((column) => el('td', { textContent: row[column.key] })),
      ),
    );
    // One tbody a run, so each run's title and numbers are shaded together.
    this.#summary.append(
      el('tbody', { dataset: { pack } }, [
        el('tr', {}, [
          el('th', {
            scope: 'rowgroup',
            colSpan: summaryColumns.length,
            textContent: summaryTitle(row),
          }),
        ]),
        el(
          'tr',
          {},
          summaryColumns.map((column) => el('td', { textContent: row[column.key] })),
        ),
      ]),
    );
  }

  #show(): void {
    this.#summary.hidden = this.#view !== 'summary';
    this.#table.hidden = this.#view !== 'table';
    for (const { button, view } of this.#buttons) {
      button.setAttribute('aria-pressed', String(view === this.#view));
    }
  }

  async #copy(): Promise<void> {
    const text = resultsText(this.#device.textContent, this.#rows);
    const runs = `${String(this.#rows.length)} run${this.#rows.length === 1 ? '' : 's'}`;
    try {
      await navigator.clipboard.writeText(text);
      this.#fallback.hidden = true;
      this.#say(`Copied ${runs} as tab-separated text`);
    } catch {
      // No clipboard (not allowed, or not a secure page): the text to select and copy by hand.
      this.#fallback.value = text;
      this.#fallback.hidden = false;
      this.#fallback.focus();
      this.#fallback.select();
      this.#say(`Couldn't copy: ${runs} are in the box below to select and copy`);
    }
  }
}
