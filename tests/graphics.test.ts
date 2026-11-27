import { describe, expect, it } from 'vitest';
import {
  GraphicsSettings,
  MemoryStore,
  judgeFrames,
  pickTier,
  type LogEvent,
  type TierPick,
} from '../src/core';
import { treeStyleFor } from '../src/stations/woodcutting/treeStyle';
import { data, testLogger } from './helpers';

const rules = data.graphics;
/** A frame time well under the slow line, and one well over it (ms). */
const fast = rules.slowFrameMs / 2;
const slow = rules.slowFrameMs * 2;

function settings(store = new MemoryStore(), hints = {}) {
  const { logger } = testLogger();
  const logged: LogEvent[] = [];
  logger.onLog((event) => logged.push(event));
  const graphics = new GraphicsSettings(rules, store, logger, hints);
  const events = (type: string) =>
    logged.filter((event) => event.type === type).map((event) => event.data);
  return { graphics, store, events };
}

describe('graphics tier pick', () => {
  it('puts budget phone GPUs and software rendering on low, by name', () => {
    for (const gpu of [
      'Mali-G57 MC2',
      'Mali-G52 MC2',
      'Mali-T830',
      'Adreno (TM) 610',
      'Adreno (TM) 506',
      'PowerVR Rogue GE8320',
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
    ]) {
      expect(pickTier('auto', { gpu }, undefined, rules)).toEqual({
        tier: 'low',
        reason: 'gpu',
        detail: gpu,
      });
    }
  });

  it('leaves good GPUs on high', () => {
    for (const gpu of [
      'PowerVR D-Series DXT-48',
      'Mali-G715',
      'Mali-G68 MC4',
      'Adreno (TM) 740',
      'Adreno (TM) 619',
      'Apple GPU',
      'ANGLE (NVIDIA, Vulkan 1.4 (NVIDIA GeForce RTX 4070 Laptop GPU), NVIDIA)',
    ]) {
      expect(pickTier('auto', { gpu }, undefined, rules).tier).toBe('high');
    }
  });

  it('goes by memory when the phone says it has little', () => {
    expect(pickTier('auto', { memoryGb: rules.lowMemoryGb }, undefined, rules)).toMatchObject({
      tier: 'low',
      reason: 'memory',
    });
    expect(pickTier('auto', { memoryGb: rules.lowMemoryGb * 2 }, undefined, rules).tier).toBe(
      'high',
    );
    // Safari doesn't say: nothing against high.
    expect(pickTier('auto', {}, undefined, rules)).toEqual({ tier: 'high', reason: 'default' });
  });

  it('keeps a slow frame time measured before, and a forced tier beats everything', () => {
    expect(pickTier('auto', {}, slow, rules)).toMatchObject({ tier: 'low', reason: 'frames' });
    expect(pickTier('high', { gpu: 'Mali-G57 MC2' }, slow, rules)).toEqual({
      tier: 'high',
      reason: 'forced',
    });
    expect(pickTier('low', { gpu: 'Apple GPU' }, undefined, rules)).toEqual({
      tier: 'low',
      reason: 'forced',
    });
  });

  it('judges frames by their median, so a few hitches are not enough', () => {
    const frames = Array.from({ length: 9 }, (_, index) => (index < 4 ? slow * 3 : fast));
    expect(judgeFrames(frames, rules)).toEqual({ medianMs: fast, slow: false });
    expect(judgeFrames([fast, slow, slow], rules)).toEqual({ medianMs: slow, slow: true });
  });
});

describe('GraphicsSettings', () => {
  it('starts on Auto, picks again when the GPU is known, and logs every pick', () => {
    const { graphics, events } = settings(new MemoryStore(), { memoryGb: 8, cores: 8 });
    expect(graphics.value).toBe('auto');
    expect(graphics.tier).toBe('high');
    const tiers: TierPick[] = [];
    graphics.onTier((pick) => tiers.push(pick));
    graphics.noteGpu('Mali-G57 MC2');
    expect(graphics.tier).toBe('low');
    expect(tiers).toEqual([{ tier: 'low', reason: 'gpu', detail: 'Mali-G57 MC2' }]);
    expect(graphics.detail).toBe('Auto picked Low: GPU Mali-G57 MC2');
    // Only the first context's name counts.
    graphics.noteGpu('Apple GPU');
    expect(graphics.tier).toBe('low');
    expect(events('graphics.tier')).toEqual([
      expect.objectContaining({ tier: 'high', reason: 'default', cause: 'boot', memoryGb: 8 }),
      expect.objectContaining({ tier: 'low', reason: 'gpu', cause: 'gpu', gpu: 'Mali-G57 MC2' }),
    ]);
  });

  it('goes to low for good after slow calm frames, until set back to Auto', () => {
    const store = new MemoryStore();
    const { graphics, events } = settings(store);
    graphics.noteGpu('Apple GPU');
    for (let frame = 0; frame < rules.sampleFrames - 1; frame++) graphics.sample(slow);
    expect(graphics.tier).toBe('high');
    graphics.sample(slow);
    expect(graphics.tier).toBe('low');
    expect(graphics.pick.reason).toBe('frames');
    expect(events('graphics.sample')).toEqual([{ medianMs: slow, slow: true }]);
    // Kept on the phone: still low next time.
    const again = settings(store).graphics;
    again.noteGpu('Apple GPU');
    expect(again.tier).toBe('low');
    // Forced high, then back to Auto: judged afresh.
    again.set('high');
    expect(again.tier).toBe('high');
    again.set('auto');
    expect(again.tier).toBe('high');
    for (let frame = 0; frame < rules.sampleFrames; frame++) again.sample(fast);
    expect(again.tier).toBe('high');
  });

  it('judges a session once, and only on Auto and high', () => {
    const { graphics, events } = settings();
    for (let frame = 0; frame < rules.sampleFrames; frame++) graphics.sample(fast);
    for (let frame = 0; frame < rules.sampleFrames; frame++) graphics.sample(slow);
    expect(graphics.tier).toBe('high');
    expect(events('graphics.sample')).toHaveLength(1);
    const forced = settings().graphics;
    forced.set('high');
    for (let frame = 0; frame < rules.sampleFrames; frame++) forced.sample(slow);
    expect(forced.tier).toBe('high');
    expect(forced.detail).toBe('Forced High');
  });

  it('keeps the forced setting on the phone, and tells the debug menu when the pick changes', () => {
    const store = new MemoryStore();
    const { graphics } = settings(store);
    const seen: string[] = [];
    graphics.onChange((value) => seen.push(value));
    graphics.set('low');
    expect(settings(store).graphics.value).toBe('low');
    graphics.set('auto');
    graphics.noteGpu('Mali-G52 MC2');
    expect(seen).toEqual(['low', 'auto', 'auto']);
  });
});

describe('woodcutting trees on Auto', () => {
  it('follow the tier unless a style was picked', () => {
    expect(treeStyleFor('auto', 'high')).toBe('quaternius');
    expect(treeStyleFor('auto', 'low')).toBe('kenney');
    expect(treeStyleFor('quaternius', 'low')).toBe('quaternius');
    expect(treeStyleFor('kenney', 'high')).toBe('kenney');
  });
});
