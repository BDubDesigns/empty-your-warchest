import { describe, expect, it } from 'vitest';
import { Game, newGameState } from '../src/core';
import { data, testLogger } from './helpers';

function newGame() {
  const { logger, sink } = testLogger();
  return { game: new Game(data, newGameState(data, 0), logger), logger, sink };
}

describe('Game', () => {
  it("pays recipe XP to the station's skill and logs the craft", async () => {
    const { game, logger } = newGame();
    game.addItems('log', 2);
    game.craft('rive_stave');
    expect(game.xp('fletching')).toBe(10);
    expect(game.xp('woodcutting')).toBe(0);
    const events = await logger.readAll();
    expect(events.at(-1)).toMatchObject({
      type: 'recipe.craft',
      data: { recipe: 'rive_stave', xp: 10 },
    });
  });

  it('logs level-ups', async () => {
    const { game, logger } = newGame();
    game.addXp('woodcutting', 83);
    expect(game.level('woodcutting')).toBe(2);
    expect(await logger.readAll()).toContainEqual(
      expect.objectContaining({ type: 'skill.levelUp', data: { skill: 'woodcutting', level: 2 } }),
    );
  });

  it('sets a skill to the start of a level', () => {
    const { game } = newGame();
    game.setLevel('command', 10);
    expect(game.level('command')).toBe(10);
    expect(game.xp('command')).toBe(1_154);
  });

  it('notifies listeners on every change and snapshots its state', () => {
    const { game } = newGame();
    let changes = 0;
    const stop = game.onChange(() => changes++);
    game.addItems('spear', 2, 'good');
    game.setLevel('fletching', 5);
    stop();
    game.addItems('log', 1);
    expect(changes).toBe(2);
    expect(game.snapshot()).toMatchObject({
      inventory: [
        { item: 'log', count: 1 },
        { item: 'spear', count: 2, quality: 'good' },
      ],
      skills: { fletching: game.xpCurve.xpForLevel(5) },
    });
  });
});
