import { describe, expect, it } from 'vitest';
import { Game, newGameState } from '../src/core';
import {
  ClearingPicker,
  generateClearing,
  WOODCUTTING_TUTORIAL,
} from '../src/stations/woodcutting';
import { data, testLogger } from './helpers';

function setup() {
  const game = new Game(data, newGameState(data, 0), testLogger().logger);
  let seed = 100;
  return { game, picker: new ClearingPicker(game, () => (seed += 1)) };
}

describe('ClearingPicker', () => {
  it('plays the tutorial first, then random clearings once it is finished', () => {
    const { game, picker } = setup();
    expect(picker.next()).toMatchObject({ tutorial: true, clearing: { id: 'first_clearing' } });
    // Until a tutorial round has ended, the next round is the tutorial again.
    expect(picker.next().tutorial).toBe(true);
    picker.finished();
    expect(game.hasDone(WOODCUTTING_TUTORIAL)).toBe(true);
    const random = picker.next();
    expect(random).toMatchObject({ tutorial: false, seed: 101 });
    expect(picker.next().seed).toBe(102);
  });

  it('replays a requested seed or the tutorial, once', () => {
    const { game, picker } = setup();
    game.markDone(WOODCUTTING_TUTORIAL);
    picker.requestNext({ kind: 'seed', seed: 42 });
    expect(picker.next()).toEqual(generateClearing(data.woodcutting, 42));
    picker.requestNext({ kind: 'tutorial' });
    expect(picker.next().tutorial).toBe(true);
    expect(picker.next().tutorial).toBe(false);
  });
});
