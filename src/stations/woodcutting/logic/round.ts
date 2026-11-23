import { Rng, type EventLogger } from '../../../core';
import type { Clearing, WoodcuttingFeel } from '../../../data';
import { angleBeforeLift, nudgeAim, type AimSample } from './aim';
import { resolveChain, type FallStep } from './chain';
import { fallTimeToReach } from './fall';
import { chainLogs, starsFor, type StarThresholds } from './score';
import {
  chopDamage,
  judgeSwing,
  markerPosition,
  nextTarget,
  swingScatter,
  yellowWidth,
  type SwingResult,
} from './swing';

/** Seconds of finger movement ignored just before it lifts (fingers roll as they come up). */
export const LIFT_IGNORE = 0.1;

const DEG = Math.PI / 180;
/** Whole degrees in 0–359, for logs. */
const degrees = (radians: number) => Math.round((((radians / DEG) % 360) + 360) % 360);
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** An axe swing in flight, from release to impact. */
export interface RoundSwing {
  /** How far the axe was pulled back (0–1): its power. */
  pull: number;
  at: number;
  result: SwingResult;
  points: number;
  marker: number;
  target: number;
  /** How far (radians) this chop knocks the aim off. */
  drift: number;
  holdSeconds: number;
}

export type RoundPhase =
  | { kind: 'pick' }
  | {
      kind: 'aim';
      tree: string;
      angle: number | undefined;
      dragging: boolean;
      samples: AimSample[];
      adjustments: number;
      startedAt: number;
    }
  | {
      kind: 'chop';
      tree: string;
      angle: number;
      points: number;
      /** Center of the yellow zone on the bar, 0–1. Moves after every chop. */
      target: number;
      hold: { at: number; pull: number; sweep: number } | undefined;
      swing: RoundSwing | undefined;
    }
  | { kind: 'falling' }
  | { kind: 'cleared' };

export interface RoundFaller {
  step: FallStep;
  /** Round time (s) when this tree starts to tip over. */
  start: number;
  /** Round time (s) when the tree that knocks it over first touches it (hit trees only). */
  contact: number | undefined;
  touched: boolean;
  landed: boolean;
}

/** Things a view plays effects for. */
export type RoundEvent =
  | { type: 'impact'; tree: string; swing: RoundSwing; angle: number; points: number }
  | { type: 'fell'; steps: FallStep[] }
  /** A falling tree's canopy reaches the next tree's trunk, knocking it over. */
  | { type: 'hit'; step: FallStep }
  | { type: 'landed'; step: FallStep; count: number }
  | { type: 'banked'; trees: number; logs: number }
  | { type: 'cleared' };

export interface RoundHooks {
  logger: EventLogger;
  /** Read every time, so live tuning applies at once. */
  feel: () => WoodcuttingFeel;
  /**
   * Banks a chain into the warchest: `batches` runs of the felling recipe (a chain of N trees
   * is worth N^chainExponent of them; `trees` is N). Returns the logs gained.
   */
  bank: (batches: number, trees: number) => number;
  /** Economy: a chain of N trees banks N^chainExponent logs. Defaults to 1 (a log per tree). */
  chainExponent?: number;
  onEvent?: (event: RoundEvent) => void;
  /** Which view is playing, for the logs (e.g. '3d'). */
  view: string;
  /** The clearing's par and the star thresholds, for the round's stars. */
  stars?: StarThresholds & { par: number };
}

/**
 * One round of domino felling, without any rendering: aim, chop, the chain, banking and
 * logging. A view feeds it input and time, and draws its state.
 */
export class WoodcuttingRound {
  readonly clearing: Clearing;
  phase: RoundPhase = { kind: 'pick' };
  standing = new Set<string>();
  fallers: RoundFaller[] = [];
  /** Round time in seconds. */
  now = 0;
  felled = 0;
  logs = 0;
  readonly #hooks: RoundHooks;
  #rng: Rng;
  #ended = false;
  #startedAt = 0;

  constructor(clearing: Clearing, hooks: RoundHooks, seed: number) {
    this.clearing = clearing;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.start(seed);
  }

  get feel(): WoodcuttingFeel {
    return this.#hooks.feel();
  }

  /** 0–3 stars for the logs banked so far against par (0 without a par). */
  get stars(): number {
    const stars = this.#hooks.stars;
    return stars ? starsFor(this.logs, stars.par, stars) : 0;
  }

  get par(): number | undefined {
    return this.#hooks.stars?.par;
  }

