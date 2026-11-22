import * as Phaser from 'phaser';
import { onTap, text } from '../../app/phaserUi';
import { theme } from '../../app/theme';
import { Rng, type EventLogger, type Game, type LiveTuning } from '../../core';
import type { Clearing, ClearingTree, WoodcuttingFeel } from '../../data';
import { fallTip, resolveChain, type FallStep } from './logic/chain';
import { fitClearing, toScreen } from './logic/layout';
import { fallProgress, fallTimeToReach, judgeChop, meterPosition } from './logic/meter';

export const WOODCUTTING_SCENE = 'woodcutting';

export interface WoodcuttingDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<WoodcuttingFeel>;
}

type Phase =
  | { kind: 'pick' }
  | { kind: 'aim'; tree: string; startedAt: number }
  | { kind: 'chop'; tree: string; angle: number; points: number; startedAt: number }
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
  stump: 0x5a3c22,
  meter: 0x2a2f27,
  good: 0x4f8a3c,
  perfect: 0xd9b44a,
};
/** Seconds a banked chain's logs take to be hauled off (fade out). */
const HAUL_SECONDS = 0.5;
const DEG = Math.PI / 180;

/** Domino felling, M3a feel prototype: one hand-made clearing. */
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

  #graphics!: Phaser.GameObjects.Graphics;
  #hint!: Phaser.GameObjects.Text;
  #total!: Phaser.GameObjects.Text;
  #counter!: Phaser.GameObjects.Text;
  #summary!: Phaser.GameObjects.Container;
  #chips!: Phaser.GameObjects.Particles.ParticleEmitter;
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
    this.#dust = this.add.particles(0, 0, 'wc-dust', {
      speed: { min: 20, max: 110 },
      angle: { min: 0, max: 360 },
      lifespan: 700,
      alpha: { start: 0.55, end: 0 },
      scale: { start: 0.8, end: 2.6 },
      emitting: false,
    });
    this.#total = text(this, '', { fontSize: '14px', color: theme.muted }).setOrigin(0, 0.5);
    this.#hint = text(this, '', { fontSize: '16px', color: theme.fg });
    this.#counter = text(this, '', { fontSize: '40px', fontStyle: 'bold', color: theme.fg })
      .setStroke(theme.bg, 6)
      .setAlpha(0);
    this.#summary = this.#makeSummary();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.#onTap(pointer.x, pointer.y);
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
    this.#summary.setVisible(false);
    this.#setPhase({ kind: 'pick' });
    this.#deps.logger.log('woodcutting.roundStart', {
      clearing: this.#clearing.id,
      trees: this.#clearing.trees.length,
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
      pick: 'Tap a tree',
      aim: 'Tap to lock where it falls',
      chop: 'Tap when the marker is in the green',
      falling: '',
      cleared: '',
    };
    this.#hint.setText(hints[phase.kind]);
  }

  // Input

  #onTap(x: number, y: number): void {
    const phase = this.#phase;
    if (phase.kind === 'pick') {
      const tree = this.#treeAt(x, y);
      if (!tree) return;
      this.#setPhase({ kind: 'aim', tree: tree.id, startedAt: this.#now });
      this.#deps.logger.log('woodcutting.select', { tree: tree.id });
    } else if (phase.kind === 'aim') {
      const angle = this.#aimAngle(phase.startedAt);
      this.#setPhase({ kind: 'chop', tree: phase.tree, angle, points: 0, startedAt: this.#now });
      this.#deps.logger.log('woodcutting.aim', {
        tree: phase.tree,
        angle: Math.round((angle / DEG) % 360),
        aimSeconds: Math.round((this.#now - phase.startedAt) * 10) / 10,
      });
    } else if (phase.kind === 'chop') {
      this.#chop(phase);
    }
  }

  #treeAt(x: number, y: number): ClearingTree | undefined {
    const fit = this.#fit();
    const reach = Math.max(28, this.#clearing.hitRadius * fit.scale * 1.6);
    let best: { tree: ClearingTree; distance: number } | undefined;
    for (const id of this.#standing) {
      const tree = this.#tree(id);
      const point = toScreen(fit, tree);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= reach && (!best || distance < best.distance)) best = { tree, distance };
    }
    return best?.tree;
  }

  #chop(phase: Extract<Phase, { kind: 'chop' }>): void {
    const feel = this.#feel;
    const position = meterPosition(this.#now - phase.startedAt, feel.meterSpeed);
    const { result, points } = judgeChop(position, feel);
    const total = phase.points + points;
    const base = toScreen(this.#fit(), this.#tree(phase.tree));
    this.#deps.logger.log('woodcutting.chop', {
      tree: phase.tree,
      result,
      offset: Math.round(Math.abs(position - 0.5) * 1000) / 1000,
      points: total,
    });

    const shake = feel.shakeStrength;
    if (result === 'perfect') {
      this.#play('perfect', 0.9);
      this.#chips.explode(18, base.x, base.y);
      if (shake > 0) this.cameras.main.shake(120, 0.008 * shake);
      this.#frozenUntil = performance.now() + feel.hitStopMs;
      this.#flash('Perfect!', base.x, base.y - 36, theme.fg);
    } else {
      this.#play('chop', result === 'good' ? 0.8 : 0.5);
      this.#chips.explode(result === 'good' ? 10 : 4, base.x, base.y);
      if (shake > 0) this.cameras.main.shake(70, (result === 'good' ? 0.004 : 0.002) * shake);
      if (result === 'miss') this.#flash('Glancing blow', base.x, base.y - 36, theme.muted);
    }

    if (total >= feel.chopPoints) this.#startChain(phase.tree, phase.angle);
    else this.#phase = { ...phase, points: total };
  }

  // Falling

  #startChain(treeId: string, angle: number): void {
    // The chain is decided here, before anything moves; the animation only plays it back.
    const steps = resolveChain(this.#clearing, this.#standing, treeId, angle);
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
      angle: Math.round((angle / DEG) % 360),
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
    if (shake > 0)
      this.cameras.main.shake(180, Math.min(0.006 + step.depth * 0.002, 0.016) * shake);
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
      this.scale.height * 0.5 + 44,
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

    const canopy = Math.max(10, this.#clearing.hitRadius * fit.scale);
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
      const angle = phase.kind === 'aim' ? this.#aimAngle(phase.startedAt) : phase.angle;
      const tip = toScreen(fit, fallTip(tree, angle));
      // Selection ring
      g.lineStyle(3, theme.accentHex, 1).strokeCircle(base.x, base.y, canopy + 5);
      // Faint line showing exactly how far the tree will reach
      g.lineStyle(2, theme.fgHex, phase.kind === 'aim' ? 0.35 : 0.5).lineBetween(
        base.x,
        base.y,
        tip.x,
        tip.y,
      );
      g.strokeCircle(tip.x, tip.y, 5);
      // Arrow around the base
      const arrowStart = canopy + 8;
      const arrowEnd = canopy + 30;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const ax = base.x + dx * arrowEnd;
      const ay = base.y + dy * arrowEnd;
      g.lineStyle(4, theme.accentHex, 1).lineBetween(
        base.x + dx * arrowStart,
        base.y + dy * arrowStart,
        ax,
        ay,
      );
      g.fillStyle(theme.accentHex, 1).fillTriangle(
        ax + dx * 10,
        ay + dy * 10,
        ax - dy * 7,
        ay + dx * 7,
        ax + dy * 7,
        ay - dx * 7,
      );
    }
    if (phase.kind === 'chop') this.#drawMeter(phase, width, height);

    this.#total.setPosition(16, height - 22).setText(`Logs this round: ${this.#round.logs}`);
    this.#hint.setPosition(width / 2, height - 124);
    this.#counter.setPosition(width / 2, height * 0.5);
    this.#summary.setPosition(width / 2, height * 0.5);
  }

  #drawStump(base: { x: number; y: number }, canopy: number): void {
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

  #drawMeter(phase: Extract<Phase, { kind: 'chop' }>, width: number, height: number): void {
    const g = this.#graphics;
    const feel = this.#feel;
    const barWidth = Math.min(width - 48, 320);
    const barHeight = 26;
    const left = (width - barWidth) / 2;
    const top = height - 78;
    g.fillStyle(COLORS.meter, 1).fillRoundedRect(left, top, barWidth, barHeight, 8);
    const zone = (share: number, color: number) => {
      const zoneWidth = barWidth * share;
      g.fillStyle(color, 1).fillRect(left + (barWidth - zoneWidth) / 2, top, zoneWidth, barHeight);
    };
    zone(feel.timingWindow, COLORS.good);
    zone(feel.perfectWindow, COLORS.perfect);
    const cursorX = left + barWidth * meterPosition(this.#now - phase.startedAt, feel.meterSpeed);
    g.fillStyle(theme.fgHex, 1).fillRect(cursorX - 2, top - 6, 4, barHeight + 12);

    // Chop progress pips
    const pip = 10;
    const gap = 6;
    const pipsWidth = feel.chopPoints * pip + (feel.chopPoints - 1) * gap;
    for (let i = 0; i < feel.chopPoints; i++) {
      const filled = i < phase.points;
      g.fillStyle(filled ? theme.accentHex : COLORS.meter, 1).fillCircle(
        (width - pipsWidth) / 2 + i * (pip + gap) + pip / 2,
        top - 20,
        pip / 2,
      );
    }
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
    if (this.textures.exists('wc-chip')) return;
    const g = this.make.graphics({}, false);
    g.fillStyle(0xd8b483, 1).fillRect(0, 0, 6, 4);
    g.generateTexture('wc-chip', 6, 4);
    g.clear();
    g.fillStyle(0xcbbd9a, 1).fillCircle(6, 6, 6);
    g.generateTexture('wc-dust', 12, 12);
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

  #aimAngle(startedAt: number): number {
    return (this.#now - startedAt) * this.#feel.arrowSpeed * DEG;
  }
}
