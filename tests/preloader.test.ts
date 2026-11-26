import { afterEach, describe, expect, it, vi } from 'vitest';
import { noticeIfSlow } from '../src/app/loadingCard';
import { Preloader, type PreloaderDeps } from '../src/app/preloader';

/** A scheduler that only runs what's queued when the test says so. */
function manualScheduler() {
  const queued: (() => void)[] = [];
  return {
    schedule: (run: () => void) => queued.push(run),
    get pending() {
      return queued.length;
    },
    /** Runs the next scheduled call and lets its load settle. */
    async step() {
      queued.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function setup(ids: string[], overrides: Partial<PreloaderDeps<string>> = {}) {
  const scheduler = manualScheduler();
  const ran: string[] = [];
  const done: string[] = [];
  const failed: string[] = [];
  const preloader = new Preloader(
    ids.map((id) => ({
      id,
      run: () => {
        ran.push(id);
        return id === 'broken' ? Promise.reject(new Error('404')) : Promise.resolve();
      },
    })),
    {
      schedule: scheduler.schedule,
      now: () => 0,
      skip: () => false,
      onDone: (id) => done.push(id),
      onFailed: (id) => failed.push(id),
      ...overrides,
    },
  );
  return { preloader, scheduler, ran, done, failed };
}

describe('Preloader', () => {
  it('starts paused, then loads one task per scheduled moment, in order', async () => {
    const { preloader, scheduler, ran, done } = setup(['tree', 'bench', 'fire']);
    expect(scheduler.pending).toBe(0);

    preloader.resume();
    expect(scheduler.pending).toBe(1);
    await scheduler.step();
    expect(ran).toEqual(['tree']);
    expect(preloader.state('tree')).toBe('done');
    expect(preloader.state('bench')).toBe('waiting');

    await scheduler.step();
    await scheduler.step();
    expect(ran).toEqual(['tree', 'bench', 'fire']);
    expect(done).toEqual(['tree', 'bench', 'fire']);
    expect(scheduler.pending).toBe(0);
  });

  it('starts nothing new while paused, and carries on when resumed', async () => {
    const { preloader, scheduler, ran } = setup(['tree', 'bench']);
    preloader.resume();
    preloader.pause();
    // The moment already asked for comes, but the load doesn't start.
    await scheduler.step();
    expect(ran).toEqual([]);
    expect(scheduler.pending).toBe(0);

    preloader.resume();
    preloader.resume();
    expect(scheduler.pending).toBe(1);
    await scheduler.step();
    expect(ran).toEqual(['tree']);
  });

  it('times each load', async () => {
    let time = 0;
    const timed: [string, number][] = [];
    const { preloader, scheduler } = setup(['tree'], {
      now: () => (time += 40),
      onDone: (id, ms) => timed.push([id, ms]),
    });
    preloader.resume();
    await scheduler.step();
    expect(timed).toEqual([['tree', 40]]);
  });

  it('passes over tasks that are no longer needed', async () => {
    const { preloader, scheduler, ran } = setup(['tree', 'bench'], {
      skip: (id) => id === 'tree',
    });
    preloader.resume();
    await scheduler.step();
    expect(preloader.state('tree')).toBe('skipped');
    await scheduler.step();
    expect(ran).toEqual(['bench']);
  });

  it('reports a failed load and moves on to the next', async () => {
    const { preloader, scheduler, ran, failed } = setup(['broken', 'fire']);
    preloader.resume();
    await scheduler.step();
    await scheduler.step();
    expect(failed).toEqual(['broken']);
    expect(preloader.state('broken')).toBe('failed');
    expect(ran).toEqual(['broken', 'fire']);
  });
});

/** Work the test finishes (or fails) by hand. */
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('noticeIfSlow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function notice() {
    const log: string[] = [];
    return { log, notice: { show: () => log.push('show'), hide: () => log.push('hide') } };
  }

  it('never shows the notice for work that finishes in time', async () => {
    vi.useFakeTimers();
    const { log, notice: card } = notice();
    const work = deferred();
    const shown = noticeIfSlow(work.promise, 250, card);
    await vi.advanceTimersByTimeAsync(249);
    work.resolve();
    expect(await shown).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toEqual([]);
  });

  it('shows the notice once the work is slow, and hides it when done', async () => {
    vi.useFakeTimers();
    const { log, notice: card } = notice();
    const work = deferred();
    const shown = noticeIfSlow(work.promise, 250, card);
    await vi.advanceTimersByTimeAsync(250);
    expect(log).toEqual(['show']);
    work.resolve();
    expect(await shown).toBe(true);
    expect(log).toEqual(['show', 'hide']);
  });

  it('hides the notice when the work fails, and passes the failure on', async () => {
    vi.useFakeTimers();
    const { log, notice: card } = notice();
    const work = deferred();
    const shown = noticeIfSlow(work.promise, 0, card);
    const failed = expect(shown).rejects.toThrow('no WebGL');
    await vi.advanceTimersByTimeAsync(1);
    work.reject(new Error('no WebGL'));
    await failed;
    expect(log).toEqual(['show', 'hide']);
  });
});
