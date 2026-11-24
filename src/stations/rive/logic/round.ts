import { Rng, type EventLogger } from '../../../core';
import type { Riving, RivingFeel, RivingLog } from '../../../data';
import { Lever, type LeverResult } from './lever';
import {
  alongCheck,
  clampAim,
  DEG,
  grainsCut,
  isStave,
  isWhole,
  middle,
  normalize,
  offCentre,
  smallerSide,
  splitPiece,
  staveWorth,
  wholeLog,
  type Fate,
  type Piece,
} from './pieces';

/** The froe stays this far (radians) inside a piece's edges. */
const AIM_MARGIN = 6 * DEG;
/** How far off a piece's middle the froe starts, at most (share of the piece). */
const START_SPREAD = 0.35;

const degrees = (radians: number) => Math.round(normalize(radians) / DEG);

export type RivingPhase =
  /** Turning the froe on the chosen piece. */
  | { kind: 'aim'; piece: string; angle: number }
  /** The mallet coming down on the froe. */
  | { kind: 'swing'; piece: string; angle: number; at: number }
  | { kind: 'lever'; piece: string; angle: number; lever: Lever }
  /** The crack bound (levered too slowly): strike again to carry on. */
  | { kind: 'bound'; piece: string; angle: number; lever: Lever }
  | { kind: 'done' };

/** Things a view plays effects for. */
export type RivingEvent =
  | { type: 'strike'; piece: string; again: boolean }
  | { type: 'bound'; piece: string }
  | {
      type: 'split';
      piece: Piece;
      angle: number;
      result: 'clean' | 'runout';
      children: [Piece, Piece];
      /** The smaller side, lost to a runout or to splitting off centre. */
      lost: Piece | undefined;
      offCentre: boolean;
      /** Grains the line cut through: cancelled, good or bad. */
      cut: number[];
    }
  /** A piece that's done: a stave, or lost. */
  | { type: 'finished'; piece: Piece; fate: Fate }
  | { type: 'done'; staves: number; worth: number; banked: number };

export interface RivingHooks {
  logger: EventLogger;
  /** Read every time, so live tuning applies at once. */
  feel: () => RivingFeel;
  rules: Riving;
  /**
   * Banks a finished log: runs the riving recipe for what its staves are worth (uses up the log).
   * Returns the staves banked.
   */
  bank: (staves: number) => number;
  onEvent?: (event: RivingEvent) => void;
}

/**
 * Riving one log, without any rendering: pick a piece, aim the froe, strike, lever, until every
 * piece is a stave, spoiled or wasted. A view feeds it input and time, and draws its state.
 */
export class RivingRound {
  readonly log: RivingLog;
  /** Pieces still to split. */
  pieces: Piece[] = [wholeLog()];
  /** Pieces that are done, and what became of them. */
  finished: { piece: Piece; fate: Fate }[] = [];
  phase: RivingPhase;
  now = 0;
  /** The log's grains (by index) no split has cut through yet. */
  live: Set<number>;
  readonly #hooks: RivingHooks;
  readonly #rng: Rng;
  #strikes = 0;
  #splitStart = 0;
  /** Where a crack that bound had got to, for the strike that restarts it. */
  #resumeFrom = 0;
  #banked = false;

