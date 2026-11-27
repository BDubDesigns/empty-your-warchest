import { describe, expect, it } from 'vitest';
import type { RunSettings } from '../src/bench/logic/plan';
import {
  quickFromUrl,
  quickPlan,
  quickSeconds,
  quickTiming,
  runQuick,
  within,
  type QuickHooks,
  type QuickStatus,
} from '../src/bench/logic/quick';
import { bench, loadBenchData } from '../src/data/bench';

const data = loadBenchData();

/** Hooks that note what happens, in order; each run goes as `statuses` says. */
function recorder(statuses: QuickStatus[] = []) {
  const steps: string[] = [];
  const hooks: QuickHooks<string> = {
    run: (run, index) => {
      steps.push(`run ${String(index)} ${run.pack}`);
      return Promise.resolve(statuses[index] ?? 'done');
    },
    upload: (index) => {
      steps.push(`upload ${String(index)}`);
      return Promise.resolve(`code${String(index)}`);
    },
    uploaded: (index, result, late) => {
      steps.push(`uploaded ${String(index)} ${result}${late ? ' late' : ''}`);
    },
    // Never ends: every upload here comes in time.
    wait: () => new Promise<void>(() => undefined),
    stopping: () => false,
  };
  return { steps, hooks };
}

describe('quick run data', () => {
  it('runs the optimised village, the boxes, then the village, at 1× with shadows', () => {
    const plan = quickPlan(data, 'game');
    expect(plan.map((run) => run.pack)).toEqual(['village-lite', 'boxes', 'village']);
    expect(plan.every((run) => run.scale === 1 && run.shadows === 'on')).toBe(true);
    expect(plan.every((run) => run.physics && !run.matte && run.pixelRatio === 'game')).toBe(true);
  });

  it('measures a stretch of the path with the fort coming down in it', () => {
    const timing = quickTiming(data);
    expect(timing).toEqual({ from: 5, warmupSeconds: 2, seconds: 8 });
    expect(data.collapse.at).toBeGreaterThanOrEqual(timing.from);
    expect(data.collapse.at).toBeLessThan(timing.from + timing.seconds);
  });

  it('fits a minute on a device, with time to load and send', () => {
    // 30 s of warm-up and measuring; allow 4 s a run to load, compile and send on a slow phone,
    // and 5 s for the page itself.
    const timing = quickTiming(data);
    expect(5 + quickSeconds(data, timing, 4)).toBeLessThan(50);
    // Even if the last run's load times out, that's logged and sent within the minute.
    const firstTwo = (2 / data.quick.runs.length) * quickSeconds(data, timing, 4);
    expect(5 + firstTwo + data.quick.loadTimeoutS + data.quick.uploadWaitS).toBeLessThan(60);
  });

  it('fails loudly on a quick run that misses the collapse or names no pack', () => {
    expect(() => loadBenchData({ ...bench, quick: { ...bench.quick, from: 11 } })).toThrow(
      /must see the fort come down/,
    );
    expect(() =>
      loadBenchData({ ...bench, quick: { ...bench.quick, runs: [{ pack: 'nope', scale: 1 }] } }),
    ).toThrow(/Unknown pack "nope"/);
    expect(() => loadBenchData({ ...bench, quick: { ...bench.quick, warmupSeconds: 6 } })).toThrow(
      /warm-up/,
    );
  });
});

describe('quick run from the address', () => {
  it('starts only for ?bench=quick, its seconds overridable', () => {
    expect(quickFromUrl('')).toBeUndefined();
    expect(quickFromUrl('?bench=all')).toBeUndefined();
    expect(quickFromUrl('?bench=quick')).toEqual({});
    expect(quickFromUrl('?bench=quick&warmup=0.5&measure=1')).toEqual({
      warmupSeconds: 0.5,
      seconds: 1,
    });
    // Nonsense is ignored: the data's seconds stand.
    expect(quickFromUrl('?bench=quick&warmup=-1&measure=soon')).toEqual({});
  });

  it('keeps overrides within the camera path', () => {
    expect(quickTiming(data, { warmupSeconds: 0.5, seconds: 1 })).toEqual({
      from: 5,
      warmupSeconds: 0.5,
      seconds: 1,
    });
    expect(quickTiming(data, { warmupSeconds: 60, seconds: 60 })).toEqual({
      from: 5,
      warmupSeconds: 5,
      seconds: data.seconds - 5,
    });
  });
});

describe('quick run sequence', () => {
  const plan = quickPlan(data, 'game');

  it('sends the log after every run, before the next starts', async () => {
    const { steps, hooks } = recorder();
    expect(await runQuick(plan, hooks, 5000)).toEqual(['done', 'done', 'done']);
    expect(steps).toEqual([
      'run 0 village-lite',
      'upload 0',
      'uploaded 0 code0',
      'run 1 boxes',
      'upload 1',
      'uploaded 1 code1',
      'run 2 village',
      'upload 2',
      'uploaded 2 code2',
    ]);
  });

  it('sends a timed-out or broken run too, and carries on', async () => {
    const { steps, hooks } = recorder(['failed', 'done', 'timedOut']);
    expect(await runQuick(plan, hooks, 5000)).toEqual(['failed', 'done', 'timedOut']);
    expect(steps.filter((step) => step.startsWith('uploaded'))).toHaveLength(3);
  });

  it("doesn't wait for ever on a slow upload; its code still counts when it comes", async () => {
    const { steps, hooks } = recorder();
    let finish: (code: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => {
      finish = resolve;
    });
    let waited = 0;
    const statuses = await runQuick(
      plan,
      {
        ...hooks,
        upload: (index) => {
          steps.push(`upload ${String(index)}`);
          return index === 0 ? slow : Promise.resolve(`code${String(index)}`);
        },
        wait: (ms) => {
          waited = ms;
          // The first upload's wait runs out; the others come first.
          return steps.length <= 2 ? Promise.resolve() : new Promise<void>(() => undefined);
        },
      },
      5000,
    );
    expect(statuses).toEqual(['done', 'done', 'done']);
    expect(waited).toBe(5000);
    expect(steps.slice(0, 3)).toEqual(['run 0 village-lite', 'upload 0', 'run 1 boxes']);
    expect(steps).not.toContain('uploaded 0 code0 late');
    finish('code0');
    await slow;
    await Promise.resolve();
    expect(steps.at(-1)).toBe('uploaded 0 code0 late');
  });

  it('stops after a stopped run, its log sent; no run starts once Stop is tapped', async () => {
    const stopped = recorder(['done', 'stopped']);
    expect(await runQuick(plan, stopped.hooks, 5000)).toEqual(['done', 'stopped']);
    expect(stopped.steps.at(-1)).toBe('uploaded 1 code1');

    const before = recorder();
    const runs: RunSettings[] = [];
    let tapped = false;
    const statuses = await runQuick(
      plan,
      {
        ...before.hooks,
        run: (run, index) => {
          runs.push(run);
          tapped = index === 0;
          return Promise.resolve('done');
        },
        stopping: () => tapped,
      },
      5000,
    );
    expect(statuses).toEqual(['done']);
    expect(runs).toHaveLength(1);
    expect(before.steps).toEqual(['upload 0', 'uploaded 0 code0']);
  });

  it('gives up waiting on work that takes too long, and not on work in time', async () => {
    const never = new Promise<number>(() => undefined);
    expect(await within(never, 15000, () => Promise.resolve())).toEqual({ ok: false });
    const never2 = new Promise<void>(() => undefined);
    expect(await within(Promise.resolve(3), 15000, () => never2)).toEqual({ ok: true, value: 3 });
  });
});
