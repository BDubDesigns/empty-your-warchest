import * as Phaser from 'phaser';
import { onTap, text } from '../../app/phaserUi';
import { theme } from '../../app/theme';
import { Rng, type EventLogger, type Game, type LiveTuning } from '../../core';
import type { Clearing, ClearingTree, WoodcuttingFeel } from '../../data';
import { fallTip, previewFall, resolveChain, type FallStep, type Point } from './logic/chain';
import { fallProgress, fallTimeToReach } from './logic/fall';
import { CLEARING_MARGIN, fitClearing, toScreen } from './logic/layout';
import {
  judgeSwing,
  markerPosition,
  nextTarget,
  swingScatter,
  type SwingResult,
} from './logic/swing';

export const WOODCUTTING_SCENE = 'woodcutting';

export interface WoodcuttingDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<WoodcuttingFeel>;
}

/** An axe swing in flight, from release to impact. */
interface Swing {
  /** How far the axe was pulled back (0–1), for the swing animation. */
  from: number;
  /** Scene time of release. */
  at: number;
  result: SwingResult;
  points: number;
  /** Bar marker position at release, and the yellow zone's center. */
  marker: number;
  target: number;
  /** How far (radians) this chop knocks the aim off. */
  drift: number;
  holdSeconds: number;
}

type Phase =
  | { kind: 'pick' }
  /** Pulling back on a tree to aim. `angle` is undefined until the finger leaves the tree. */
  | {
      kind: 'aim';
      tree: string;
      angle?: number | undefined;
      pull?: Point | undefined;
      held: boolean;
      startedAt: number;
    }
  /** Notch cut; chopping in the box at the bottom. */
  | {
      kind: 'chop';
      tree: string;
      angle: number;
      points: number;
      /** Center of the yellow zone on the bar, 0–1. Moves after every chop. */
      target: number;
      /** While the axe is held back: where the press started and when, and the finger now. */
      hold?: { start: Point; at: number; finger: Point } | undefined;
      swing?: Swing | undefined;
    }
  | { kind: 'falling' }
  | { kind: 'cleared' };

interface Faller {
  step: FallStep;
  /** Scene time (s) when this tree starts to tip over. */
  start: number;
  landed: boolean;
}

const SOUNDS = {
  chop: ['chop-1', 'chop-2', 'chop-3'],
  perfect: ['chop-perfect'],
  creak: ['creak-1', 'creak-2', 'creak-3'],
  land: ['land-1', 'land-2', 'land-3'],
};
const COLORS = {
  canopy: 0x3f7a3a,
  canopyEdge: 0x2b5628,
  trunk: 0x7a5230,
  bark: 0x5e3f24,
  wood: 0xe0c089,
  stump: 0x5a3c22,
  box: 0x1a1f18,
  bar: 0x2f352c,
  good: 0x6fae4f,
  perfect: 0xe8c04f,
  handle: 0xb07a42,
  blade: 0xc9ced4,
  pipEmpty: 0x4a5045,
  goodText: '#8fd16f',
  perfectText: '#f0cd5c',
};
/** Screen pixels the finger must move before it aims or pulls the axe back. */
const DEAD_ZONE = 24;
/** Screen pixels of drag that pull the axe all the way back. */
const FULL_PULL = 140;
/** Seconds a banked chain's logs take to be hauled off (fade out). */
const HAUL_SECONDS = 0.5;
const DEG = Math.PI / 180;

