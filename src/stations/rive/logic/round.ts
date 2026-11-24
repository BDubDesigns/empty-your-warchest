import { Rng, type EventLogger } from '../../../core';
import type { Riving, RivingFeel, RivingLog } from '../../../data';
import { Lever, type LeverResult } from './lever';
import {
  alongCheck,
  clampAim,
  DEG,
  grainsCut,
  grainsKept,
  logMultiplier,
  middle,
  normalize,
  sizeOf,
  splitPiece,
  splittable,
  thinSide,
  unevenness,
  wholeLog,
  type Fate,
  type Piece,
  type Size,
} from './pieces';

/** The froe stays this far (radians) inside a piece's edges. */
const AIM_MARGIN = 2 * DEG;

const degrees = (radians: number) => Math.round(normalize(radians) / DEG);

export type RivingPhase =
  /** Turning the froe on the chosen piece. */
  | { kind: 'aim'; piece: string; angle: number }
  /** The mallet coming down on the froe. */
  | { kind: 'swing'; piece: string; angle: number; at: number }
  | { kind: 'lever'; piece: string; angle: number; lever: Lever }
  | { kind: 'done' };

/** What a split at the current aim would make, for the guide. */
export interface AimPreview {
  pieces: [Piece, Piece];
  sizes: [Size, Size];
  /** 0 (even) to 1: how hard it will pull to the thin side. */
  unevenness: number;
  thin: 0 | 1;
  /** Grains (by index) the line would cut through, and whether it runs through rot or a check. */
  cut: number[];
  throughRot: boolean;
  check: boolean;
}

/** Things a view plays effects for. */
export type RivingEvent =
  | { type: 'strike'; piece: string }
  | {
      type: 'split';
      piece: Piece;
      angle: number;
      result: LeverResult;
      children: [Piece, Piece];
      /** The side a runout lost. */
      lost: Piece | undefined;
      /** Grains the line cut through: cancelled, good or bad. */
      cut: number[];
    }
  /** A piece that's done: a stave, kindling, or lost. */
  | { type: 'finished'; piece: Piece; fate: Fate }
  | {
      type: 'done';
      staves: number;
      /** The grains that counted, and what they multiplied the staves by (capped). */
      kept: number[];
      multiplier: number;
      /** Staves × multiplier, rounded down: what the log banks. */
      worth: number;
      banked: number;
    };

export interface RivingHooks {
  logger: EventLogger;
  /** Read every time, so live tuning applies at once. */
  feel: () => RivingFeel;
  rules: Riving;
  /**
   * Banks a finished log: runs the riving recipe for `worth` staves (its staves × its grains;
   * uses up the log), paying XP on the `staves` split. Returns the staves banked.
   */
  bank: (worth: number, staves: number) => number;
  onEvent?: (event: RivingEvent) => void;
}

/**
 * Riving one log, without any rendering: pick a piece, aim the froe anywhere across it, strike,
 * and lever the crack open while leaning against its pull to the thin side. A piece the width of
 * a stave can be kept or split again; the log is done when you finish it (or nothing is left to
 * split). A view feeds it input and time, and draws its state.
 */
export class RivingRound {
  readonly log: RivingLog;
  /** Pieces still to decide on: slabs to split, and staves you could split again. */
  pieces: Piece[] = [wholeLog()];
  /** Pieces that are done, and what became of them. */
  finished: { piece: Piece; fate: Fate }[] = [];
  phase: RivingPhase;
  now = 0;
  /** The log's grains (by index) no split has cut through yet. */
  live: Set<number>;
  readonly #hooks: RivingHooks;
  readonly #rng: Rng;
  #splitStart = 0;
  #banked = false;

