import { ManualClock, EventLogger, MemorySink } from '../src/core';
import { loadGameData, parseGameData, rawGameData, type GameDataInput } from '../src/data';

export const data = loadGameData();

/** A deep copy of the real raw data to edit in a test. */
export function editableRawData(): GameDataInput {
  return structuredClone(rawGameData);
}

/** Real data with one change applied, validated like at startup. */
export function dataWith(edit: (raw: GameDataInput) => void) {
  const raw = editableRawData();
  edit(raw);
  return parseGameData(raw);
}

export function testLogger(clock = new ManualClock(1_000)) {
  const sink = new MemorySink();
  return { sink, clock, logger: new EventLogger(sink, clock, 'test-session') };
}