/** Whole degrees in 0–359, for logs. */
function degrees(radians: number): number {
  return Math.round((((radians / DEG) % 360) + 360) % 360);
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Domino felling, M3a feel prototype: one hand-made clearing.
 * Aim by pulling back on a tree; letting go cuts the notch that sets the fall.
 * Then chop in the box at the bottom: pull the axe back, let go with the marker on yellow.
 */
export class WoodcuttingScene extends Phaser.Scene {
  readonly #deps: WoodcuttingDeps;
  readonly #fx = new Rng('woodcutting-fx');
  #clearing!: Clearing;
  #trees = new Map<string, ClearingTree>();
  #standing = new Set<string>();
  #fallers: Faller[] = [];
  /** Fallen trees still on the ground, with when they started being hauled off. */
  #fallen = new Map<string, { angle: number; hauledAt?: number }>();
  #phase: Phase = { kind: 'pick' };
  /** Scene clock in seconds. It stops during hit-stop. */
  #now = 0;
  #frozenUntil = 0;
  #round = { startedAt: 0, felled: 0, logs: 0, ended: false };
  /** Yellow-zone spots and aim drift; seeded per round and logged, so rounds can be replayed. */
  #rng = new Rng(0);

  #graphics!: Phaser.GameObjects.Graphics;
  #hint!: Phaser.GameObjects.Text;
  #total!: Phaser.GameObjects.Text;
  #counter!: Phaser.GameObjects.Text;
  #summary!: Phaser.GameObjects.Container;
  #chips!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Bigger wood chunks knocked out of the log by good and perfect chops. */
  #chunks!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Scene time of the last chop landing, for the log's jolt. */
  #lastHitAt = -1;
  #dust!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(deps: WoodcuttingDeps) {
    super(WOODCUTTING_SCENE);
    this.#deps = deps;
  }

  get #feel(): WoodcuttingFeel {
    return this.#deps.feel.values;
  }

  preload(): void {
    for (const key of Object.values(SOUNDS).flat()) {
      this.load.audio(`wc-${key}`, `audio/woodcutting/${key}.mp3`);
    }
  }

  init(): void {
    // The scene object is reused on every visit, so start each one clean.
    const [clearing] = this.#deps.game.data.woodcutting.clearings;
    if (!clearing) throw new Error('No woodcutting clearing in data');
    this.#clearing = clearing;
    this.#trees = new Map(clearing.trees.map((tree) => [tree.id, tree]));
    this.#now = 0;
    this.#frozenUntil = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(theme.ground);
    this.#makeTextures();
    this.#graphics = this.add.graphics();
    this.#chips = this.add.particles(0, 0, 'wc-chip', {
      speed: { min: 90, max: 240 },
      angle: { min: 0, max: 360 },
      lifespan: 450,
      gravityY: 500,
      scale: { start: 1, end: 0.4 },
      rotate: { min: 0, max: 360 },
      emitting: false,
    });
    this.#chunks = this.add.particles(0, 0, 'wc-chunk', {
      speed: { min: 120, max: 260 },
      angle: { min: 200, max: 340 },
      lifespan: 650,
      gravityY: 700,
      rotate: { min: 0, max: 360 },
      scale: { start: 1, end: 0.7 },
      emitting: false,
    });
    this.#dust = this.add.particles(0, 0, 'wc-dust', {
      speed: { min: 20, max: 110 },
      angle: { min: 0, max: 360 },
      lifespan: 700,
      alpha: { start: 0.55, end: 0 },
      scale: { start: 0.8, end: 2.6 },
      emitting: false,
    });
    this.#total = text(this, '', { fontSize: '14px', color: theme.muted }).setOrigin(1, 0.5);
    this.#hint = text(this, '', { fontSize: '15px', color: theme.fg });
    this.#counter = text(this, '', { fontSize: '40px', fontStyle: 'bold', color: theme.fg })
      .setStroke(theme.bg, 6)
      .setAlpha(0);
    this.#summary = this.#makeSummary();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.#onPress(pointer.x, pointer.y);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown) this.#onDrag(pointer.x, pointer.y);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.#onRelease(pointer.x, pointer.y);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.#bankChain();
      this.#endRound('exit');
      delete document.body.dataset.woodcutting;
    });

    this.#startRound();
  }

  override update(_time: number, delta: number): void {
    if (performance.now() >= this.#frozenUntil) {
      this.#now += delta / 1000;
      this.#advanceSwing();
      this.#advanceFall();
    }
    this.#draw();
  }

  // Round

  #startRound(): void {
    this.#standing = new Set(this.#clearing.trees.map((tree) => tree.id));
    this.#fallers = [];
    this.#fallen.clear();
    this.#round = { startedAt: Date.now(), felled: 0, logs: 0, ended: false };
    const seed = Date.now() >>> 0;
    this.#rng = new Rng(seed);
    this.#summary.setVisible(false);
    this.#setPhase({ kind: 'pick' });
    this.#deps.logger.log('woodcutting.roundStart', {
      clearing: this.#clearing.id,
      trees: this.#clearing.trees.length,
      seed,
      feel: this.#feel,
    });
  }

  #endRound(reason: 'cleared' | 'exit'): void {
    if (this.#round.ended) return;
    this.#round.ended = true;
    this.#deps.logger.log('woodcutting.roundEnd', {
      reason,
      felled: this.#round.felled,
      logs: this.#round.logs,
      standing: this.#standing.size,
      seconds: Math.round((Date.now() - this.#round.startedAt) / 100) / 10,
    });
  }

  #setPhase(phase: Phase): void {
    this.#phase = phase;
    // Lets the e2e test follow the round.
    document.body.dataset.woodcutting = phase.kind;
    const hints: Record<Phase['kind'], string> = {
      pick: 'Touch a tree and pull back to aim',
      aim: 'Pull away from where it should fall. Let go to cut the notch',
      chop: 'Pull the axe back, let go when the marker is on yellow',
      falling: '',
      cleared: '',
    };
    this.#hint.setText(hints[phase.kind]);
  }

  // Input

  #onPress(x: number, y: number): void {
    const phase = this.#phase;
    if (phase.kind === 'pick') {
      const tree = this.#treeAt(x, y);
      if (!tree) return;
      this.#setPhase({ kind: 'aim', tree: tree.id, held: true, startedAt: this.#now });
      this.#deps.logger.log('woodcutting.select', { tree: tree.id });
    } else if (phase.kind === 'aim') {
      this.#phase = { ...phase, held: true };
      this.#onDrag(x, y);
    } else if (phase.kind === 'chop' && !phase.swing) {
      // Anywhere on screen: grab the axe and start pulling it back.
      this.#phase = { ...phase, hold: { start: { x, y }, at: this.#now, finger: { x, y } } };
    }
  }

  #onDrag(x: number, y: number): void {
    const phase = this.#phase;
    if (phase.kind === 'aim' && phase.held) {
      this.#phase = {
        ...phase,
        pull: { x, y },
        angle: this.#angleFrom(phase.tree, x, y) ?? phase.angle,
      };
    } else if (phase.kind === 'chop' && phase.hold) {
      this.#phase = { ...phase, hold: { ...phase.hold, finger: { x, y } } };
    }
  }

  #onRelease(x: number, y: number): void {
    this.#onDrag(x, y);
    const phase = this.#phase;
    if (phase.kind === 'aim' && phase.held) {
      if (phase.angle === undefined) {
        // Let go on the tree itself: keep it selected and wait for a pull.
        this.#phase = { ...phase, held: false, pull: undefined };
        return;
      }
      this.#cutNotch(phase.tree, phase.angle, phase.startedAt);
    } else if (phase.kind === 'chop' && phase.hold) {
      const hold = phase.hold;
      const pulled = this.#pullAmount(hold);
      if (pulled === 0) {
        // Not pulled back: no swing.
        this.#phase = { ...phase, hold: undefined };
        return;
      }
      const feel = this.#feel;
      const holdSeconds = this.#now - hold.at;
      const marker = markerPosition(holdSeconds, feel.meterSpeed);
      const { result, points } = judgeSwing(marker, phase.target, feel);
      const drift = swingScatter(result, feel, this.#rng);
      this.#phase = {
        ...phase,
        hold: undefined,
        swing: {
          from: pulled,
          at: this.#now,
          result,
          points,
          marker,
          target: phase.target,
          drift,
          holdSeconds,
        },
      };
    }
  }

  /** Pull-back aiming: the tree falls away from the finger. */
  #angleFrom(treeId: string, x: number, y: number): number | undefined {
    const base = toScreen(this.#fit(), this.#tree(treeId));
    if (Math.hypot(x - base.x, y - base.y) < DEAD_ZONE) return undefined;
    return Math.atan2(base.y - y, base.x - x);
  }

  /** How far the axe is pulled back, 0–1, from how far the finger has moved since grabbing it. */
  #pullAmount(hold: { start: Point; finger: Point }): number {
    const distance = Math.hypot(hold.finger.x - hold.start.x, hold.finger.y - hold.start.y);
    return Math.min(Math.max((distance - DEAD_ZONE / 2) / FULL_PULL, 0), 1);
  }

  #treeAt(x: number, y: number): ClearingTree | undefined {
    const fit = this.#fit();
    const reach = Math.max(28, this.#clearing.canopyRadius * fit.scale * 1.6);
    let best: { tree: ClearingTree; distance: number } | undefined;
    for (const id of this.#standing) {
      const tree = this.#tree(id);
      const point = toScreen(fit, tree);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= reach && (!best || distance < best.distance)) best = { tree, distance };
    }
    return best?.tree;
  }

  // Chopping

  /** The first cut: the notch on the fall side sets where the tree will go. */
  #cutNotch(treeId: string, angle: number, startedAt: number): void {
    const base = toScreen(this.#fit(), this.#tree(treeId));
    this.#play('chop', 0.7);
    this.#chips.explode(8, base.x, base.y);
    this.#deps.logger.log('woodcutting.aim', {
      tree: treeId,
      angle: degrees(angle),
      aimSeconds: Math.round((this.#now - startedAt) * 10) / 10,
    });
    this.#setPhase({
      kind: 'chop',
      tree: treeId,
      angle,
      points: 0,
      target: nextTarget(this.#feel, this.#rng),
    });
  }

  /** Lands a chop once the axe reaches the trunk. */
  #advanceSwing(): void {
    const phase = this.#phase;
    if (phase.kind !== 'chop' || !phase.swing) return;
    const feel = this.#feel;
    const swing = phase.swing;
    if (this.#now - swing.at < feel.swingSeconds) return;

    const angle = phase.angle + swing.drift;
    const total = phase.points + swing.points;
    this.#deps.logger.log('woodcutting.chop', {
      tree: phase.tree,
      result: swing.result,
      marker: round3(swing.marker),
      target: round3(swing.target),
      offset: round3(Math.abs(swing.marker - swing.target)),
      holdSeconds: Math.round(swing.holdSeconds * 100) / 100,
      drift: Math.round(swing.drift / DEG),
      angle: degrees(angle),
      points: total,
    });

    const box = this.#box();
    const hit = { x: box.centerX, y: box.logY + box.logRadius };
    this.#lastHitAt = this.#now;
    const treeBase = toScreen(this.#fit(), this.#tree(phase.tree));
    const shake = feel.shakeStrength;
    const driftDegrees = Math.round(Math.abs(swing.drift / DEG));
    const drifted = driftDegrees >= 1 ? ` · aim off ${driftDegrees}°` : '';
    if (swing.result === 'perfect') {
      this.#play('perfect', 0.9);
      this.#chips.explode(26, hit.x, hit.y);
      this.#chunks.explode(5, hit.x, hit.y);
      this.#chips.explode(8, treeBase.x, treeBase.y);
      if (shake > 0) this.cameras.main.shake(120, 0.008 * shake);
      this.#frozenUntil = performance.now() + feel.hitStopMs;
      this.#flash(`Perfect! +${swing.points}`, box.centerX, box.top - 40, COLORS.perfectText);
    } else {
      this.#play('chop', swing.result === 'good' ? 0.8 : 0.55);
      this.#chips.explode(swing.result === 'good' ? 16 : 5, hit.x, hit.y);
      if (swing.result === 'good') this.#chunks.explode(2, hit.x, hit.y);
      if (shake > 0) {
        this.cameras.main.shake(80, (swing.result === 'good' ? 0.005 : 0.003) * shake);
      }
      const message = swing.result === 'good' ? `Good +${swing.points}` : 'Glancing +0';
      this.#flash(
        message + drifted,
        box.centerX,
        box.top - 40,
        swing.result === 'good' ? COLORS.goodText : theme.muted,
      );
    }

    if (total >= feel.chopPoints) {
      this.#startChain(phase.tree, angle);
    } else {
      this.#phase = {
        ...phase,
        angle,
        points: total,
        swing: undefined,
        target: nextTarget(feel, this.#rng),
      };
    }
  }

  // Falling

  #startChain(treeId: string, angle: number): void {
    // The chain is decided here, before anything moves; the animation only plays it back.
    const steps = resolveChain(this.#clearing, this.#standing, treeId, angle, this.#feel);
    const feel = this.#feel;
    const starts = new Map<string, number>();
    this.#fallers = steps.map((step) => {
      const hitter = step.hitBy === undefined ? undefined : this.#tree(step.hitBy);
      const start =
        hitter === undefined || step.hitBy === undefined
          ? this.#now
          : (starts.get(step.hitBy) ?? this.#now) +
            fallTimeToReach(step.hitAt ?? 0, hitter.height, feel.fallEase) * feel.fallSeconds +
            feel.chainDelay;
      starts.set(step.tree, start);
      return { step, start, landed: false };
    });
    for (const step of steps) this.#standing.delete(step.tree);
    this.#setPhase({ kind: 'falling' });
    this.#play('creak', 0.7);
    this.#deps.logger.log('woodcutting.fell', {
      tree: treeId,
      angle: degrees(angle),
      chain: steps.map((step) => step.tree),
      length: steps.length,
    });
  }

  #advanceFall(): void {
    if (this.#phase.kind !== 'falling') return;
    const feel = this.#feel;
    let landed = 0;
    for (const faller of this.#fallers) {
      if (!faller.landed && this.#now >= faller.start + feel.fallSeconds) {
        faller.landed = true;
        this.#land(faller.step);
      }
      if (faller.landed) landed++;
    }
    if (landed > 1) this.#showCounter(landed);
    if (landed === this.#fallers.length) this.#bankChain();
  }

  #land(step: FallStep): void {
    const tree = this.#tree(step.tree);
    const tip = toScreen(this.#fit(), fallTip(tree, step.angle));
    this.#fallen.set(step.tree, { angle: step.angle });
    this.#play('land', 0.85);
    this.#dust.explode(14, tip.x, tip.y);
    const shake = this.#feel.shakeStrength;
    if (shake > 0) {
      this.cameras.main.shake(180, Math.min(0.006 + step.depth * 0.002, 0.016) * shake);
    }
  }

  /** Banks a finished (or interrupted) chain: one craft per felled tree, then haul the logs off. */
  #bankChain(): void {
    if (this.#fallers.length === 0) return;
    const felled = this.#fallers.length;
    this.#fallers = [];
    const { game, logger } = this.#deps;
    const result = game.craft(
      game.data.woodcutting.recipe,
      { batches: felled },
      { awardXp: false },
    );
    const logs = result.produced.reduce((sum, stack) => sum + stack.count, 0);
    this.#round.felled += felled;
    this.#round.logs += logs;
    logger.log('woodcutting.bank', { trees: felled, logs, roundLogs: this.#round.logs });
    if (!this.scene.isActive()) return;

    this.#flash(
      `+${logs} log${logs === 1 ? '' : 's'}`,
      this.scale.width / 2,
      this.scale.height * 0.4 + 44,
      theme.fg,
    );
    for (const fallen of this.#fallen.values()) fallen.hauledAt ??= this.#now + 0.6;
    this.tweens.add({ targets: this.#counter, alpha: 0, delay: 500, duration: 300 });
    if (this.#standing.size === 0) {
      this.#setPhase({ kind: 'cleared' });
      this.#endRound('cleared');
      this.#showSummary();
    } else {
      this.#setPhase({ kind: 'pick' });
    }
  }

  // Drawing

  #draw(): void {
    const g = this.#graphics;
    const fit = this.#fit();
    const feel = this.#feel;
    const { width, height } = this.scale;
    g.clear();

    // Clearing edge
    g.lineStyle(1, theme.mutedHex, 0.15);
    g.strokeRect(
      fit.offsetX,
      fit.offsetY,
      this.#clearing.width * fit.scale,
      this.#clearing.height * fit.scale,
    );

    const canopy = Math.max(8, this.#clearing.canopyRadius * fit.scale);
    const trunkWidth = Math.max(4, canopy * 0.45);
    const fallingIds = new Map(this.#fallers.map((faller) => [faller.step.tree, faller]));

    for (const tree of this.#clearing.trees) {
      const base = toScreen(fit, tree);
      const falling = fallingIds.get(tree.id);
      const fallen = this.#fallen.get(tree.id);

      if (fallen) {
        const alpha =
          fallen.hauledAt === undefined ? 1 : 1 - (this.#now - fallen.hauledAt) / HAUL_SECONDS;
        if (alpha <= 0) {
          this.#fallen.delete(tree.id);
          this.#drawStump(base, canopy);
          continue;
        }
        this.#drawStump(base, canopy);
        this.#drawFallingTree(tree, fallen.angle, 1, alpha, canopy, trunkWidth);
      } else if (falling && this.#now >= falling.start) {
        const t = (this.#now - falling.start) / feel.fallSeconds;
        this.#drawStump(base, canopy);
        this.#drawFallingTree(
          tree,
          falling.step.angle,
          fallProgress(t, feel.fallEase),
          1,
          canopy,
          trunkWidth,
        );
      } else if (this.#standing.has(tree.id) || falling) {
        g.fillStyle(COLORS.canopy, 1).fillCircle(base.x, base.y, canopy);
        g.lineStyle(2, COLORS.canopyEdge, 1).strokeCircle(base.x, base.y, canopy);
        g.fillStyle(COLORS.trunk, 1).fillCircle(base.x, base.y, trunkWidth / 2);
      } else {
        this.#drawStump(base, canopy);
      }
    }

    const phase = this.#phase;
    if (phase.kind === 'aim' || phase.kind === 'chop') {
      const tree = this.#tree(phase.tree);
      const base = toScreen(fit, tree);
      g.lineStyle(3, theme.accentHex, 1).strokeCircle(base.x, base.y, canopy + 5);
      if (phase.kind === 'aim' && phase.held && phase.pull) {
        // Tether from the tree to the finger, so the pull reads like a rope or slingshot
        g.lineStyle(3, theme.accentHex, 0.5).lineBetween(
          base.x,
          base.y,
          phase.pull.x,
          phase.pull.y,
        );
      }
      if (phase.angle !== undefined) this.#drawAimGuide(tree, phase.angle, canopy);
      if (phase.kind === 'chop') this.#drawNotch(base, phase.angle, canopy);
    }

    const box = this.#box();
    g.fillStyle(COLORS.box, 0.85).fillRoundedRect(box.left, box.top, box.width, box.height, 12);
    if (phase.kind === 'chop') this.#drawChopBox(phase);

    this.#total.setPosition(width - 16, 70).setText(`Logs this round: ${this.#round.logs}`);
    this.#hint.setPosition(
      width / 2,
      phase.kind === 'chop' ? box.top - 14 : box.top + box.height / 2,
    );
    this.#counter.setPosition(width / 2, height * 0.4);
    this.#summary.setPosition(width / 2, height * 0.4);
  }

  #drawStump(base: Point, canopy: number): void {
    this.#graphics.fillStyle(COLORS.stump, 1).fillCircle(base.x, base.y, canopy * 0.35);
  }

  #drawFallingTree(
    tree: ClearingTree,
    angle: number,
    progress: number,
    alpha: number,
    canopy: number,
    trunkWidth: number,
  ): void {
    const fit = this.#fit();
    const base = toScreen(fit, tree);
    const reach = tree.height * fit.scale * progress;
    const tip = { x: base.x + Math.cos(angle) * reach, y: base.y + Math.sin(angle) * reach };
    const g = this.#graphics;
    g.lineStyle(trunkWidth, COLORS.trunk, alpha).lineBetween(base.x, base.y, tip.x, tip.y);
    g.fillStyle(COLORS.canopy, alpha).fillCircle(tip.x, tip.y, canopy);
    g.lineStyle(2, COLORS.canopyEdge, alpha).strokeCircle(tip.x, tip.y, canopy);
  }

  /** Billiards-style guide: the ghost canopy where it first touches a tree, and where that tree goes. */
  #drawAimGuide(tree: ClearingTree, angle: number, canopy: number): void {
    const g = this.#graphics;
    const fit = this.#fit();
    const base = toScreen(fit, tree);
    const preview = previewFall(this.#clearing, this.#standing, tree, angle, this.#feel);
    const ghost = toScreen(fit, preview.ghost);
    g.lineStyle(2, theme.fgHex, 0.45).lineBetween(base.x, base.y, ghost.x, ghost.y);
    g.lineStyle(2, theme.fgHex, 0.55).strokeCircle(ghost.x, ghost.y, canopy);
    if (preview.hit) {
      const hitTree = this.#tree(preview.hit.tree);
      const from = toScreen(fit, hitTree);
      const length = hitTree.height * fit.scale * 0.6;
      const dx = Math.cos(preview.hit.angle);
      const dy = Math.sin(preview.hit.angle);
      const end = { x: from.x + dx * length, y: from.y + dy * length };
      g.lineStyle(2, COLORS.perfect, 0.7).lineBetween(from.x, from.y, end.x, end.y);
      g.fillStyle(COLORS.perfect, 0.7).fillTriangle(
        end.x + dx * 9,
        end.y + dy * 9,
        end.x - dy * 6,
        end.y + dx * 6,
        end.x + dy * 6,
        end.y - dx * 6,
      );
    }
  }

  /** The notch: a wedge cut into the canopy's edge on the side the tree will fall toward. */
  #drawNotch(base: Point, angle: number, canopy: number): void {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const rim = { x: base.x + dx * canopy * 1.05, y: base.y + dy * canopy * 1.05 };
    const side = { x: -dy * canopy * 0.4, y: dx * canopy * 0.4 };
    this.#graphics
      .fillStyle(COLORS.wood, 1)
      .fillTriangle(
        rim.x + side.x,
        rim.y + side.y,
        rim.x - side.x,
        rim.y - side.y,
        base.x + dx * canopy * 0.55,
        base.y + dy * canopy * 0.55,
      );
  }

  /** Where the chop box sits, and the parts drawn in it. */
  #box() {
    const { width, height } = this.scale;
    const boxWidth = Math.min(width - 24, 420);
    const left = (width - boxWidth) / 2;
    const top = height - CLEARING_MARGIN.bottom + 28;
    const boxHeight = CLEARING_MARGIN.bottom - 40;
    const barTop = top + 12;
    const logRadius = 30;
    const logY = top + 92;
    return {
      left,
      top,
      width: boxWidth,
      height: boxHeight,
      centerX: width / 2,
      bar: { left: left + 18, top: barTop, width: boxWidth - 36, height: 18 },
      pipsY: barTop + 32,
      logY,
      logRadius,
      /** Where the blade rests, touching the log; pulling back moves it down by up to `pullRange`. */
      bladeY: logY + logRadius + 2,
      pullRange: Math.max(top + boxHeight - 30 - (logY + logRadius + 2), 20),
    };
  }

  /**
   * End-on view of the log, centered, with the axe centered behind it. Pull the axe back
   * (away from the log) while the marker sweeps; let go on yellow and it bites a chunk out.
   */
  #drawChopBox(phase: Extract<Phase, { kind: 'chop' }>): void {
    const g = this.#graphics;
    const feel = this.#feel;
    const box = this.#box();
    const { bar } = box;

    // Bar: green zone around the yellow one, both centered on this chop's target
    g.fillStyle(COLORS.bar, 1).fillRoundedRect(bar.left, bar.top, bar.width, bar.height, 6);
    const zone = (share: number, color: number) => {
      const zoneWidth = bar.width * share;
      const center = bar.left + bar.width * phase.target;
      g.fillStyle(color, 1).fillRect(center - zoneWidth / 2, bar.top, zoneWidth, bar.height);
    };
    zone(feel.timingWindow, COLORS.good);
    zone(feel.perfectWindow, COLORS.perfect);
    const marker = phase.swing
      ? phase.swing.marker
      : phase.hold
        ? markerPosition(this.#now - phase.hold.at, feel.meterSpeed)
        : undefined;
    if (marker !== undefined) {
      const x = bar.left + bar.width * marker;
      g.fillStyle(theme.fgHex, 1).fillRect(x - 2, bar.top - 5, 4, bar.height + 10);
    }

    // Chop progress
    const pip = 10;
    const gap = 7;
    const pipsWidth = feel.chopPoints * pip + (feel.chopPoints - 1) * gap;
    for (let i = 0; i < feel.chopPoints; i++) {
      g.fillStyle(i < phase.points ? theme.accentHex : COLORS.pipEmpty, 1).fillCircle(
        box.centerX - pipsWidth / 2 + i * (pip + gap) + pip / 2,
        box.pipsY,
        pip / 2,
      );
    }

    // The log, end-on: bark ring, rings, and the bite taken out of it so far.
    // It jolts away from the axe for a moment after each hit.
    const sinceHit = this.#now - this.#lastHitAt;
    const jolt = sinceHit < 0.18 ? Math.sin(sinceHit * 70) * (1 - sinceHit / 0.18) * 5 : 0;
    const log = { x: box.centerX, y: box.logY - Math.abs(jolt) };
    const r = box.logRadius;
    g.fillStyle(COLORS.bark, 1).fillCircle(log.x, log.y, r + 4);
    g.fillStyle(COLORS.wood, 1).fillCircle(log.x, log.y, r);
    g.lineStyle(2, COLORS.trunk, 0.45);
    for (const ring of [0.75, 0.5, 0.28]) g.strokeCircle(log.x, log.y, r * ring);
    g.fillStyle(COLORS.trunk, 0.6).fillCircle(log.x, log.y, r * 0.08);
    const depth = Math.min(phase.points / feel.chopPoints, 1) * r * 1.1;
    if (depth > 0) {
      // A V-shaped bite into the side facing the axe
      const mouth = 8 + depth * 0.7;
      g.fillStyle(COLORS.box, 1).fillTriangle(
        log.x - mouth,
        log.y + r + 5,
        log.x + mouth,
        log.y + r + 5,
        log.x,
        log.y + r + 4 - depth,
      );
      g.lineStyle(2, COLORS.wood, 0.9).lineBetween(
        log.x - mouth,
        log.y + r + 4,
        log.x,
        log.y + r + 4 - depth,
      );
      g.lineBetween(log.x + mouth, log.y + r + 4, log.x, log.y + r + 4 - depth);
    }

    // The axe, centered behind the log with its blade toward it: handle across, head in the middle
    const pulled = phase.swing
      ? phase.swing.from * (1 - Math.min((this.#now - phase.swing.at) / feel.swingSeconds, 1) ** 2)
      : phase.hold
        ? this.#pullAmount(phase.hold)
        : 0;
    const bladeY = box.bladeY + box.pullRange * pulled;
    const headY = bladeY + 12;
    const handleHalf = Math.min(110, box.width * 0.32);
    g.lineStyle(8, COLORS.handle, 1).lineBetween(
      box.centerX - handleHalf,
      headY + 6,
      box.centerX + handleHalf * 0.35,
      headY + 6,
    );
    g.fillStyle(0x6d7178, 1).fillRect(box.centerX - 12, headY - 2, 24, 16);
    g.fillStyle(COLORS.blade, 1).fillPoints(
      [
        new Phaser.Math.Vector2(box.centerX - 12, headY - 2),
        new Phaser.Math.Vector2(box.centerX - 18, bladeY),
        new Phaser.Math.Vector2(box.centerX + 18, bladeY),
        new Phaser.Math.Vector2(box.centerX + 12, headY - 2),
      ],
      true,
    );
  }

  // Effects

  #showCounter(trees: number): void {
    const label = `${trees} trees!`;
    if (this.#counter.text === label && this.#counter.alpha > 0) return;
    this.tweens.killTweensOf(this.#counter);
    this.#counter.setText(label).setAlpha(1).setScale(1.5);
    this.tweens.add({ targets: this.#counter, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  #flash(message: string, x: number, y: number, color: string): void {
    const label = text(this, message, { fontSize: '20px', fontStyle: 'bold', color }).setStroke(
      theme.bg,
      5,
    );
    label.setPosition(x, y);
    this.tweens.add({
      targets: label,
      y: y - 30,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        label.destroy();
      },
    });
  }

  #play(group: keyof typeof SOUNDS, volume: number): void {
    const key = `wc-${this.#fx.pick(SOUNDS[group])}`;
    this.sound.play(key, { volume, detune: this.#fx.int(-120, 120) });
  }

  #makeSummary(): Phaser.GameObjects.Container {
    const title = text(this, 'Clearing cleared!', {
      fontSize: '26px',
      fontStyle: 'bold',
    }).setPosition(0, -60);
    const detail = text(this, '', { fontSize: '17px', color: theme.muted }).setPosition(0, -24);
    const plate = this.add.rectangle(0, 36, 200, 56, theme.accentHex);
    const label = text(this, 'New round', {
      fontSize: '20px',
      fontStyle: 'bold',
      color: theme.bg,
    }).setPosition(0, 36);
    onTap(plate, theme.accentHex, theme.accentPressedHex, () => {
      this.#startRound();
    });
    const container = this.add.container(0, 0, [title, detail, plate, label]).setVisible(false);
    container.setData('detail', detail);
    return container;
  }

  #showSummary(): void {
    const detail = this.#summary.getData('detail') as Phaser.GameObjects.Text;
    detail.setText(`${this.#round.felled} trees · ${this.#round.logs} logs to the warchest`);
    this.#summary.setVisible(true);
  }

  #makeTextures(): void {
    if (this.textures.exists('wc-chunk')) return;
    const g = this.make.graphics({}, false);
    g.fillStyle(0xd8b483, 1).fillRect(0, 0, 6, 4);
    g.generateTexture('wc-chip', 6, 4);
    g.clear();
    g.fillStyle(0xcbbd9a, 1).fillCircle(6, 6, 6);
    g.generateTexture('wc-dust', 12, 12);
    g.clear();
    g.fillStyle(0xe0c089, 1).fillTriangle(0, 10, 7, 0, 14, 9);
    g.fillStyle(0x5e3f24, 1).fillRect(0, 9, 14, 3);
    g.generateTexture('wc-chunk', 14, 12);
    g.destroy();
  }

  // Helpers

  #fit() {
    return fitClearing(this.scale.width, this.scale.height, this.#clearing);
  }

  #tree(id: string): ClearingTree {
    const tree = this.#trees.get(id);
    if (!tree) throw new Error(`Unknown tree "${id}"`);
    return tree;
  }
}
