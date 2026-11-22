import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { EventLogger, ManualClock, openIndexedDbSink } from '../src/core';
import { testLogger } from './helpers';

describe('EventLogger', () => {
  it('stores timestamped events in order', async () => {
    const { logger, clock } = testLogger();
    logger.log('session.start');
    clock.advance(250);
    logger.log('recipe.craft', { recipe: 'rive_stave' });
    expect(await logger.readAll()).toEqual([
      { seq: 0, t: 1_000, session: 'test-session', type: 'session.start' },
      {
        seq: 1,
        t: 1_250,
        session: 'test-session',
        type: 'recipe.craft',
        data: { recipe: 'rive_stave' },
      },
    ]);
  });

  it('keeps logging when the storage fails', async () => {
    const failing = {
      append: () => Promise.reject(new Error('disk full')),
      readAll: () => Promise.resolve([]),
    };
    const logger = new EventLogger(failing, new ManualClock(), 's');
    expect(() => {
      logger.log('a');
    }).not.toThrow();
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it('persists events in IndexedDB across sessions', async () => {
    const clock = new ManualClock(0);
    const first = new EventLogger(await openIndexedDbSink('test-db'), clock, 'one');
    first.log('session.start');
    await first.flush();
    const second = new EventLogger(await openIndexedDbSink('test-db'), clock, 'two');
    second.log('session.start');
    const events = await second.readAll();
    expect(events.map((event) => event.session)).toEqual(['one', 'two']);
  });
});
