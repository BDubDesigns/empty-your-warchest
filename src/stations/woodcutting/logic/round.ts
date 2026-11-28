import { Rng, type EventLogger, type Stack } from '../../../core';
import type {
  Clearing,
  WoodcuttingFeel,
  WoodcuttingFellRest,
  WoodcuttingForage,
} from '../../../data';
import { angleBeforeLift, nudgeAim, type AimSample } from './aim';
import {
  afterChain,
  hitsCabin,
  resolveFall,
  type BoulderRoll,
  type BoulderRules,
  type Chain,
  type FallStep,
  type Point,
} from './chain';
import { fallTimeToReach, fallTimeToTilt, rollTime } from './fall';
import { fellRestSteps } from './fellRest';
import {
  addDrops,
  forageChain,
  forageTrees,
  seedForage,
  type ChainForage,
  type Forage,
} from './forage';
import { chainLogs, starBonusLogs, starsFor, type StarBonus, type StarThresholds } from './score';
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
  | { kind: 'cleared' }
  /** A chain crashed into the cabin: its logs are lost and the round is over. */
  | { kind: 'crashed' };

export interface RoundFaller {
  step: FallStep;
  /** Round time (s) when this tree starts to tip over. */
  start: number;
  /** Round time (s) when the tree that knocks it over first touches it (hit trees only). */
  contact: number | undefined;
  /** Round time (s) when it's down: on the ground, or leaning on the cabin. */
  end: number;
  touched: boolean;
  landed: boolean;
}

export interface RoundRoller {
  roll: BoulderRoll;
  /** Round time (s) when it's knocked rolling, and when it stops. */
  start: number;
  end: number;
}

/** Things a view plays effects for. */
export type RoundEvent =
  | { type: 'impact'; tree: string; swing: RoundSwing; angle: number; points: number }
  | { type: 'fell'; steps: FallStep[]; rolls: BoulderRoll[] }
  /** A falling tree's canopy reaches the next tree's trunk, knocking it over. */
  | { type: 'hit'; step: FallStep }
  | { type: 'landed'; step: FallStep; count: number }
  /** A boulder is knocked rolling. */
  | { type: 'roll'; roll: BoulderRoll }
  /** A rolling boulder bounces off the fence. */
  | { type: 'bounce'; boulder: string; at: Point }
  /** A falling tree (`step`) or a rolling boulder (`boulder`) crashes into the cabin. */
  | { type: 'crash'; step?: FallStep; boulder?: string }
  | { type: 'banked'; trees: number; logs: number; forage: ChainForage }
  /** A chain that crashed into the cabin: its logs never reach the warchest. */
  | { type: 'lost'; trees: number; logs: number }
  /**
   * Fell the rest: the trees still standing went down as singles (`steps`, in ripple order) and
   * banked `logs`, with what they foraged. The round is over.
   */
  | { type: 'felledRest'; steps: FallStep[]; logs: number; forage: ChainForage }
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
  /**
   * Foraging (moss, mushrooms): seeded with the round, banked with each chain through `bankDrops`
   * (into the warchest). Without it, a round forages nothing.
   */
  forage?: WoodcuttingForage;
  /**
   * The forage's seed: the clearing's, so replaying a clearing's seed shows the same moss,
   * mushrooms and patches. Defaults to the round's seed (the tutorial has no clearing seed).
   */
  forageSeed?: number;
  bankDrops?: (drops: Stack[]) => void;
  /** Economy: a chain of N trees banks N^chainExponent logs. Defaults to 1 (a log per tree). */
  chainExponent?: number;
  onEvent?: (event: RoundEvent) => void;
  /** Which view is playing, for the logs (e.g. '3d'). */
  view: string;
  /** The clearing's par, the star thresholds and the star bonus, for the round's stars. */
  /** `cabinCap`: the most stars a round that hit the cabin can have. */
  stars?: StarThresholds & { par: number; bonus: StarBonus; cabinCap: number };
  /** Fell the rest, once the round has enough stars. Without it, it's never offered. */
  fellRest?: WoodcuttingFellRest;
}

