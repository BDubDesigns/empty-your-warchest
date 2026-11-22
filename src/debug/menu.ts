import type { EventLogger, Game, LogEvent, SaveStore } from '../core';
import { canShareFile, downloadFile, shareFile } from './exportFile';

export interface DebugDeps {
  game: Game;
  logger: EventLogger;
  saves: SaveStore;
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

function logFile(events: LogEvent[], buildLabel: string): File {
  const exportedAt = new Date();
  const stamp = exportedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const body = JSON.stringify(
    { exportedAt: exportedAt.toISOString(), build: buildLabel, events },
    null,
    2,
  );
  return new File([body], `warchest-log-${stamp}.json`, { type: 'application/json' });
}

/**
 * Debug menu: export logs, add items, set skill levels, fake time passing, reset the save.
 * Built from the data, so new items and skills show up here without code changes.
 */
export function mountDebugMenu(root: HTMLElement, deps: DebugDeps): void {
  const { game, logger, saves } = deps;
  const data = game.data;

  const status = el('p', { className: 'debug-status', role: 'status' });
  const say = (message: string): void => {
    status.textContent = message;
  };

  // Logs. Events are read when the menu opens, so the share sheet opens straight
  // from the tap (phones only allow sharing right after a user gesture).
  let events: LogEvent[] = [];
  const logCount = el('p', { textContent: 'Loading…' });
  const exportFile = (): File => {
    logger.log('debug.exportLogs', { events: events.length });
    return logFile(events, deps.buildLabel);
  };
  const shareButton = el('button', { type: 'button', textContent: 'Share logs…', disabled: true });
  shareButton.addEventListener('click', () => {
    const file = exportFile();
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
    const file = exportFile();
    downloadFile(file);
    say(`Downloaded ${file.name}`);
  });
  const refreshLogs = (): void => {
    logCount.textContent = 'Loading…';
    logger.readAll().then(
      (all) => {
        events = all;
        const sessions = new Set(all.map((event) => event.session)).size;
        logCount.textContent = `${all.length} events from ${sessions} session${sessions === 1 ? '' : 's'}`;
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
  const qualitySelect = el(
    'select',
    { ariaLabel: 'Quality' },
    data.qualities.map((quality) => el('option', { value: quality.id, textContent: quality.name })),
  );
  const countInput = el('input', {
    type: 'number',
    min: '1',
    value: '10',
    ariaLabel: 'Count',
    inputMode: 'numeric',
  });
  const syncQuality = (): void => {
    qualitySelect.hidden = !game.inventory.isTiered(itemSelect.value);
  };
  itemSelect.addEventListener('change', syncQuality);
  syncQuality();
  const addButton = el('button', { type: 'button', textContent: 'Add' });
  addButton.addEventListener('click', () => {
    const count = Number(countInput.value);
    const quality = game.inventory.isTiered(itemSelect.value) ? qualitySelect.value : undefined;
    try {
      game.addItems(itemSelect.value, count, quality);
      logger.log('debug.addItems', { item: itemSelect.value, count, quality });
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

  const update = (): void => {
    warchestList.replaceChildren(
      ...(game.inventory.stacks().length === 0
        ? [el('li', { textContent: 'Empty' })]
        : game.inventory.stacks().map((stack) => {
            const item = data.items.find((candidate) => candidate.id === stack.item);
            const quality = data.qualities.find((candidate) => candidate.id === stack.quality);
            const label = [quality?.name, item?.name ?? stack.item].filter(Boolean).join(' ');
            return el('li', { textContent: `${label} × ${stack.count}` });
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
        el('div', { className: 'debug-row' }, [itemSelect, qualitySelect, countInput, addButton]),
        warchestList,
      ),
      section('Skills', ...skillRows.map((skill) => skill.row)),
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