  constructor(log: RivingLog, hooks: RivingHooks, seed: number) {
    this.log = log;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.live = new Set(log.grains.map((_, index) => index));
    const first = wholeLog();
    this.phase = { kind: 'aim', piece: first.id, angle: this.#startAngle(first) };
    this.#log('riving.logStart', {
      log: log.id,
      seed,
      grains: log.grains.map((grain) => grain.kind),
      checks: log.checks.length,
      feel: hooks.feel(),
    });
  }

  /** Where the froe starts on a piece: somewhere off its middle, so lining it up is up to you. */
  #startAngle(piece: Piece): number {
    if (isWhole(piece)) return normalize(this.#rng.range(0, Math.PI * 2));
    const off = this.#rng.range(-START_SPREAD, START_SPREAD) * piece.width;
    return clampAim(piece, middle(piece) + off, AIM_MARGIN);
  }

  get feel(): RivingFeel {
    return this.#hooks.feel();
  }

  /** The piece being worked on, if any. */
  get current(): Piece | undefined {
    const phase = this.phase;
    return phase.kind === 'done'
      ? undefined
      : this.pieces.find((piece) => piece.id === phase.piece);
  }

  get staves(): number {
    return this.finished.filter((entry) => entry.fate === 'stave').length;
  }

  /** What the staves so far are worth, with their grains (rot halves one, silver and gold
   * double and triple it), rounded down at the end. */
  get worth(): number {
    return this.finished
      .filter((entry) => entry.fate === 'stave')
      .reduce(
        (sum, entry) => sum + staveWorth(this.#hooks.rules, this.log, entry.piece, this.live),
        0,
      );
  }

  /** The most staves a log can give (every halving clean, no knots). */
  get maxStaves(): number {
    return 2 ** this.#hooks.rules.halvings;
  }

  // Aiming

  /** Picks another piece to split next (only while aiming). */
  select(pieceId: string): void {
    const piece = this.pieces.find((entry) => entry.id === pieceId);
    if (!piece || this.phase.kind !== 'aim') return;
    this.phase = { kind: 'aim', piece: piece.id, angle: this.#startAngle(piece) };
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

  /**
   * What a split at the current aim would do: the grains it cuts through, whether it's off centre
   * (losing the smaller side), whether it runs along a check.
   */
  get aimPreview():
    { cut: number[]; offCentre: boolean; check: boolean; pieces: [Piece, Piece] } | undefined {
    const phase = this.phase;
    const piece = this.current;
    if (phase.kind !== 'aim' || !piece) return undefined;
    const rules = this.#hooks.rules;
    return {
      cut: grainsCut(this.log, piece, phase.angle, this.live),
      offCentre: offCentre(rules, piece, phase.angle),
      check: alongCheck(rules, this.log, piece, phase.angle),
      pieces: splitPiece(piece, phase.angle),
    };
  }

  // Striking and levering

  /** The mallet comes down on the froe: commits the aim, or restarts a crack that bound. */
  strike(): void {
    const phase = this.phase;
    if (phase.kind !== 'aim' && phase.kind !== 'bound') return;
    if (phase.kind === 'aim') {
      this.#strikes = 0;
      this.#splitStart = this.now;
    }
    this.#strikes += 1;
    this.#hooks.onEvent?.({ type: 'strike', piece: phase.piece, again: phase.kind === 'bound' });
    this.phase = { kind: 'swing', piece: phase.piece, angle: phase.angle, at: this.now };
    if (phase.kind === 'bound') this.#resumeFrom = phase.lever.progress;
  }

  /** The handle has been pulled `pixels` since levering began (or the last strike). */
  drag(pixels: number): void {
    if (this.phase.kind === 'lever') this.phase.lever.drag(pixels);
  }

  // Time

  tick(dt: number): void {
    this.now += dt;
    const phase = this.phase;
    if (phase.kind === 'swing' && this.now - phase.at >= this.feel.strikeSeconds) {
      const piece = this.current;
      if (!piece) return;
      const from = this.#strikes > 1 ? this.#resumeFrom : 0;
      const lever = new Lever(() => this.feel, {
        onCheck: alongCheck(this.#hooks.rules, this.log, piece, phase.angle),
        from,
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
      staves: this.staves,
      piecesLeft: this.pieces.length,
      seconds: Math.round(this.now * 10) / 10,
    });
  }

  #levered(phase: Extract<RivingPhase, { kind: 'lever' }>, result: LeverResult): void {
    const piece = this.current;
    if (!piece) return;
    if (result === 'bound') {
      this.phase = { kind: 'bound', piece: phase.piece, angle: phase.angle, lever: phase.lever };
      this.#hooks.onEvent?.({ type: 'bound', piece: phase.piece });
      return;
    }
    const rules = this.#hooks.rules;
    const children = splitPiece(piece, phase.angle);
    const off = offCentre(rules, piece, phase.angle);
    // A runout wastes the side the crack ran off into; off centre, the small side is lost too.
    const lost = result === 'runout' || off ? children[smallerSide(children)] : undefined;
    const cut = grainsCut(this.log, piece, phase.angle, this.live);
    for (const index of cut) this.live.delete(index);
    this.pieces = this.pieces.filter((entry) => entry.id !== piece.id);
    const lever = phase.lever;
    this.#log('riving.split', {
      log: this.log.id,
      piece: piece.id,
      depth: piece.depth,
      angle: degrees(phase.angle),
      check: alongCheck(rules, this.log, piece, phase.angle),
      offCentre: off,
      grainsCut: cut.map((index) => this.log.grains[index]?.kind),
      result,
      strikes: this.#strikes,
      seconds: Math.round((this.now - this.#splitStart) * 100) / 100,
      leverSeconds: Math.round(lever.seconds * 100) / 100,
      peakSpeed: Math.round(lever.peakSpeed * 100) / 100,
      peakStrain: Math.round(lever.peakStrain * 100) / 100,
      stavesLost: lost ? 2 ** (rules.halvings - lost.depth) : 0,
    });
    this.#hooks.onEvent?.({
      type: 'split',
      piece,
      angle: phase.angle,
      result,
      children,
      lost,
      offCentre: off,
      cut,
    });
    for (const child of children) {
      if (child === lost) this.#finish(child, result === 'runout' ? 'runout' : 'offcentre');
      else if (isStave(rules, child)) this.#finish(child, 'stave');
      else this.pieces.push(child);
    }
    const next = [...this.pieces].sort((a, b) => b.width - a.width)[0];
    if (next) {
      this.phase = { kind: 'aim', piece: next.id, angle: this.#startAngle(next) };
      return;
    }
    this.phase = { kind: 'done' };
    this.#done();
  }

  #finish(piece: Piece, fate: Fate): void {
    this.finished.push({ piece, fate });
    this.#hooks.onEvent?.({ type: 'finished', piece, fate });
  }

  #done(): void {
    if (this.#banked) return;
    this.#banked = true;
    const staves = this.staves;
    const worth = Math.floor(this.worth + 1e-9);
    const banked = this.#hooks.bank(worth);
    const count = (fate: Fate) => this.finished.filter((entry) => entry.fate === fate).length;
    this.#log('riving.logEnd', {
      log: this.log.id,
      staves,
      worth,
      runouts: count('runout'),
      offCentre: count('offcentre'),
      grainsKept: [...this.live].map((index) => this.log.grains[index]?.kind),
      seconds: Math.round(this.now * 10) / 10,
    });
    this.#hooks.onEvent?.({ type: 'done', staves, worth, banked });
  }

  #log(type: string, data: Record<string, unknown>): void {
    this.#hooks.logger.log(type, data);
  }
}