/** Why a round ended. */
export type RoundEndReason = 'cleared' | 'exit' | 'cabin' | 'felledRest';

/**
 * One round of domino felling, without any rendering: aim, chop, the chain, banking and
 * logging. A view feeds it input and time, and draws its state.
 */
export class WoodcuttingRound {
  /** The clearing as it is now: boulders stay where they rolled to. */
  clearing: Clearing;
  /** The round's clearing as it started. */
  readonly startClearing: Clearing;
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
  #bonusClaimed = false;
  #bonusLogs = 0;
  /** Boulders rolling in the falling chain. */
  rollers: RoundRoller[] = [];
  #chain: Chain | undefined;
  /** Boulder rolls, bounces and the cabin crash still to come in the falling chain, by round time. */
  #moments: { at: number; event: RoundEvent }[] = [];
  /** Logs lost to the cabin this round. */
  lostLogs = 0;
  /** What this round can forage, seeded with it. */
  forage: Forage = { trees: new Map(), boulders: new Map(), patches: [] };
  /** Foraged this round (banked), and lost with a chain that hit the cabin. */
  drops: Stack[] = [];
  lostDrops: Stack[] = [];
  /** What's been foraged already ('tree:id', 'boulder:id', 'patch:id'): each pays once. */
  #paid = new Set<string>();
  /** What the falling chain forages, banked with it. */
  #chainForage: ChainForage | undefined;

  constructor(clearing: Clearing, hooks: RoundHooks, seed: number) {
    this.clearing = clearing;
    this.startClearing = clearing;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.start(seed);
  }

  get feel(): WoodcuttingFeel {
    return this.#hooks.feel();
  }

  /** Whether something has been foraged this round ('tree:id', 'boulder:id', 'patch:id'). */
  hasForaged(key: string): boolean {
    return this.#paid.has(key);
  }

  /** How boulders roll right now (live tuning applies at once). */
  get boulderRules(): BoulderRules {
    const feel = this.feel;
    return { roll: feel.boulderRoll, bounce: feel.boulderBounce };
  }

  /**
   * 0–3 stars for the logs banked so far against par (0 without a par), capped once the round
   * has hit the cabin.
   */
  get stars(): number {
    const stars = this.#hooks.stars;
    if (!stars) return 0;
    const earned = starsFor(this.logs, stars.par, stars);
    return this.crashed ? Math.min(earned, stars.cabinCap) : earned;
  }

  /** The round hit the cabin. */
  get crashed(): boolean {
    return this.phase.kind === 'crashed';
  }

  get par(): number | undefined {
    return this.#hooks.stars?.par;
  }

  /** Bonus logs the round's stars are worth when it ends (whether or not claimed yet). */
  get starBonus(): number {
    const stars = this.#hooks.stars;
    return stars ? starBonusLogs(this.logs, this.stars, stars.bonus) : 0;
  }

  /** Logs the star bonus banked (0 until it's claimed). */
  get bonusLogs(): number {
    return this.#bonusLogs;
  }

