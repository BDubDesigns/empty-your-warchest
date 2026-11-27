import type { Graphics } from '../data';
import { LiveChoice, type Choice, type ChoiceOption } from './liveChoice';
import type { EventLogger } from './logger';
import type { KeyValueStore } from './storage';

/**
 * How much the 3D screens draw: `high` as designed, or `low` for cheap phones (cheaper shadows, less
 * debris and dust, simpler trees). Only looks: the rules are the same on both.
 */
export type GraphicsTier = 'high' | 'low';
/** Debug → Graphics: picked for this phone (`auto`, the default), or forced. */
export type GraphicsSetting = 'auto' | GraphicsTier;

/** What the browser says about this phone, for the auto pick. Each may be missing. */
export interface DeviceHints {
  /** The WebGL renderer's name ("Mali-G57 MC2"). */
  gpu?: string;
  /** navigator.deviceMemory (GB, rounded to a power of two; Chrome only). */
  memoryGb?: number;
  /** navigator.hardwareConcurrency (logged only: budget phones have eight slow cores too). */
  cores?: number;
}

/** The tier, and why: forced in Debug, the GPU's name, little memory, slow frames, or nothing. */
export interface TierPick {
  tier: GraphicsTier;
  reason: 'forced' | 'gpu' | 'memory' | 'frames' | 'default';
  /** The GPU, the memory or the frame time it went by. */
  detail?: string;
}

/**
 * Picks the tier: the setting if it's forced; otherwise low for a budget GPU (by name), little
 * memory, or a slow median frame time measured in play before (`slowMs`), and high if none of them.
 */
export function pickTier(
  setting: GraphicsSetting,
  hints: DeviceHints,
  slowMs: number | undefined,
  rules: Graphics,
): TierPick {
  if (setting !== 'auto') return { tier: setting, reason: 'forced' };
  const { gpu, memoryGb } = hints;
  if (gpu !== undefined && rules.lowGpus.some((source) => new RegExp(source, 'i').test(gpu))) {
    return { tier: 'low', reason: 'gpu', detail: gpu };
  }
  if (memoryGb !== undefined && memoryGb <= rules.lowMemoryGb) {
    return { tier: 'low', reason: 'memory', detail: `${String(memoryGb)} GB` };
  }
  if (slowMs !== undefined) {
    return { tier: 'low', reason: 'frames', detail: `median ${String(slowMs)} ms` };
  }
  return { tier: 'high', reason: 'default' };
}

/** The median of some frame times (ms), and whether it's too slow for high. */
export function judgeFrames(
  frames: readonly number[],
  rules: Graphics,
): { medianMs: number; slow: boolean } {
  const sorted = [...frames].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return { medianMs, slow: medianMs > rules.slowFrameMs };
}

const SETTING_KEY = 'warchest.graphics';
/** A slow median frame time measured in play, kept: this phone stays on low (on Auto). */
const SLOW_KEY = 'warchest.graphics.slowMs';

const OPTIONS: readonly ChoiceOption<GraphicsSetting>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
];

/**
 * The graphics tier for this phone, shared by every 3D screen: Debug → Graphics (Auto, High or
 * Low, kept on the phone), and on Auto the pick from the device's hints and its frame times in
 * play (fed by the screens through `sample`). Every pick is logged as `graphics.tier`.
 */
export class GraphicsSettings implements Choice<GraphicsSetting> {
  readonly label = 'Graphics';
  readonly options = OPTIONS;
  readonly #rules: Graphics;
  readonly #store: KeyValueStore;
  readonly #logger: EventLogger;
  readonly #setting: LiveChoice<GraphicsSetting>;
  readonly #hints: DeviceHints;
  readonly #choiceListeners = new Set<(value: GraphicsSetting) => void>();
  readonly #tierListeners = new Set<(pick: TierPick) => void>();
  #slowMs: number | undefined;
  #pick: TierPick;
  #frames: number[] = [];
  /** This session's frames have been judged (once is enough). */
  #judged = false;

  constructor(rules: Graphics, store: KeyValueStore, logger: EventLogger, hints: DeviceHints) {
    this.#rules = rules;
    this.#store = store;
    this.#logger = logger;
    this.#hints = { ...hints };
    this.#setting = new LiveChoice(SETTING_KEY, this.label, OPTIONS, 'auto', store);
    this.#slowMs = this.#loadSlow();
    this.#pick = pickTier(this.value, this.#hints, this.#slowMs, rules);
    this.#log('boot');
  }

