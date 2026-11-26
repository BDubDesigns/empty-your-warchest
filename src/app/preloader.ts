/** Calls `run` once, at some later moment (e.g. when the browser is next idle). */
export type Scheduler = (run: () => void) => void;

/**
 * Schedules work for the browser's next idle moment, or after `timeoutMs` at the latest.
 * Browsers without idle callbacks (Safari) wait `timeoutMs`.
 */
export function whenIdle(timeoutMs: number): Scheduler {
  return (run) => {
    if ((window as Partial<Window>).requestIdleCallback) {
      window.requestIdleCallback(run, { timeout: timeoutMs });
    } else {
      window.setTimeout(run, timeoutMs);
    }
  };
}

/** Where one background load is: not started, loading, finished, failed, or not needed. */
export type PreloadState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

export interface PreloadTask<Id extends string> {
  id: Id;
  run: () => Promise<void>;
}

export interface PreloaderDeps<Id extends string> {
  schedule: Scheduler;
  /** Milliseconds, for timing each load. */
  now: () => number;
  /** Passes over a task when it comes up (e.g. its screen has already loaded on demand). */
  skip: (id: Id) => boolean;
  onDone: (id: Id, ms: number) => void;
  onFailed: (id: Id, error: unknown) => void;
}

/**
 * Runs background loads one at a time, in order, each starting in its own scheduled moment, so
 * they never pile onto one frame. Starts paused. Pausing stops the next load from starting; one
 * already running finishes (it's the same work an on-demand load would wait for anyway).
 */
export class Preloader<Id extends string> {
  readonly #tasks: readonly PreloadTask<Id>[];
  readonly #deps: PreloaderDeps<Id>;
  readonly #states = new Map<Id, PreloadState>();
  #next = 0;
  #paused = true;
  /** A load is scheduled or running: don't schedule another. */
  #busy = false;

  constructor(tasks: readonly PreloadTask<Id>[], deps: PreloaderDeps<Id>) {
    this.#tasks = tasks;
    this.#deps = deps;
    for (const task of tasks) this.#states.set(task.id, 'waiting');
  }

  state(id: Id): PreloadState | undefined {
    return this.#states.get(id);
  }

  /** Starts (or carries on) loading in the background. */
  resume(): void {
    this.#paused = false;
    this.#scheduleNext();
  }

  /** Starts no more loads until `resume`. */
  pause(): void {
    this.#paused = true;
  }

  #scheduleNext(): void {
    if (this.#paused || this.#busy || this.#next >= this.#tasks.length) return;
    this.#busy = true;
    this.#deps.schedule(() => {
      void this.#runNext();
    });
  }

  async #runNext(): Promise<void> {
    const task = this.#paused ? undefined : this.#tasks[this.#next];
    if (task) {
      this.#next++;
      await this.#run(task);
    }
    this.#busy = false;
    this.#scheduleNext();
  }

  async #run(task: PreloadTask<Id>): Promise<void> {
    if (this.#deps.skip(task.id)) {
      this.#states.set(task.id, 'skipped');
      return;
    }
    this.#states.set(task.id, 'running');
    const started = this.#deps.now();
    try {
      await task.run();
      this.#states.set(task.id, 'done');
      this.#deps.onDone(task.id, this.#deps.now() - started);
    } catch (error) {
      // A failed preload only costs the head start: the screen loads (and reports) on demand.
      this.#states.set(task.id, 'failed');
      this.#deps.onFailed(task.id, error);
    }
  }
}
