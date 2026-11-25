import type { Choice, EventLogger, Game, LiveTuning, LogEvent, SaveStore } from '../core';
import type { ClearingPicker } from '../stations/woodcutting';
import { canShareFile, downloadFile, shareFile } from './exportFile';

export interface DebugDeps {
  game: Game;
  logger: EventLogger;
  saves: SaveStore;
  /** Feel numbers the menu can change live with sliders. */
  tuning: readonly LiveTuning<Record<string, number>>[];
  /** Picks kept on this phone (e.g. the tree style), shown as buttons. */
  choices: readonly Choice[];
  /** Woodcutting's clearing picker, to replay a seed or the tutorial. */
  clearings: ClearingPicker;
  buildLabel: string;
}

const MINUTE = 60_000;
const TIME_SKIPS = [
  { label: '+10 min', ms: 10 * MINUTE },
  { label: '+30 min', ms: 30 * MINUTE },
  { label: '+2 h', ms: 120 * MINUTE },
];

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

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return el('section', { className: 'debug-section' }, [
    el('h2', { textContent: title }),
    ...children,
  ]);
}

/**
 * `text` is the same JSON saved as .txt: Chrome on Android refuses to share .json files
 * (they're not on its Web Share allow list), but plain text is allowed.
 */
type LogFileType = 'json' | 'text';

function logFile(events: LogEvent[], buildLabel: string, type: LogFileType): File {
  const exportedAt = new Date();
  const stamp = exportedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const body = JSON.stringify(
    { exportedAt: exportedAt.toISOString(), build: buildLabel, events },
    null,
    2,
  );
  return type === 'json'
    ? new File([body], `warchest-log-${stamp}.json`, { type: 'application/json' })
    : new File([body], `warchest-log-${stamp}.json.txt`, { type: 'text/plain' });
}

/**
 * Debug menu: export logs, add items, set skill levels, pick options, fake time passing, reset
 * the save.
 * Built from the data, so new items and skills show up here without code changes.
 */