  start(seed: number): void {
    this.#rng = new Rng(seed);
    this.standing = new Set(this.clearing.trees.map((tree) => tree.id));
    this.fallers = [];
    this.felled = 0;
    this.logs = 0;
    this.#ended = false;
    this.#startedAt = this.now;
    this.phase = { kind: 'pick' };
    this.#log('woodcutting.roundStart', {
      clearing: this.clearing.id,
      trees: this.clearing.trees.length,
      seed,
      par: this.par,
      view: this.#hooks.view,
      feel: this.feel,
    });
  }

  // Aiming

  /** Touching a standing tree: picks it, switches to it, or starts re-aiming it. */
  touchTree(treeId: string): void {
    if (!this.standing.has(treeId)) return;
    const phase = this.phase;
    if (phase.kind === 'aim' && phase.tree === treeId) {
      this.phase = { ...phase, dragging: true, samples: [] };
      return;
    }
    if (phase.kind !== 'pick' && phase.kind !== 'aim') return;
    this.phase = {
      kind: 'aim',
      tree: treeId,
      angle: undefined,
      dragging: true,
      samples: [],
      adjustments: 0,
      startedAt: this.now,
    };
    this.#log('woodcutting.select', { tree: treeId });
  }

  /** The finger moved while pulling back to aim; undefined while it's still on the tree. */
  aimTo(angle: number | undefined): void {
    const phase = this.phase;
    if (phase.kind !== 'aim' || !phase.dragging || angle === undefined) return;
    phase.samples.push({ t: this.now, angle });
    phase.angle = angle;
  }

  /** The finger lifted: the aim stays where it was just before. */
  releaseAim(): void {
    const phase = this.phase;
    if (phase.kind !== 'aim' || !phase.dragging) return;
    const angle = angleBeforeLift(phase.samples, this.now, LIFT_IGNORE) ?? phase.angle;
    this.phase = {
      ...phase,
      angle,
      dragging: false,
      samples: [],
      adjustments: phase.adjustments + (phase.samples.length > 0 ? 1 : 0),
    };
  }

  /** Fine-tune buttons: −1 turns the aim counter-clockwise, +1 clockwise. */
  nudge(direction: 1 | -1): void {
    const phase = this.phase;
    if (phase.kind !== 'aim' || phase.angle === undefined || phase.dragging) return;
    phase.angle = nudgeAim(phase.angle, direction, this.feel.fineAimStep);
    phase.adjustments += 1;
  }

  get canChop(): boolean {
    return this.phase.kind === 'aim' && this.phase.angle !== undefined && !this.phase.dragging;
  }

  /** Commits the aim and starts chopping. */
  chop(): void {
    const phase = this.phase;
    if (phase.kind !== 'aim' || phase.angle === undefined || phase.dragging) return;
    this.#log('woodcutting.aim', {
      tree: phase.tree,
      angle: degrees(phase.angle),
      aimSeconds: Math.round((this.now - phase.startedAt) * 10) / 10,
      adjustments: phase.adjustments,
    });
    this.phase = {
      kind: 'chop',
      tree: phase.tree,
      angle: phase.angle,
      points: 0,
      target: nextTarget(this.feel, this.#rng),
      hold: undefined,
      swing: undefined,
    };
  }

  // Chopping

  /** Grab the axe and start pulling it back; the bar marker starts sweeping. */
  grab(): void {
    const phase = this.phase;
    if (phase.kind !== 'chop' || phase.swing || phase.hold) return;
    phase.hold = { at: this.now, pull: 0, sweep: 0 };
  }

  /** How far the axe is pulled back, 0–1. */
  setPull(pull: number): void {
    const phase = this.phase;
    if (phase.kind !== 'chop' || !phase.hold) return;
    phase.hold.pull = Math.min(Math.max(pull, 0), 1);
  }

  /** Let go: the axe swings in. A grab that was never pulled back does nothing. */
  releaseAxe(): void {
    const phase = this.phase;
    if (phase.kind !== 'chop' || !phase.hold) return;
    const { hold } = phase;
    phase.hold = undefined;
    if (hold.pull <= 0) return;
    const feel = this.feel;
    const marker = markerPosition(hold.sweep);
    const result = judgeSwing(marker, phase.target, hold.pull, feel);
    phase.swing = {
      pull: hold.pull,
      at: this.now,
      result,
      points: chopDamage(hold.pull, result, feel),
      marker,
      target: phase.target,
      drift: swingScatter(result, feel, this.#rng),
      holdSeconds: this.now - hold.at,
    };
  }

  /** Where the bar marker is, or undefined when the axe isn't held or swinging. */
  get marker(): number | undefined {
    const phase = this.phase;
    if (phase.kind !== 'chop') return undefined;
    if (phase.hold) return markerPosition(phase.hold.sweep);
    return phase.swing?.marker;
  }

  /** Width of the yellow zone right now (it narrows as the axe is pulled harder). */
  get yellowWidth(): number {
    const phase = this.phase;
    const pull = phase.kind === 'chop' ? (phase.hold?.pull ?? phase.swing?.pull ?? 0) : 0;
    return yellowWidth(pull, this.feel);
  }

  /** How far back the axe is right now (0–1), including the swing in after release. */
  get axeBack(): number {
    const phase = this.phase;
    if (phase.kind !== 'chop') return 0;
    if (phase.hold) return phase.hold.pull;
    if (!phase.swing) return 0;
    const t = Math.min((this.now - phase.swing.at) / this.feel.swingSeconds, 1);
    return phase.swing.pull * (1 - t * t);
  }

  // Time

  tick(dt: number): void {
    this.now += dt;
    const phase = this.phase;
    if (phase.kind === 'chop') {
      if (phase.hold) phase.hold.sweep += dt * this.feel.meterSpeed;
      if (phase.swing && this.now - phase.swing.at >= this.feel.swingSeconds) this.#impact();
    } else if (phase.kind === 'falling') {
      this.#advanceFall();
    }
  }

  /** Leaving mid-round: bank anything already falling, and log the round's end. */
  exit(): void {
    this.#bank();
    this.#end('exit');
  }

  #impact(): void {
    const phase = this.phase;
    if (phase.kind !== 'chop' || !phase.swing) return;
    const swing = phase.swing;
    const angle = phase.angle + swing.drift;
    const points = phase.points + swing.points;
    this.#log('woodcutting.chop', {
      tree: phase.tree,
      result: swing.result,
      pull: round3(swing.pull),
      marker: round3(swing.marker),
      target: round3(swing.target),
      offset: round3(Math.abs(swing.marker - swing.target)),
      holdSeconds: Math.round(swing.holdSeconds * 100) / 100,
      damage: swing.points,
      drift: Math.round(swing.drift / DEG),
      angle: degrees(angle),
      points,
    });
    this.#hooks.onEvent?.({ type: 'impact', tree: phase.tree, swing, angle, points });
    if (points >= this.feel.chopPoints) {
      this.#fell(phase.tree, angle);
    } else {
      this.phase = {
        ...phase,
        angle,
        points,
        swing: undefined,
        target: nextTarget(this.feel, this.#rng),
      };
    }
  }

  #fell(treeId: string, angle: number): void {
    // The chain is decided here, before anything moves; views only play it back.
    const steps = resolveChain(this.clearing, this.standing, treeId, angle);
    const feel = this.feel;
    const heights = new Map(this.clearing.trees.map((tree) => [tree.id, tree.height]));
    const starts = new Map<string, number>();
    this.fallers = steps.map((step) => {
      const hitterStart = step.hitBy === undefined ? undefined : starts.get(step.hitBy);
      const start =
        hitterStart === undefined || step.hitBy === undefined
          ? this.now
          : hitterStart +
            fallTimeToReach(step.hitAt ?? 0, heights.get(step.hitBy) ?? 1, feel.fallEase) *
              feel.fallSeconds +
            feel.chainDelay;
      starts.set(step.tree, start);
      const contact = step.hitBy === undefined ? undefined : start - feel.chainDelay;
      return { step, start, contact, touched: false, landed: false };
    });
    for (const step of steps) this.standing.delete(step.tree);
    this.phase = { kind: 'falling' };
    this.#log('woodcutting.fell', {
      tree: treeId,
      angle: degrees(angle),
      chain: steps.map((step) => step.tree),
      forked: steps.filter((step) => step.trunks.length > 1).map((step) => step.tree),
      length: steps.length,
    });
    this.#hooks.onEvent?.({ type: 'fell', steps });
  }

  #advanceFall(): void {
    for (const faller of this.fallers) {
      if (!faller.touched && faller.contact !== undefined && this.now >= faller.contact) {
        faller.touched = true;
        this.#hooks.onEvent?.({ type: 'hit', step: faller.step });
      }
      if (!faller.landed && this.now >= faller.start + this.feel.fallSeconds) {
        faller.landed = true;
        this.#hooks.onEvent?.({
          type: 'landed',
          step: faller.step,
          count: this.fallers.filter((other) => other.landed).length,
        });
      }
    }
    if (this.fallers.length > 0 && this.fallers.every((faller) => faller.landed)) this.#bank();
  }

  #bank(): void {
    if (this.fallers.length === 0) return;
    const trees = this.fallers.length;
    this.fallers = [];
    const logs = this.#hooks.bank(chainLogs(trees, this.#hooks.chainExponent ?? 1), trees);
    this.felled += trees;
    this.logs += logs;
    this.#log('woodcutting.bank', { trees, logs, roundLogs: this.logs });
    this.#hooks.onEvent?.({ type: 'banked', trees, logs });
    if (this.standing.size === 0) {
      this.phase = { kind: 'cleared' };
      this.#end('cleared');
      this.#hooks.onEvent?.({ type: 'cleared' });
    } else {
      this.phase = { kind: 'pick' };
    }
  }

  #end(reason: 'cleared' | 'exit'): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#log('woodcutting.roundEnd', {
      reason,
      view: this.#hooks.view,
      felled: this.felled,
      logs: this.logs,
      par: this.par,
      stars: this.stars,
      standing: this.standing.size,
      seconds: Math.round((this.now - this.#startedAt) * 10) / 10,
    });
  }

  #log(type: string, data: Record<string, unknown>): void {
    this.#hooks.logger.log(type, data);
  }
}