  /**
   * The round is ending: bank the star bonus into the warchest, once. Returns the logs gained.
   * Logs banked after this (there shouldn't be any) don't raise it.
   */
  claimStarBonus(): number {
    if (this.#bonusClaimed) return 0;
    this.#bonusClaimed = true;
    const bonus = this.starBonus;
    if (bonus <= 0) return 0;
    this.#bonusLogs = this.#hooks.bank(bonus, 0);
    this.#log('woodcutting.starBonus', {
      stars: this.stars,
      logs: this.logs,
      bonus: this.#bonusLogs,
    });
    return this.#bonusLogs;
  }

  /**
   * Fell the rest is offered: the round has enough stars, trees still stand, and nothing is
   * being chopped, falling or rolling (a tree picked to aim at but not yet chopped is fine).
   */
  get canFellRest(): boolean {
    const rules = this.#hooks.fellRest;
    const kind = this.phase.kind;
    return (
      rules !== undefined &&
      !this.#ended &&
      this.standing.size > 0 &&
      (kind === 'pick' || kind === 'aim') &&
      this.stars >= rules.minStars
    );
  }

  /** Logs Fell the rest banks now: `logsPerTree` for each tree still standing. */
  get fellRestLogs(): number {
    return this.standing.size * (this.#hooks.fellRest?.logsPerTree ?? 0);
  }

  /**
   * Fell the rest: every standing tree goes down as a single (no chain, no boulders, no cabin),
   * banking `logsPerTree` logs each and what's on those trees (moss, mushrooms), and the round
   * ends. The star bonus is then on the round's logs, these included.
   */
  fellRest(): void {
    const rules = this.#hooks.fellRest;
    if (!rules || !this.canFellRest) return;
    const starsBefore = this.stars;
    const patches = this.forage.patches.filter((patch) => !this.#paid.has(`patch:${patch.id}`));
    const steps = fellRestSteps(this.clearing, this.standing, patches, rules.angleTries, this.#rng);
    const trees = steps.length;
    const logs = this.#hooks.bank(trees * rules.logsPerTree, trees);
    this.felled += trees;
    this.logs += logs;
    this.standing.clear();
    const forage = this.#hooks.forage
      ? forageTrees(
          steps.map((step) => step.tree),
          this.forage,
          this.#hooks.forage,
          this.#paid,
        )
      : { trees: [], boulders: [], patches: [], drops: [] };
    if (forage.drops.length > 0) {
      this.#hooks.bankDrops?.(forage.drops);
      addDrops(this.drops, forage.drops);
    }
    this.#log('woodcutting.fellRest', {
      trees,
      logs,
      roundLogs: this.logs,
      starsBefore,
      stars: this.stars,
      ...(forage.drops.length > 0 && { forage: forage.trees, drops: forage.drops }),
    });
    this.phase = { kind: 'cleared' };
    this.#end('felledRest');
    this.#hooks.onEvent?.({ type: 'felledRest', steps, logs, forage });
  }

  start(seed: number): void {
    this.#rng = new Rng(seed);
    this.standing = new Set(this.clearing.trees.map((tree) => tree.id));
    this.clearing = this.startClearing;
    this.fallers = [];
    this.rollers = [];
    this.#chain = undefined;
    this.#moments = [];
    this.felled = 0;
    this.logs = 0;
    this.lostLogs = 0;
    this.forage = this.#hooks.forage
      ? seedForage(this.startClearing, this.#hooks.forage, this.#hooks.forageSeed ?? seed)
      : { trees: new Map(), boulders: new Map(), patches: [] };
    this.drops = [];
    this.lostDrops = [];
    this.#paid = new Set();
    this.#chainForage = undefined;
    this.#ended = false;
    this.#bonusClaimed = false;
    this.#bonusLogs = 0;
    this.#startedAt = this.now;
    this.phase = { kind: 'pick' };
    this.#log('woodcutting.roundStart', {
      clearing: this.clearing.id,
      trees: this.clearing.trees.length,
      seed,
      par: this.par,
      view: this.#hooks.view,
      forage: {
        mossyTrees: [...this.forage.trees].filter(([, drop]) => drop.moss > 0).map(([id]) => id),
        mushroomTrees: [...this.forage.trees]
          .filter(([, drop]) => drop.mushrooms > 0)
          .map(([id]) => id),
        mossyBoulders: [...this.forage.boulders.keys()],
        patches: this.forage.patches.map((patch) => ({
          id: patch.id,
          x: Math.round(patch.x),
          y: Math.round(patch.y),
        })),
      },
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

  /** Leaving mid-round: bank anything already falling (unless it's crashing), and log the end. */
  exit(): void {
    this.#settle();
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
    const chain = resolveFall(this.clearing, this.standing, treeId, angle, this.boulderRules);
    const { steps, rolls } = chain;
    const feel = this.feel;
    const speed = feel.boulderSpeed;
    const heights = new Map(this.clearing.trees.map((tree) => [tree.id, tree.height]));
    const naturals = new Map(rolls.map((roll) => [roll.boulder, roll.natural]));
    const treeStarts = new Map<string, number>([[treeId, this.now]]);
    const rollStarts = new Map<string, number>();
    // When whatever knocked something over reached it: a tree's canopy, or a rolling boulder.
    const reached = (hitBy: string | undefined, byBoulder: boolean | undefined, hitAt = 0) => {
      if (hitBy === undefined) return this.now;
      if (byBoulder) {
        const start = rollStarts.get(hitBy);
        return start === undefined
          ? undefined
          : start + rollTime(hitAt, naturals.get(hitBy) ?? 0, speed);
      }
      const start = treeStarts.get(hitBy);
      return start === undefined
        ? undefined
        : start + fallTimeToReach(hitAt, heights.get(hitBy) ?? 1, feel.fallEase) * feel.fallSeconds;
    };
    // Trees and boulders knock each other in any order, so settle the times in passes.
    for (let pass = 0; pass <= steps.length + rolls.length; pass++) {
      for (const step of steps) {
        if (treeStarts.has(step.tree)) continue;
        const at = reached(step.hitBy, step.byBoulder, step.hitAt);
        if (at !== undefined) treeStarts.set(step.tree, at + feel.chainDelay);
      }
      for (const roll of rolls) {
        if (rollStarts.has(roll.boulder)) continue;
        const at = reached(roll.hitBy, roll.byBoulder, roll.hitAt);
        if (at !== undefined) rollStarts.set(roll.boulder, at);
      }
    }
    this.fallers = steps.map((step) => {
      const start = treeStarts.get(step.tree) ?? this.now;
      const contact = step.hitBy === undefined ? undefined : start - feel.chainDelay;
      // Down when its last trunk is: one that crashed into the cabin leans on it, partway over.
      const share = Math.max(
        ...step.paths.map((path) =>
          path.cabin ? fallTimeToTilt(path.cabin.tilt, feel.fallEase) : 1,
        ),
      );
      const end = start + share * feel.fallSeconds;
      return { step, start, contact, end, touched: false, landed: false };
    });
    this.rollers = rolls.map((roll) => {
      const start = rollStarts.get(roll.boulder) ?? this.now;
      return { roll, start, end: start + rollTime(roll.distance, roll.natural, speed) };
    });
    const moments: { at: number; event: RoundEvent }[] = [];
    for (const faller of this.fallers) {
      if (faller.step.paths.some((path) => path.cabin)) {
        moments.push({ at: faller.end, event: { type: 'crash', step: faller.step } });
      }
    }
    for (const roller of this.rollers) {
      const { roll } = roller;
      moments.push({ at: roller.start, event: { type: 'roll', roll } });
      let rolled = 0;
      roll.path.slice(1, -1).forEach((point, index) => {
        const from = roll.path[index] ?? point;
        rolled += Math.hypot(point.x - from.x, point.y - from.y);
        moments.push({
          at: roller.start + rollTime(rolled, roll.natural, speed),
          event: { type: 'bounce', boulder: roll.boulder, at: point },
        });
      });
      if (roll.cabin) {
        moments.push({ at: roller.end, event: { type: 'crash', boulder: roll.boulder } });
      }
    }
    this.#moments = moments.sort((a, b) => a.at - b.at);
    this.#chain = chain;
    // What it forages is decided now too (the moss falls off a boulder as it's hit).
    const rules = this.#hooks.forage;
    this.#chainForage = rules
      ? forageChain(this.clearing, chain, this.forage, rules, this.#paid)
      : undefined;
    for (const boulder of this.#chainForage?.boulders ?? []) {
      this.#log('woodcutting.mossShed', {
        boulder,
        moss: this.forage.boulders.get(boulder) ?? 0,
        by: rolls.find((roll) => roll.boulder === boulder)?.hitBy,
      });
    }
    for (const step of steps) this.standing.delete(step.tree);
    this.phase = { kind: 'falling' };
    this.#log('woodcutting.fell', {
      tree: treeId,
      angle: degrees(angle),
      chain: steps.map((step) => step.tree),
      forked: steps.filter((step) => step.trunks.length > 1).map((step) => step.tree),
      length: steps.length,
      rolls: rolls.map((roll) => ({
        boulder: roll.boulder,
        distance: Math.round(roll.distance),
        bounces: roll.path.length - 2,
        trees: steps.filter((step) => step.hitBy === roll.boulder && step.byBoulder).length,
        cabin: roll.cabin,
      })),
      cabin: hitsCabin(chain),
    });
    this.#hooks.onEvent?.({ type: 'fell', steps, rolls });
  }

  #advanceFall(): void {
    for (const faller of this.fallers) {
      if (!faller.touched && faller.contact !== undefined && this.now >= faller.contact) {
        faller.touched = true;
        this.#hooks.onEvent?.({ type: 'hit', step: faller.step });
      }
      if (!faller.landed && this.now >= faller.end) {
        faller.landed = true;
        this.#hooks.onEvent?.({
          type: 'landed',
          step: faller.step,
          count: this.fallers.filter((other) => other.landed).length,
        });
      }
    }
    while (this.#moments[0] && this.now >= this.#moments[0].at) {
      const moment = this.#moments.shift();
      if (moment) this.#hooks.onEvent?.(moment.event);
    }
    if (
      this.fallers.length > 0 &&
      this.fallers.every((faller) => faller.landed) &&
      this.rollers.every((roller) => this.now >= roller.end)
    )
      this.#settle();
  }

  /** The falling chain is down: bank it, or lose it if it crashed into the cabin. */
  #settle(): void {
    if (this.fallers.length === 0) return;
    this.#moments = [];
    const chain = this.#chain;
    this.#chain = undefined;
    this.rollers = [];
    if (chain) this.clearing = afterChain(this.clearing, chain);
    if (chain && hitsCabin(chain)) this.#lose();
    else this.#bank();
  }

  #lose(): void {
    const trees = this.fallers.length;
    this.fallers = [];
    const logs = chainLogs(trees, this.#hooks.chainExponent ?? 1);
    this.felled += trees;
    this.lostLogs += logs;
    // What the chain foraged is lost with its logs.
    const lostDrops = this.#chainForage?.drops ?? [];
    this.#chainForage = undefined;
    addDrops(this.lostDrops, lostDrops);
    this.#log('woodcutting.cabinHit', {
      trees,
      lostLogs: logs,
      roundLogs: this.logs,
      ...(lostDrops.length > 0 && { lostDrops }),
    });
    this.#hooks.onEvent?.({ type: 'lost', trees, logs });
    this.phase = { kind: 'crashed' };
    this.#end('cabin');
  }

  #bank(): void {
    const trees = this.fallers.length;
    this.fallers = [];
    const logs = this.#hooks.bank(chainLogs(trees, this.#hooks.chainExponent ?? 1), trees);
    this.felled += trees;
    this.logs += logs;
    this.#log('woodcutting.bank', { trees, logs, roundLogs: this.logs });
    const forage = this.#chainForage ?? { trees: [], boulders: [], patches: [], drops: [] };
    this.#chainForage = undefined;
    if (forage.drops.length > 0) {
      this.#hooks.bankDrops?.(forage.drops);
      addDrops(this.drops, forage.drops);
      this.#log('woodcutting.forage', {
        trees: forage.trees,
        boulders: forage.boulders,
        patches: forage.patches,
        drops: forage.drops,
        roundDrops: this.drops,
      });
    }
    this.#hooks.onEvent?.({ type: 'banked', trees, logs, forage });
    if (this.standing.size === 0) {
      this.phase = { kind: 'cleared' };
      this.#end('cleared');
      this.#hooks.onEvent?.({ type: 'cleared' });
    } else {
      this.phase = { kind: 'pick' };
    }
  }

  #end(reason: RoundEndReason): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#log('woodcutting.roundEnd', {
      reason,
      view: this.#hooks.view,
      felled: this.felled,
      logs: this.logs,
      lostLogs: this.lostLogs,
      drops: this.drops,
      ...(this.lostDrops.length > 0 && { lostDrops: this.lostDrops }),
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