  get value(): GraphicsSetting {
    return this.#setting.value;
  }

  /** The tier to draw at. */
  get tier(): GraphicsTier {
    return this.#pick.tier;
  }

  get pick(): TierPick {
    return { ...this.#pick };
  }

  /** What Auto picked and why, for the debug menu ("Auto picked Low: GPU Mali-G57 MC2"). */
  get detail(): string {
    const { tier, reason, detail } = this.#pick;
    const name = tier === 'high' ? 'High' : 'Low';
    if (reason === 'forced') return `Forced ${name}`;
    const why = {
      gpu: `GPU ${detail ?? ''}`,
      memory: `memory ${detail ?? ''}`,
      frames: `slow frames (${detail ?? ''})`,
      default: 'nothing says this phone is slow',
    }[reason];
    return `Auto picked ${name}: ${why}`;
  }

  set(value: GraphicsSetting): void {
    // Back to Auto from a forced tier: pick afresh, frame times and all.
    if (value === 'auto' && this.value !== 'auto') {
      this.#slowMs = undefined;
      this.#frames = [];
      this.#judged = false;
      try {
        this.#store.remove(SLOW_KEY);
      } catch {
        // No storage: it's forgotten for this session anyway.
      }
    }
    this.#setting.set(value);
    this.#repick('setting');
  }

  /** Called with the setting whenever it or what Auto picked changes (the debug menu's buttons). */
  onChange(listener: (value: GraphicsSetting) => void): () => void {
    this.#choiceListeners.add(listener);
    return () => this.#choiceListeners.delete(listener);
  }

  /** Called whenever the tier changes. */
  onTier(listener: (pick: TierPick) => void): () => void {
    this.#tierListeners.add(listener);
    return () => this.#tierListeners.delete(listener);
  }

  /** The GPU's name, once a WebGL context has been made (the first one to say counts). */
  noteGpu(name: string): void {
    if (this.#hints.gpu !== undefined || name === '') return;
    this.#hints.gpu = name;
    // Logged even if the pick stands: the GPU's name is worth having in every log.
    this.#repick('gpu', true);
  }

  /**
   * One frame's time (ms) in a calm moment of play (aiming, nothing falling), from any 3D screen.
   * On Auto and high, once `sampleFrames` have come in their median is judged: too slow, and this
   * phone goes to low for good (kept, until Debug → Graphics is set back to Auto).
   */
  sample(frameMs: number): void {
    if (this.#judged || this.value !== 'auto' || this.#pick.tier === 'low') return;
    this.#frames.push(frameMs);
    if (this.#frames.length < this.#rules.sampleFrames) return;
    this.#judged = true;
    const { medianMs, slow } = judgeFrames(this.#frames, this.#rules);
    this.#frames = [];
    const rounded = Math.round(medianMs * 10) / 10;
    this.#logger.log('graphics.sample', { medianMs: rounded, slow });
    if (!slow) return;
    this.#slowMs = rounded;
    try {
      this.#store.set(SLOW_KEY, String(rounded));
    } catch {
      // Not kept: low for this session only.
    }
    this.#repick('frames');
  }

  #repick(cause: string, log = false): void {
    const before = this.#pick;
    this.#pick = pickTier(this.value, this.#hints, this.#slowMs, this.#rules);
    const pick = this.#pick;
    if (
      log ||
      pick.tier !== before.tier ||
      pick.reason !== before.reason ||
      pick.detail !== before.detail
    ) {
      this.#log(cause);
    }
    if (pick.tier !== before.tier) for (const listener of this.#tierListeners) listener(this.pick);
    for (const listener of this.#choiceListeners) listener(this.value);
  }

  #log(cause: string): void {
    this.#logger.log('graphics.tier', {
      ...this.#pick,
      setting: this.value,
      cause,
      gpu: this.#hints.gpu,
      memoryGb: this.#hints.memoryGb,
      cores: this.#hints.cores,
    });
  }

  #loadSlow(): number | undefined {
    let saved: string | null = null;
    try {
      saved = this.#store.get(SLOW_KEY);
    } catch {
      // No storage: nothing kept.
    }
    const value = saved === null ? NaN : Number(saved);
    return Number.isFinite(value) ? value : undefined;
  }
}
