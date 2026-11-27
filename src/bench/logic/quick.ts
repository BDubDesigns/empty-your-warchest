import type { BenchData, BenchPixelRatio } from '../../data/bench';
import type { RunSettings } from './plan';

// The quick run: a few short runs, the log sent after each, so a device there's only a minute on
// (a free BrowserStack trial) still gets its results back, however far it got. `?bench=quick` on
// the page's address starts it as the page loads, with no taps. The order of things lives here,
// apart from the screen, so it's tested: a run, its upload, then the next run.

/** The quick run's runs, each at `pixelRatio`. */
export function quickPlan(data: BenchData, pixelRatio: BenchPixelRatio): RunSettings[] {
  return data.quick.runs.map((run) => ({ ...run, pixelRatio }));
}

/** Seconds of the quick run that override the data's (the end-to-end tests shorten it). */
export interface QuickOverrides {
  warmupSeconds?: number;
  seconds?: number;
}

/**
 * What the page's address asks of the quick run: `?bench=quick` starts it as the page loads, and
 * `&warmup=` and `&measure=` (seconds) shorten it. Undefined when it isn't asked for.
 */
export function quickFromUrl(search: string): QuickOverrides | undefined {
  const params = new URLSearchParams(search);
  if (params.get('bench') !== 'quick') return undefined;
  const overrides: QuickOverrides = {};
  const seconds = (name: string): number | undefined => {
    const value = Number(params.get(name) ?? Number.NaN);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const warmup = seconds('warmup');
  const measure = seconds('measure');
  if (warmup !== undefined) overrides.warmupSeconds = warmup;
  if (measure !== undefined) overrides.seconds = measure;
  return overrides;
}

/** Where each quick run flies along the camera path: warm-up up to `from`, then measured. */
export interface QuickTiming {
  from: number;
  warmupSeconds: number;
  seconds: number;
}

/** The data's quick timing, with any overrides kept within the camera path. */
export function quickTiming(data: BenchData, overrides: QuickOverrides = {}): QuickTiming {
  const { from } = data.quick;
  return {
    from,
    warmupSeconds: Math.min(overrides.warmupSeconds ?? data.quick.warmupSeconds, from),
    seconds: Math.min(overrides.seconds ?? data.quick.seconds, data.seconds - from),
  };
}

/** Roughly how long the quick run takes (s), with `overhead` seconds each to load and send. */
export function quickSeconds(data: BenchData, timing: QuickTiming, overhead: number): number {
  return data.quick.runs.length * (timing.warmupSeconds + timing.seconds + overhead);
}

/** How a run went: measured to the end, stopped, given up still loading, or broken. */
export type QuickStatus = 'done' | 'stopped' | 'timedOut' | 'failed';

/** What the quick run asks of the bench. None of them may reject. */
export interface QuickHooks<Upload> {
  /** Runs `run` (the `index`th) and logs it, resolving with how it went. */
  run(run: RunSettings, index: number): Promise<QuickStatus>;
  /** Sends the log so far, after the `index`th run. */
  upload(index: number): Promise<Upload>;
  /** An upload's result, whenever it comes: `late` once the next run has started without it. */
  uploaded(index: number, result: Upload, late: boolean): void;
  /** Resolves after `ms`. */
  wait(ms: number): Promise<void>;
  /** Whether Stop has been tapped. */
  stopping(): boolean;
}

/**
 * Each run in turn, the log sent after every one (stopped, timed out and broken ones too: what
 * they logged is worth having). The next run waits up to `uploadWaitMs` for the upload, so a slow
 * connection can't eat the minute; a late upload is still reported when it comes. Resolves with
 * how each run went, once the last upload is in (or waited for).
 */
export async function runQuick<Upload>(
  runs: readonly RunSettings[],
  hooks: QuickHooks<Upload>,
  uploadWaitMs: number,
): Promise<QuickStatus[]> {
  const statuses: QuickStatus[] = [];
  for (const [index, run] of runs.entries()) {
    if (hooks.stopping()) break;
    const status = await hooks.run(run, index);
    statuses.push(status);
    let late = false;
    const sent = hooks.upload(index).then((result) => {
      hooks.uploaded(index, result, late);
      return true;
    });
    const inTime = await Promise.race([sent, hooks.wait(uploadWaitMs).then(() => false)]);
    if (!inTime) late = true;
    if (status === 'stopped') break;
  }
  return statuses;
}

/** `work`'s value if it comes within `ms`, or `{ ok: false }` (the work carries on regardless). */
export async function within<T>(
  work: Promise<T>,
  ms: number,
  wait: (ms: number) => Promise<void>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  return Promise.race([
    work.then((value) => ({ ok: true as const, value })),
    wait(ms).then(() => ({ ok: false as const })),
  ]);
}
