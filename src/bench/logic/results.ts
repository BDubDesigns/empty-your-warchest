// The stress test's results as text: the full table's columns, shown the same in the table, the
// phone summary and "Copy as text", so every route out of the bench says the same thing.

/** The full table's columns, in order: each a short heading and the key its cell is under. */
export const resultColumns = [
  { key: 'run', label: '#' },
  { key: 'pack', label: 'Pack' },
  { key: 'scale', label: '×' },
  { key: 'shadows', label: 'Shad.' },
  { key: 'pixelRatio', label: 'PR' },
  { key: 'note', label: 'Note' },
  { key: 'fps', label: 'FPS med' },
  { key: 'p5', label: '5% low' },
  { key: 'low1', label: '1% low' },
  { key: 'worstMs', label: 'Worst ms' },
  { key: 'cpuMs', label: 'CPU ms' },
  { key: 'physicsMs', label: 'Phys ms' },
  { key: 'calls', label: 'Calls' },
  { key: 'trisK', label: 'Tris k' },
  { key: 'textureMB', label: 'Tex MB' },
  { key: 'loadS', label: 'Load s' },
] as const;

export type ResultKey = (typeof resultColumns)[number]['key'];

/** One run's cells, as shown. */
export type ResultRow = Record<ResultKey, string>;

/** The numbers each run in the phone summary shows, after its title line. */
export const summaryColumns = [
  { key: 'fps', label: 'FPS', unit: 'med' },
  { key: 'low1', label: '1% low', unit: 'fps' },
  { key: 'worstMs', label: 'Worst', unit: 'ms' },
  { key: 'cpuMs', label: 'CPU', unit: 'ms' },
  { key: 'calls', label: 'Calls', unit: '' },
  { key: 'textureMB', label: 'Tex', unit: 'MB' },
  { key: 'loadS', label: 'Load', unit: 's' },
] as const satisfies readonly { key: ResultKey; label: string; unit: string }[];

/** A run's title line in the summary: "3 · Boxes 1× · shadows off · no shadows". */
export function summaryTitle(row: ResultRow): string {
  return [`${row.run} · ${row.pack} ${row.scale}`, `shadows ${row.shadows}`, row.note]
    .filter(Boolean)
    .join(' · ');
}

/** Tabs and line breaks inside a cell would split it: they become spaces. */
const cell = (text: string): string => text.replace(/[\t\r\n]+/g, ' ');

/**
 * The results as tab-separated text (pastes into a spreadsheet as columns): `heading` on its own
 * line first (the build and device), then the table's headings and one line per run.
 */
export function resultsText(heading: string, rows: readonly ResultRow[]): string {
  const lines = [
    cell(heading),
    resultColumns.map((column) => column.label).join('\t'),
    ...rows.map((row) => resultColumns.map((column) => cell(row[column.key])).join('\t')),
  ];
  return `${lines.join('\n')}\n`;
}