export function mountDebugMenu(root: HTMLElement, deps: DebugDeps): void {
  const { game, logger, saves } = deps;
  const data = game.data;

  const status = el('p', { className: 'debug-status', role: 'status' });
  const say = (message: string): void => {
    status.textContent = message;
  };

  // Logs. Stored events are read when the menu opens, and new ones are added as
  // they're logged, so the file can be built and shared straight from the tap
  // (phones only allow sharing right after a user gesture).
  let events: LogEvent[] = [];
  let loaded = false;
  let loggedWhileLoading: LogEvent[] = [];
  const logCount = el('p', { textContent: 'Loading…' });
  const showLogCount = (): void => {
    const sessions = new Set(events.map((event) => event.session)).size;
    logCount.textContent = `${events.length} events from ${sessions} session${sessions === 1 ? '' : 's'}`;
  };
  logger.onLog((event) => {
    if (!loaded) {
      loggedWhileLoading.push(event);
      return;
    }
    events.push(event);
    showLogCount();
  });
  const exportFile = (type: LogFileType): File => {
    logger.log('debug.exportLogs', { events: events.length + 1, as: type });
    return logFile(events, deps.buildLabel, type);
  };
  const shareButton = el('button', { type: 'button', textContent: 'Share logs…', disabled: true });
  shareButton.addEventListener('click', () => {
    const file = exportFile('text');
    if (!canShareFile(file)) {
      say(`Sharing isn't available here; downloaded ${file.name} instead`);
      downloadFile(file);
      return;
    }
    shareFile(file).then(
      (result) => {
        say(result === 'shared' ? `Shared ${file.name}` : 'Share cancelled');
      },
      (error: unknown) => {
        say(`Share failed (${String(error)}); downloading instead`);
        downloadFile(file);
      },
    );
  });
  const downloadButton = el('button', {
    type: 'button',
    textContent: 'Download logs',
    disabled: true,
  });
  downloadButton.addEventListener('click', () => {
    const file = exportFile('json');
    downloadFile(file);
    say(`Downloaded ${file.name}`);
  });
  const refreshLogs = (): void => {
    loaded = false;
    loggedWhileLoading = [];
    logCount.textContent = 'Loading…';
    shareButton.disabled = downloadButton.disabled = true;
    logger.readAll().then(
      (all) => {
        // An event logged during the read may or may not be in `all`; add the ones that aren't.
        const stored = new Set(all.map((event) => `${event.session}:${event.seq}`));
        events = [
          ...all,
          ...loggedWhileLoading.filter((event) => !stored.has(`${event.session}:${event.seq}`)),
        ];
        loaded = true;
        showLogCount();
        shareButton.disabled = downloadButton.disabled = false;
      },
      (error: unknown) => {
        logCount.textContent = `Couldn't read logs: ${String(error)}`;
      },
    );
  };

  // Warchest
  const itemSelect = el(
    'select',
    { ariaLabel: 'Item' },
    data.items.map((item) => el('option', { value: item.id, textContent: item.name })),
  );
  const countInput = el('input', {
    type: 'number',
    min: '1',
    value: '10',
    ariaLabel: 'Count',
    inputMode: 'numeric',
  });
  const addButton = el('button', { type: 'button', textContent: 'Add' });
  addButton.addEventListener('click', () => {
    const count = Number(countInput.value);
    try {
      game.addItems(itemSelect.value, count);
      logger.log('debug.addItems', { item: itemSelect.value, count });
      say(`Added ${count} ${itemSelect.selectedOptions[0]?.textContent ?? itemSelect.value}`);
    } catch (error) {
      say(String(error));
    }
  });
  const warchestList = el('ul', { className: 'debug-list' });

  // Skills
  const skillRows = data.skills.map((skill) => {
    const levelText = el('span', { className: 'debug-skill-level' });
    const input = el('input', {
      type: 'number',
      min: '1',
      max: String(game.xpCurve.maxLevel),
      ariaLabel: `${skill.name} level`,
      inputMode: 'numeric',
    });
    const set = el('button', { type: 'button', textContent: 'Set' });
    set.addEventListener('click', () => {
      const level = Number(input.value);
      try {
        game.setLevel(skill.id, level);
        logger.log('debug.setLevel', { skill: skill.id, level });
        say(`${skill.name} set to level ${level}`);
      } catch (error) {
        say(String(error));
      }
    });
    const row = el('div', { className: 'debug-row', dataset: { skill: skill.id } }, [
      el('span', { className: 'debug-skill-name', textContent: skill.name }),
      levelText,
      input,
      set,
    ]);
    return {
      row,
      update: () => {
        levelText.textContent = `Lv ${game.level(skill.id)} · ${game.xp(skill.id).toLocaleString()} XP`;
        input.value = String(game.level(skill.id));
      },
    };
  });

  // Time
  const lastSeen = el('p');
  const skipButtons = TIME_SKIPS.map((skip) => {
    const button = el('button', { type: 'button', textContent: skip.label });
    button.addEventListener('click', () => {
      game.lastSeenAt -= skip.ms;
      logger.log('debug.skipTime', { ms: skip.ms });
      say(`Skipped ahead ${skip.label.slice(1)} for idle progress`);
    });
    return button;
  });

  // Save
  let confirmReset = false;
  const resetButton = el('button', {
    type: 'button',
    className: 'debug-danger',
    textContent: 'Reset save',
  });
  resetButton.addEventListener('click', () => {
    if (!confirmReset) {
      confirmReset = true;
      resetButton.textContent = 'Tap again to wipe the save';
      return;
    }
    confirmReset = false;
    resetButton.textContent = 'Reset save';
    game.replaceState(saves.reset());
    logger.log('debug.resetSave');
    say('Save wiped. Logs are kept.');
  });

  // Options
  const choiceRows = deps.choices.map((choice) => {
    const buttons = choice.options.map((option) => {
      const button = el('button', { type: 'button', textContent: option.label });
      button.addEventListener('click', () => {
        choice.set(option.value);
        logger.log('debug.choice', { choice: choice.label, value: option.value });
      });
      return { button, value: option.value };
    });
    const show = (): void => {
      for (const { button, value } of buttons) {
        button.setAttribute('aria-pressed', String(value === choice.value));
      }
    };
    choice.onChange(show);
    show();
    return el('div', { className: 'debug-choice' }, [
      el('p', { className: 'debug-choice-label', textContent: choice.label }),
      el(
        'div',
        { className: 'debug-row' },
        buttons.map(({ button }) => button),
      ),
    ]);
  });

  // Woodcutting clearing: replay a layout by its seed, or the tutorial.
  const clearingNow = el('p');
  const showClearing = (): void => {
    const current = deps.clearings.current;
    const request = deps.clearings.request;
    const now = current
      ? `Now: ${current.seed === undefined ? 'tutorial clearing' : `clearing #${String(current.seed)}`} · par ${String(current.par)}`
      : 'No round played yet';
    const next =
      request === undefined
        ? ''
        : ` · next round: ${request.kind === 'tutorial' ? 'tutorial' : `#${String(request.seed)}`}`;
    clearingNow.textContent = now + next;
  };
  deps.clearings.onChange(showClearing);
  showClearing();
  const seedInput = el('input', {
    type: 'number',
    inputMode: 'numeric',
    placeholder: 'Seed',
    ariaLabel: 'Clearing seed',
  });
  const playSeed = el('button', { type: 'button', textContent: 'Play this seed next' });
  playSeed.addEventListener('click', () => {
    const seed = Number(seedInput.value);
    if (seedInput.value === '' || !Number.isInteger(seed) || seed < 0) {
      say('Type a clearing number (the # on the round summary)');
      return;
    }
    deps.clearings.requestNext({ kind: 'seed', seed: seed >>> 0 });
    logger.log('debug.clearing', { seed });
    say(`Next woodcutting round plays clearing #${String(seed >>> 0)}`);
  });
  const playTutorial = el('button', { type: 'button', textContent: 'Tutorial next' });
  playTutorial.addEventListener('click', () => {
    deps.clearings.requestNext({ kind: 'tutorial' });
    logger.log('debug.clearing', { tutorial: true });
    say('Next woodcutting round plays the tutorial clearing');
  });

  // Live tuning
  const tuningSections = deps.tuning.map((tuning) => {
    const sliders = tuning.tunables.map((tunable) => {
      const value = el('span', { className: 'debug-tune-value' });
      const input = el('input', {
        type: 'range',
        min: String(tunable.min),
        max: String(tunable.max),
        step: String(tunable.step),
        ariaLabel: tunable.label,
      });
      const show = (): void => {
        const current = tuning.values[tunable.key] ?? 0;
        input.value = String(current);
        value.textContent = `${current}${tuning.isOverridden(tunable.key) ? ' •' : ''}`;
      };
      input.addEventListener('input', () => {
        tuning.set(tunable.key, Number(input.value));
      });
      input.addEventListener('change', () => {
        logger.log('debug.tune', {
          group: tuning.name,
          key: tunable.key,
          value: Number(input.value),
        });
      });
      const row = el('label', { className: 'debug-tune' }, [
        el('span', { className: 'debug-tune-label' }, [tunable.label, value]),
        input,
      ]);
      return { row, show, more: tunable.more === true };
    });
    const showAll = (): void => {
      for (const slider of sliders) slider.show();
    };
    tuning.onChange(showAll);
    showAll();

    const copy = el('button', { type: 'button', textContent: 'Copy as data' });
    copy.addEventListener('click', () => {
      const json = JSON.stringify(tuning.values, null, 2);
      logger.log('debug.tuneCopy', { group: tuning.name });
      navigator.clipboard.writeText(json).then(
        () => {
          say(`Copied ${tuning.name} feel values; paste them into src/data`);
        },
        () => {
          say(`Couldn't copy. Values: ${JSON.stringify(tuning.values)}`);
        },
      );
    });
    const reset = el('button', { type: 'button', textContent: 'Reset to data' });
    reset.addEventListener('click', () => {
      tuning.reset();
      logger.log('debug.tuneReset', { group: tuning.name });
      say(`${tuning.name} feel reset to the values in data`);
    });
    return section(
      `Live tuning: ${tuning.name}`,
      el('p', {
        className: 'debug-note',
        textContent:
          'Changes apply instantly and stay on this phone until reset. • = changed from data.',
      }),
      ...sliders.filter((slider) => !slider.more).map((slider) => slider.row),
      // The juice and timing sliders, folded away so the ones that change how it plays stand out.
      ...(sliders.some((slider) => slider.more)
        ? [
            el('details', { className: 'debug-more' }, [
              el('summary', {
                textContent: `More: juice and timing (${String(
                  sliders.filter((slider) => slider.more).length,
                )})`,
              }),
              ...sliders.filter((slider) => slider.more).map((slider) => slider.row),
            ]),
          ]
        : []),
      el('div', { className: 'debug-row' }, [copy, reset]),
    );
  });

  const update = (): void => {
    warchestList.replaceChildren(
      ...(game.inventory.stacks().length === 0
        ? [el('li', { textContent: 'Empty' })]
        : game.inventory.stacks().map((stack) => {
            const item = data.items.find((candidate) => candidate.id === stack.item);
            return el('li', { textContent: `${item?.name ?? stack.item} × ${stack.count}` });
          })),
    );
    for (const skill of skillRows) skill.update();
    const minutes = Math.round((Date.now() - game.lastSeenAt) / MINUTE);
    lastSeen.textContent = `Last seen: ${minutes <= 0 ? 'just now' : `${minutes} min ago`} (idle progress counts from here, M6)`;
  };

  const closeButton = el('button', {
    type: 'button',
    className: 'debug-close',
    textContent: 'Close',
  });
  const panel = el(
    'div',
    { className: 'debug-panel', hidden: true, role: 'dialog', ariaLabel: 'Debug menu' },
    [
      el('header', { className: 'debug-header' }, [
        el('div', {}, [
          el('h1', { textContent: 'Debug' }),
          el('p', { textContent: deps.buildLabel }),
        ]),
        closeButton,
      ]),
      status,
      section(
        'Playtest logs',
        logCount,
        el('div', { className: 'debug-row' }, [shareButton, downloadButton]),
      ),
      section(
        'Warchest',
        el('div', { className: 'debug-row' }, [itemSelect, countInput, addButton]),
        warchestList,
      ),
      section('Skills', ...skillRows.map((skill) => skill.row)),
      ...(choiceRows.length > 0 ? [section('Options', ...choiceRows)] : []),
      section(
        'Woodcutting clearing',
        clearingNow,
        el('div', { className: 'debug-row' }, [seedInput, playSeed, playTutorial]),
      ),
      ...tuningSections,
      section('Time', lastSeen, el('div', { className: 'debug-row' }, skipButtons)),
      section('Save', resetButton),
    ],
  );
  const toggle = el('button', {
    type: 'button',
    className: 'debug-toggle',
    textContent: 'Debug',
    ariaLabel: 'Open debug menu',
  });

  let unsubscribe: (() => void) | undefined;
  toggle.addEventListener('click', () => {
    panel.hidden = false;
    toggle.hidden = true;
    say('');
    update();
    refreshLogs();
    unsubscribe = game.onChange(update);
  });
  closeButton.addEventListener('click', () => {
    panel.hidden = true;
    toggle.hidden = false;
    confirmReset = false;
    resetButton.textContent = 'Reset save';
    unsubscribe?.();
  });

  root.append(toggle, panel);
}