  constructor(log: RivingLog, hooks: RivingHooks, seed: number) {
    this.log = log;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.live = new Set(log.grains.map((_, index) => index));
    this.phase = { kind: 'aim', piece: 'log', angle: 0 };
    this.#log('riving.logStart', {
      log: log.id,
      seed,
      grains: log.grains.map((grain) => grain.kind),
      checks: log.checks.length,
      feel: hooks.feel(),
    });
  }

  get feel(): RivingFeel {
    return this.#hooks.feel();
  }

  get rules(): Riving {
    return this.#hooks.rules;
  }

  /** The piece being worked on, if any. */
  get current(): Piece | undefined {
    const phase = this.phase;
    return phase.kind === 'done'
      ? undefined
      : this.pieces.find((piece) => piece.id === phase.piece);
  }

  /** Staves banked so far, and staves still on the block that would count if you finished now. */
  get staves(): number {
    return this.finished.filter((entry) => entry.fate === 'stave').length;
  }

  get stavesReady(): number {
    return this.pieces.filter((piece) => sizeOf(this.rules, piece) === 'stave').length;
  }

  /** The most staves a log can give: every piece as thin as a stave can be. */
  get maxStaves(): number {
    return Math.floor(360 / this.rules.stave.min);
  }

  /** You can finish once no slab is left (the staves on the block are kept). */
  get canFinish(): boolean {
    return (
      this.phase.kind === 'aim' &&
      this.pieces.every((piece) => sizeOf(this.rules, piece) === 'stave')
    );
  }

  /** The grains that count so far: whole, in a stave kept or ready to keep. */
  get kept(): number[] {
    return grainsKept(this.log, this.#keepers(), this.live);
  }

  /** What the grains could still multiply the log by: every grain not cut or lost (capped). */
  get multiplierLeft(): number {
    const gone = this.finished
      .filter((entry) => entry.fate !== 'stave')
      .map((entry) => entry.piece);
    const alive = [...this.live].filter(
      (index) => grainsKept(this.log, gone, new Set([index])).length === 0,
    );
    return logMultiplier(this.rules, this.log, alive);
  }

  // Aiming

  /** Picks another piece to split next (only while aiming). */
  select(pieceId: string): void {
    const piece = this.pieces.find((entry) => entry.id === pieceId);
    if (!piece || this.phase.kind !== 'aim' || !splittable(this.rules, piece)) return;
    this.phase = { kind: 'aim', piece: piece.id, angle: middle(piece) };
  }

  /** Turns the froe to `angle` (radians round the pith), kept inside the piece. */
  aimTo(angle: number): void {
    const phase = this.phase;
    const piece = this.current;
    if (phase.kind !== 'aim' || !piece) return;
    phase.angle = clampAim(piece, angle, AIM_MARGIN);
  }

  /** Fine-tune buttons: −1 turns the froe one way, +1 the other. */
  nudge(direction: 1 | -1): void {
    const phase = this.phase;
    if (phase.kind !== 'aim') return;
    this.aimTo(phase.angle + direction * this.feel.fineAimStep * DEG);
  }

  get aimPreview(): AimPreview | undefined {
    const phase = this.phase;
    const piece = this.current;
    if (phase.kind !== 'aim' || !piece) return undefined;
    const pieces = splitPiece(piece, phase.angle);
    const cut = grainsCut(this.log, piece, phase.angle, this.live);
    return {
      pieces,
      sizes: [sizeOf(this.rules, pieces[0]), sizeOf(this.rules, pieces[1])],
      unevenness: unevenness(piece, phase.angle),
      thin: thinSide(pieces),
      cut,
      throughRot: cut.some((index) => this.log.grains[index]?.kind === 'rot'),
      check: alongCheck(this.rules, this.log, piece, phase.angle),
    };
  }

  // Striking and levering

  /** The mallet comes down on the froe: commits the aim. */
  strike(): void {
    const phase = this.phase;
    if (phase.kind !== 'aim' || !this.current) return;
    this.#splitStart = this.now;
    this.#hooks.onEvent?.({ type: 'strike', piece: phase.piece });
    this.phase = { kind: 'swing', piece: phase.piece, angle: phase.angle, at: this.now };
  }

  /** The handle has been pulled down `pixels` since levering began. */
  drag(pixels: number): void {
    if (this.phase.kind === 'lever') this.phase.lever.drag(pixels);
  }

  /** Leaning on the handle, −1 to 1 (toward the thin side is positive). */
  lean(amount: number): void {
    if (this.phase.kind === 'lever') this.phase.lever.lean(amount);
  }

  /** Keeps the staves on the block and ends the log (once no slab is left). */
  finish(): void {
    if (!this.canFinish) return;
    for (const piece of this.pieces) this.#finishPiece(piece, 'stave');
    this.pieces = [];
    this.phase = { kind: 'done' };
    this.#done();
  }

  // Time

  tick(dt: number): void {
    this.now += dt;
    const phase = this.phase;
    if (phase.kind === 'swing' && this.now - phase.at >= this.feel.strikeSeconds) {
      const piece = this.current;
      if (!piece) return;
      const cut = grainsCut(this.log, piece, phase.angle, this.live);
      const lever = new Lever(() => this.feel, {
        unevenness: unevenness(piece, phase.angle),
        width: piece.width / DEG,
        onCheck: alongCheck(this.rules, this.log, piece, phase.angle),
        throughRot: cut.some((index) => this.log.grains[index]?.kind === 'rot'),
        seed: Math.floor(this.#rng.range(0, 2 ** 31)),
      });
      this.phase = { kind: 'lever', piece: phase.piece, angle: phase.angle, lever };
    } else if (phase.kind === 'lever') {
      const result = phase.lever.tick(dt);
      if (result) this.#levered(phase, result);
    }
  }

  /** Leaving mid-log: nothing is banked and the log isn't used up. */
  exit(): void {
    if (this.phase.kind === 'done') return;
    this.#log('riving.leave', {
      log: this.log.id,
      staves: this.staves + this.stavesReady,
      piecesLeft: this.pieces.length,
      seconds: Math.round(this.now * 10) / 10,
    });
  }

  #levered(phase: Extract<RivingPhase, { kind: 'lever' }>, result: LeverResult): void {
    const piece = this.current;
    if (!piece) return;
    const rules = this.rules;
    const children = splitPiece(piece, phase.angle);
    const thin = thinSide(children);
    // Run out to the thin side: it's lost. Over-leaned to the thick side: that one is.
    const lost =
      result === 'thin' ? children[thin] : result === 'thick' ? children[1 - thin] : undefined;
    const cut = grainsCut(this.log, piece, phase.angle, this.live);
    for (const index of cut) this.live.delete(index);
    this.pieces = this.pieces.filter((entry) => entry.id !== piece.id);
    const lever = phase.lever;
    this.#log('riving.split', {
      log: this.log.id,
      piece: piece.id,
      width: Math.round(piece.width / DEG),
      angle: degrees(phase.angle),
      sides: children.map((child) => Math.round(child.width / DEG)),
      unevenness: Math.round(unevenness(piece, phase.angle) * 100) / 100,
      check: alongCheck(rules, this.log, piece, phase.angle),
      grainsCut: cut.map((index) => this.log.grains[index]?.kind),
      result,
      seconds: Math.round((this.now - this.#splitStart) * 100) / 100,
      leverSeconds: Math.round(lever.seconds * 100) / 100,
      peakSpeed: Math.round(lever.peakSpeed * 100) / 100,
      peakOffset: Math.round(lever.peakOffset * 100) / 100,
    });
    this.#hooks.onEvent?.({
      type: 'split',
      piece,
      angle: phase.angle,
      result,
      children,
      lost,
      cut,
    });
    for (const child of children) {
      if (child === lost) this.#finishPiece(child, 'runout');
      else if (sizeOf(rules, child) === 'kindling') this.#finishPiece(child, 'kindling');
      else if (!splittable(rules, child)) this.#finishPiece(child, 'stave');
      else this.pieces.push(child);
    }
    // Next: the widest piece still to split; if only staves are left you can finish or go on.
    const next = [...this.pieces].sort((a, b) => b.width - a.width)[0];
    if (next) {
      this.phase = { kind: 'aim', piece: next.id, angle: middle(next) };
      return;
    }
    this.phase = { kind: 'done' };
    this.#done();
  }

  /** Staves kept: finished ones and, for what-ifs, the stave-wide pieces still on the block. */
  #keepers(): Piece[] {
    return [
      ...this.finished.filter((entry) => entry.fate === 'stave').map((entry) => entry.piece),
      ...this.pieces.filter((piece) => sizeOf(this.rules, piece) === 'stave'),
    ];
  }

  #finishPiece(piece: Piece, fate: Fate): void {
    this.finished.push({ piece, fate });
    this.#hooks.onEvent?.({ type: 'finished', piece, fate });
  }

  #done(): void {
    if (this.#banked) return;
    this.#banked = true;
    const staves = this.staves;
    const kept = this.kept;
    const multiplier = logMultiplier(this.rules, this.log, kept);
    const worth = Math.floor(staves * multiplier + 1e-9);
    const banked = this.#hooks.bank(worth, staves);
    const count = (fate: Fate) => this.finished.filter((entry) => entry.fate === fate).length;
    this.#log('riving.logEnd', {
      log: this.log.id,
      staves,
      multiplier,
      worth,
      runouts: count('runout'),
      kindling: count('kindling'),
      grainsKept: kept.map((index) => this.log.grains[index]?.kind),
      grainsCut: this.log.grains.filter((_, index) => !this.live.has(index)).map((g) => g.kind),
      seconds: Math.round(this.now * 10) / 10,
    });
    this.#hooks.onEvent?.({ type: 'done', staves, kept, multiplier, worth, banked });
  }

  #log(type: string, data: Record<string, unknown>): void {
    this.#hooks.logger.log(type, data);
  }
}
