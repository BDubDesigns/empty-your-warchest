import * as THREE from 'three';
import './runner.css';
import type { Haptics } from '../../app/haptics';
import type { ScreenView } from '../../app/screen';
import { Sfx } from '../../app/sfx';
import { Rng, type EventLogger, type LiveTuning } from '../../core';
import type { GameData, RunnerFeel } from '../../data';
import {
  gateLabel,
  isGoodOp,
  runnerConfig,
  RunnerSim,
  STEP_SECONDS,
  spearSupply,
  UNARMED,
  type RunResult,
  type RunnerEvent,
  type Side,
  type TrackEnemies,
  type TrackGate,
  type TrackGates,
} from '../sim';

export interface RunnerViewDeps {
  data: GameData;
  logger: EventLogger;
  feel: LiveTuning<RunnerFeel>;
  haptics: Haptics;
}

const SOUNDS: Record<string, string> = {
  ...Object.fromEntries(
    ['chop-1', 'chop-2', 'chop-3', 'chop-perfect', 'land-1', 'land-2', 'land-3', 'star'].map(
      (name) => [name, `audio/woodcutting/${name}.mp3`],
    ),
  ),
  'crash-wood': 'audio/woodcutting/crash-wood.mp3',
  'chest-latch': 'audio/warchest/chest-latch.mp3',
  'log-in-1': 'audio/warchest/log-in-1.mp3',
};

const COLORS = {
  sky: 0xa9cfe0,
  grass: 0x5d8c46,
  track: 0xb89a6a,
  stripe: 0xa88a5c,
  post: 0x6b4a22,
  armed: 0x2f74d0,
  unarmed: 0x8d9099,
  spear: 0xd9c08a,
  bandit: 0xa8433a,
  banditUnarmed: 0x7d5a50,
  good: 0x2e8be6,
  bad: 0xd8453b,
  log: 0x8b5a2b,
  spark: 0xffe08a,
  sparkBright: 0xffffff,
};
/** Spear tips by quality, worst to best: dull iron, bright steel, glowing gold. */
const TIP_COLORS = [0x4a4440, 0xdfe6ee, 0xffc42e];
const ARROW_GEOMETRY = new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4).rotateX(Math.PI / 2);
const ARROW_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x3a2a1a });
const GOOD_CSS = '#2e8be6';
const BAD_CSS = '#d8453b';

/** Most units drawn; the label always shows the true count. */
const MAX_UNITS = 400;
const MAX_PARTICLES = 240;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Capsule size for a unit (m): a placeholder person. */
const UNIT = { radius: 0.2, length: 0.55 };
/** The camera's vertical field of view stays in this range (degrees). */
const FOV = { min: 50, max: 64 };
/** Seconds the result waits after the run ends, so the break or retreat beat plays first. */
const RESULT_DELAY = { won: 1.6, lost: 0.9 };

interface GateVisual {
  panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  drawn: string;
}

interface RunnerUi {
  label: HTMLElement;
  preview: HTMLElement;
  hint: HTMLElement;
  results: HTMLElement;
}

interface Particle {
  color: THREE.Color;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface Arrow {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Seconds since it was loosed (negative: not yet). */
  t: number;
}

interface BanditGroup {
  mesh: THREE.InstancedMesh;
  shafts: THREE.InstancedMesh;
  tips: THREE.InstancedMesh;
  label: THREE.Sprite;
  drawn: number;
}

interface Plank {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
}

/**
 * The Attack Run in three.js: a behind-the-squad camera over a straight track. The sim decides
 * everything; this view feeds it the finger and animates its events.
 */
export class RunnerView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: RunnerViewDeps;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #fx = new Rng('runner-view');
  #world = new THREE.Group();
  readonly #units: THREE.InstancedMesh;
  readonly #spears: { shafts: THREE.InstancedMesh; tips: THREE.InstancedMesh };
  readonly #sparks: THREE.InstancedMesh;
  readonly #unitX = new Float32Array(MAX_UNITS);
  readonly #particles: Particle[] = [];
  #sim!: RunnerSim;
  #seed = 0;
  #gates = new Map<number, Record<Side, GateVisual>>();
  #bandits = new Map<number, BanditGroup>();
  #wall!: { group: THREE.Group; logs: THREE.Mesh[]; tilts: number[]; archers: THREE.Mesh[] };
  #arrows: Arrow[] = [];
  #planks: Plank[] = [];
  #started = false;
  #accumulator = 0;
  #targetX = 0;
  #drag: { pointer: number; startX: number; startTarget: number } | undefined;
  #slowMoLeft = 0;
  #shake = 0;
  #wallShake = 0;
  #cameraX = 0;
  #cameraDistance = 0;
  #clock = 0;
  #nextCountLog = 0;
  #resultAt: number | undefined;
  #lastLabel = '';
  readonly #ui: RunnerUi;

  private constructor(element: HTMLElement, deps: RunnerViewDeps) {
    this.#element = element;
    this.#deps = deps;
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.domElement.className = 'runner-canvas';
    element.append(this.#renderer.domElement);

    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.fog = new THREE.Fog(COLORS.sky, 60, 140);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 10, 6);
    this.#scene.add(sun);
    this.#scene.add(this.#world);

    const unitGeometry = new THREE.CapsuleGeometry(UNIT.radius, UNIT.length, 4, 8);
    unitGeometry.translate(0, UNIT.radius + UNIT.length / 2, 0);
    this.#units = new THREE.InstancedMesh(unitGeometry, new THREE.MeshLambertMaterial(), MAX_UNITS);
    this.#units.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#units.frustumCulled = false;
    this.#scene.add(this.#units);

    this.#spears = this.#spearMeshes(MAX_UNITS);
    this.#scene.add(this.#spears.shafts, this.#spears.tips);

    this.#sparks = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.12),
      new THREE.MeshBasicMaterial(),
      MAX_PARTICLES,
    );
    this.#sparks.frustumCulled = false;
    this.#sparks.count = 0;
    this.#scene.add(this.#sparks);

    this.#ui = this.#buildUi();
    this.#sfx.load(SOUNDS);
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static create(element: HTMLElement, deps: RunnerViewDeps): Promise<RunnerView> {
    return Promise.resolve(new RunnerView(element, deps));
  }

  // ScreenView

  start(): void {
    this.#resize();
    this.#newRun(false);
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#tick(time);
    });
  }

  stop(): void {
    if (this.#started && !this.#sim.done) {
      this.#deps.logger.log('runner.quit', {
        seed: this.#seed,
        seconds: round2(this.#sim.seconds),
        phase: this.#sim.phase,
        count: this.#sim.squad.count,
      });
    }
    this.#renderer.setAnimationLoop(null);
  }

  // Runs

  #newRun(startNow: boolean): void {
    const { data, feel } = this.#deps;
    this.#seed = Date.now() >>> 0;
    this.#sim = new RunnerSim(runnerConfig(data, feel.values, this.#seed));
    this.#targetX = 0;
    this.#accumulator = 0;
    this.#slowMoLeft = 0;
    this.#resultAt = undefined;
    this.#clock = 0;
    this.#nextCountLog = 0;
    this.#cameraX = 0;
    this.#cameraDistance = 0;
    this.#planks = [];
    this.#arrows = [];
    this.#particles.length = 0;
    this.#unitX.fill(0);
    this.#buildWorld();
    this.#ui.results.hidden = true;
    this.#ui.label.hidden = false;
    this.#started = startNow;
    this.#ui.hint.hidden = startNow;
    if (startNow) this.#logStart();
  }

  #logStart(): void {
    const { data, feel, logger } = this.#deps;
    const qualities = data.qualities.map((quality) => quality.id);
    logger.log('runner.start', {
      seed: this.#seed,
      level: data.runner.level,
      spears: spearSupply(qualities, feel.values),
      feel: feel.values,
    });
  }

  // World

  #buildWorld(): void {
    this.#scene.remove(this.#world);
    disposeTree(this.#world);
    this.#world = new THREE.Group();
    this.#scene.add(this.#world);
    this.#gates.clear();
    this.#bandits.clear();

    const sim = this.#sim;
    const width = sim.halfWidth * 2;
    const length = sim.length;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(200, length + 300),
      new THREE.MeshLambertMaterial({ color: COLORS.grass }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.02, -length / 2);
    this.#world.add(grass);
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length + 60),
      new THREE.MeshLambertMaterial({ color: COLORS.track }),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0, -length / 2 + 10);
    this.#world.add(track);

    // Stripes and edge posts give a sense of speed.
    const stripeEvery = 6;
    const stripes = Math.ceil((length + 40) / stripeEvery);
    const stripeMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(width, 0.5),
      new THREE.MeshLambertMaterial({ color: COLORS.stripe }),
      stripes,
    );
    const postMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.25, 0.9, 0.25),
      new THREE.MeshLambertMaterial({ color: COLORS.post }),
      stripes * 2,
    );
    const matrix = new THREE.Matrix4();
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < stripes; i++) {
      const z = 10 - i * stripeEvery;
      matrix.compose(new THREE.Vector3(0, 0.01, z), flat, new THREE.Vector3(1, 1, 1));
      stripeMesh.setMatrixAt(i, matrix);
      for (const side of [-1, 1]) {
        matrix.makeTranslation(side * (sim.halfWidth + 0.3), 0.45, z);
        postMesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix);
      }
    }
    this.#world.add(stripeMesh, postMesh);

    sim.track.forEach((event, index) => {
      if (event.kind === 'gates') this.#buildGates(event, index);
      else if (event.kind === 'enemies') this.#buildBandits(event, index);
      else this.#buildWall(event.at);
    });
  }

  #buildGates(event: TrackGates, index: number): void {
    const visuals = {} as Record<Side, GateVisual>;
    const half = this.#sim.halfWidth;
    for (const side of ['left', 'right'] as const) {
      const x = (side === 'left' ? -1 : 1) * (half / 2);
      const group = new THREE.Group();
      group.position.set(x, 0, -event.at);
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(half - 0.3, 2.6),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      panel.position.y = 1.3;
      group.add(panel);
      for (const edge of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 3, 0.2),
          new THREE.MeshLambertMaterial({ color: 0xf2ead3 }),
        );
        post.position.set((edge * (half - 0.3)) / 2, 1.5, 0);
        group.add(post);
      }
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
      );
      // Sized to its gate, so a pair's labels never overlap.
      label.scale.set(half - 0.4, (half - 0.4) / 2, 1);
      label.position.y = 3.8;
      label.renderOrder = 2;
      group.add(label);
      this.#world.add(group);
      visuals[side] = { panel, label, canvas, texture, drawn: '' };
      this.#drawGate(visuals[side], event[side]);
    }
    this.#gates.set(index, visuals);
  }

  #drawGate(visual: GateVisual, gate: TrackGate): void {
    const active = this.#sim.activeGate(gate);
    const good = isGoodOp(active.op);
    const flipHint =
      gate.base.flip && !gate.flipped ? `beat guards → ${gateLabel(gate.base.flip)}` : '';
    const key = `${gateLabel(active)}|${flipHint}`;
    if (visual.drawn === key) return;
    visual.drawn = key;
    visual.panel.material.color.setHex(good ? COLORS.good : COLORS.bad);
    const context = visual.canvas.getContext('2d');
    if (!context) return;
    const { width, height } = visual.canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = good ? GOOD_CSS : BAD_CSS;
    context.beginPath();
    context.roundRect(8, 8, width - 16, flipHint ? height - 16 : height * 0.72, 36);
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = 'rgba(255,255,255,0.85)';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Colour plus a shape cue, so colourblind players can read it too.
    context.font = '900 112px system-ui, sans-serif';
    const mainY = flipHint ? height * 0.36 : height * 0.39;
    context.fillText(`${good ? '▲' : '▼'} ${gateLabel(active)}`, width / 2, mainY);
    if (flipHint) {
      context.font = '800 52px system-ui, sans-serif';
      context.fillText(flipHint, width / 2, height * 0.76);
    }
    visual.texture.needsUpdate = true;
  }

  #buildBandits(event: TrackEnemies, index: number): void {
    const geometry = new THREE.CapsuleGeometry(UNIT.radius * 1.1, UNIT.length, 4, 8);
    geometry.translate(0, UNIT.radius + UNIT.length / 2, 0);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial(), event.total);
    mesh.frustumCulled = false;
    const spears = this.#spearMeshes(event.total);
    this.#world.add(mesh, spears.shafts, spears.tips);
    const label = this.#textSprite(String(event.total), BAD_CSS);
    label.position.set(this.#laneX(event.lane), 2.6, -event.at - 1.2);
    this.#world.add(label);
    this.#bandits.set(index, { mesh, ...spears, label, drawn: -1 });
  }

  /** Centre of a lane group's half of the track; a full-width group follows the squad. */
  #laneX(lane: TrackEnemies['lane']): number {
    if (lane === 'both') return 0;
    return ((lane === 'left' ? -1 : 1) * this.#sim.halfWidth) / 2;
  }

  /**
   * Bandits pack toward the front line as they fall: the unarmed stand in front (they fall first),
   * the armed carry spears behind them.
   */
  #layoutBandits(event: TrackEnemies, index: number, time: number): void {
    const entry = this.#bandits.get(index);
    if (!entry) return;
    const { mesh, shafts, tips } = entry;
    const alive = event.unarmed + event.armed;
    const width = event.lane === 'both' ? this.#sim.halfWidth * 2 : this.#sim.halfWidth;
    const columns = Math.max(1, Math.floor((width - 0.6) / 0.75));
    const matrix = new THREE.Matrix4();
    const edge = (event.lane === 'both' ? this.#sim.halfWidth : this.#sim.halfWidth / 2) - 0.4;
    const blockHalf = (Math.min(columns, alive) - 1) * 0.375;
    const laneX = this.#laneX(event.lane);
    // A full-width block lines up opposite the squad, so the front lines meet.
    const follow = event.lane === 'both' ? this.#sim.x : laneX;
    const centre = laneX + Math.max(-edge + blockHalf, Math.min(edge - blockHalf, follow - laneX));
    const armedColor = new THREE.Color(COLORS.bandit);
    const unarmedColor = new THREE.Color(COLORS.banditUnarmed);
    const tipColor = new THREE.Color(
      this.#tipColor(this.#sim.enemyFront({ ...event, unarmed: 0 })),
    );
    let spearCount = 0;
    for (let i = 0; i < alive; i++) {
      const row = Math.floor(i / columns);
      const slot = i % columns;
      const offset = Math.ceil(slot / 2) * (slot % 2 === 0 ? 1 : -1);
      const x = centre + offset * 0.75 + Math.sin(time * 6 + i) * 0.04;
      const z = -event.at - 0.7 - row * 0.75;
      const y = Math.abs(Math.sin(time * 9 + i * 1.7)) * 0.05;
      matrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, matrix);
      const armed = i >= event.unarmed;
      mesh.setColorAt(i, armed ? armedColor : unarmedColor);
      if (armed) {
        this.#placeSpear(shafts, tips, spearCount, x - 0.18, y, z, 0.35, tipColor);
        spearCount++;
      }
    }
    mesh.count = alive;
    shafts.count = tips.count = spearCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    shafts.instanceMatrix.needsUpdate = true;
    tips.instanceMatrix.needsUpdate = true;
    if (tips.instanceColor) tips.instanceColor.needsUpdate = true;
    if (entry.drawn !== alive) {
      entry.drawn = alive;
      this.#redrawText(entry.label, String(alive), BAD_CSS);
      entry.label.visible = alive > 0;
    }
  }

  /** Spear shafts and tinted tips for up to `count` holders. */
  #spearMeshes(count: number): { shafts: THREE.InstancedMesh; tips: THREE.InstancedMesh } {
    const shaftGeometry = new THREE.CylinderGeometry(0.025, 0.025, 1.6, 5);
    shaftGeometry.translate(0, 0.8, 0);
    const shafts = new THREE.InstancedMesh(
      shaftGeometry,
      new THREE.MeshLambertMaterial({ color: COLORS.spear }),
      count,
    );
    const tipGeometry = new THREE.ConeGeometry(0.07, 0.3, 6);
    tipGeometry.translate(0, 1.75, 0);
    // Unlit, so a Perfect gold tip glows and a Poor one stays dull in any light.
    const tips = new THREE.InstancedMesh(tipGeometry, new THREE.MeshBasicMaterial(), count);
    for (const mesh of [shafts, tips]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
    }
    return { shafts, tips };
  }

  #placeSpear(
    shafts: THREE.InstancedMesh,
    tips: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    lean: number,
    tipColor: THREE.Color,
  ): void {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 0.35, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    shafts.setMatrixAt(index, matrix);
    tips.setMatrixAt(index, matrix);
    tips.setColorAt(index, tipColor);
  }

  /** Where a fighter's spear sits among the tiers. */
  #tierOf(fighter: string): 'none' | 'worst' | 'middle' | 'best' {
    const qualities = this.#deps.data.qualities;
    const tier = qualities.findIndex((entry) => entry.id === fighter);
    if (tier < 0) return 'none';
    if (tier === qualities.length - 1) return 'best';
    return tier === 0 ? 'worst' : 'middle';
  }

  /** Spear tips by quality, worst to best: dull iron, bright steel, glowing gold. */
  #tipColor(quality: string): number {
    const tier = this.#deps.data.qualities.findIndex((entry) => entry.id === quality);
    return TIP_COLORS[Math.max(0, Math.min(TIP_COLORS.length - 1, tier))] ?? COLORS.spear;
  }

  #buildWall(at: number): void {
    const group = new THREE.Group();
    group.position.z = -at - 0.5;
    const logs: THREE.Mesh[] = [];
    const tilts: number[] = [];
    const count = Math.ceil((this.#sim.halfWidth * 2 + 1) / 0.5);
    const geometry = new THREE.CylinderGeometry(0.25, 0.25, 3.2, 8);
    geometry.translate(0, 1.6, 0);
    const tip = new THREE.ConeGeometry(0.25, 0.6, 8);
    tip.translate(0, 3.5, 0);
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshLambertMaterial({ color: COLORS.log });
      const log = new THREE.Mesh(geometry, material);
      log.add(new THREE.Mesh(tip, material));
      log.position.x = -this.#sim.halfWidth - 0.5 + i * 0.5 + 0.25;
      group.add(log);
      logs.push(log);
      tilts.push(this.#fx.range(-1, 1));
    }
    // Archers on a walkway behind the points.
    const archers: THREE.Mesh[] = [];
    const archerGeometry = new THREE.CapsuleGeometry(UNIT.radius, UNIT.length, 4, 8);
    archerGeometry.translate(0, UNIT.radius + UNIT.length / 2, 0);
    const archerMaterial = new THREE.MeshLambertMaterial({ color: COLORS.bandit });
    const archerCount = 6;
    for (let i = 0; i < archerCount; i++) {
      const archer = new THREE.Mesh(archerGeometry, archerMaterial);
      archer.position.set(
        -this.#sim.halfWidth + ((i + 0.5) / archerCount) * this.#sim.halfWidth * 2,
        2.9,
        -0.6,
      );
      group.add(archer);
      archers.push(archer);
    }
    this.#world.add(group);
    this.#wall = { group, logs, tilts, archers };
  }

  /** The palisade cracks as it takes damage: logs lean and darken as its hit points fall. */
  #drawWallDamage(damage: number): void {
    this.#wall.logs.forEach((log, i) => {
      const tilt = this.#wall.tilts[i] ?? 0;
      log.rotation.z = tilt * damage * 0.35;
      log.rotation.x = Math.abs(tilt) * damage * 0.25;
      const material = log.material as THREE.MeshLambertMaterial;
      material.color.setHex(COLORS.log).multiplyScalar(1 - damage * 0.45);
    });
  }

  /** A volley: arrows arc from the archers into the squad. */
  #fireVolley(arrows: number): void {
    const sim = this.#sim;
    const squadZ = -sim.distance + sim.crowdRadius * 0.8;
    for (let i = 0; i < arrows; i++) {
      const archer = this.#wall.archers[i % this.#wall.archers.length];
      if (!archer) continue;
      const from = new THREE.Vector3();
      archer.getWorldPosition(from);
      from.y += 0.8;
      const to = new THREE.Vector3(
        sim.x + this.#fx.range(-1, 1) * sim.crowdRadius,
        0.6,
        squadZ + this.#fx.range(-1, 1) * sim.crowdRadius * 0.8,
      );
      const mesh = new THREE.Mesh(ARROW_GEOMETRY, ARROW_MATERIAL);
      this.#world.add(mesh);
      this.#arrows.push({ mesh, from, to, t: -i * 0.04 });
    }
  }

  #animateArrows(dt: number): void {
    const flight = 0.45;
    for (const arrow of this.#arrows) {
      arrow.t += dt;
      const k = Math.max(0, Math.min(1, arrow.t / flight));
      const position = arrow.from.clone().lerp(arrow.to, k);
      position.y += Math.sin(k * Math.PI) * 3;
      const ahead = arrow.from.clone().lerp(arrow.to, Math.min(1, k + 0.05));
      ahead.y += Math.sin(Math.min(1, k + 0.05) * Math.PI) * 3;
      arrow.mesh.position.copy(position);
      arrow.mesh.lookAt(ahead);
      arrow.mesh.visible = arrow.t >= 0 && k < 1;
    }
    const landed = this.#arrows.filter((arrow) => arrow.t >= flight);
    for (const arrow of landed) {
      this.#burst(arrow.to, 4, COLORS.bad, 2);
      this.#world.remove(arrow.mesh);
    }
    this.#arrows = this.#arrows.filter((arrow) => arrow.t < flight);
  }

  #breakWall(): void {
    const { group, logs } = this.#wall;
    for (const log of logs) {
      const world = new THREE.Vector3();
      log.getWorldPosition(world);
      group.remove(log);
      log.position.copy(world);
      this.#world.add(log);
      this.#planks.push({
        mesh: log,
        velocity: new THREE.Vector3(
          this.#fx.range(-5, 5),
          this.#fx.range(5, 11),
          this.#fx.range(-9, -3),
        ),
        spin: new THREE.Vector3(
          this.#fx.range(-6, 6),
          this.#fx.range(-3, 3),
          this.#fx.range(-6, 6),
        ),
      });
    }
  }

  // Text

  #textSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    sprite.scale.set(3, 1.5, 1);
    sprite.renderOrder = 2;
    this.#redrawText(sprite, text, color);
    return sprite;
  }

  #redrawText(sprite: THREE.Sprite, text: string, color: string): void {
    const texture = sprite.material.map as THREE.CanvasTexture;
    const canvas = texture.image;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(30, 14, canvas.width - 60, canvas.height - 28, 30);
    context.fill();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 76px system-ui, sans-serif';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
    texture.needsUpdate = true;
  }

  // UI

  #buildUi(): RunnerUi {
    const make = (className: string, parent: HTMLElement = this.#element): HTMLElement => {
      const element = document.createElement('div');
      element.className = className;
      parent.append(element);
      return element;
    };
    const label = make('runner-label');
    const preview = make('runner-preview');
    preview.hidden = true;
    const hint = make('runner-hint');
    hint.textContent = 'Touch and slide to steer';
    const results = make('runner-results');
    results.hidden = true;
    return { label, preview, hint, results };
  }

  #showResults(result: RunResult): void {
    const { results } = this.#ui;
    results.replaceChildren();
    const line = (name: string, value: string): void => {
      const element = document.createElement('div');
      element.className = 'runner-results-line';
      const label = document.createElement('span');
      label.textContent = `${name} `;
      element.append(label, value);
      results.append(element);
    };
    const title = document.createElement('div');
    title.className = `runner-results-title ${result.won ? 'runner-results-won' : 'runner-results-lost'}`;
    title.textContent = result.won ? 'Wall broken!' : 'Retreat';
    results.append(title);
    line('Survivors', `${result.survivors} (${result.armed} armed)`);
    line('Spears used', String(result.spearsUsed));
    line('Bandits beaten', String(result.enemiesBeaten));
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'runner-again';
    again.textContent = 'Run again';
    again.addEventListener('click', () => {
      this.#sfx.unlock();
      this.#deps.logger.log('runner.again', { seed: this.#seed });
      this.#newRun(true);
    });
    results.append(again);
    results.hidden = false;
    this.#ui.label.hidden = true;
    this.#ui.preview.hidden = true;
  }

  #callout(text: string, bad: boolean): void {
    const element = document.createElement('div');
    element.className = `runner-callout${bad ? ' runner-callout-bad' : ''}`;
    element.textContent = text;
    this.#element.append(element);
    element.addEventListener('animationend', () => {
      element.remove();
    });
  }

  #flashLabel(good: boolean): void {
    const { label } = this.#ui;
    label.classList.remove('runner-label-good', 'runner-label-bad');
    label.getBoundingClientRect(); // Restart the animation.
    label.classList.add(good ? 'runner-label-good' : 'runner-label-bad');
  }

  // Input

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      if (this.#drag) return;
      canvas.setPointerCapture(event.pointerId);
      this.#drag = { pointer: event.pointerId, startX: event.clientX, startTarget: this.#targetX };
      if (!this.#started && !this.#sim.done) {
        this.#started = true;
        this.#ui.hint.hidden = true;
        this.#logStart();
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      const drag = this.#drag;
      if (!drag || drag.pointer !== event.pointerId) return;
      // Relative drag: the squad moves as far as the finger does, wherever the touch began.
      const widths = (event.clientX - drag.startX) / Math.max(1, canvas.clientWidth);
      const target =
        drag.startTarget + widths * this.#deps.feel.values.dragScale * this.#sim.halfWidth * 2;
      const max = this.#sim.maxX;
      this.#targetX = Math.max(-max, Math.min(max, target));
      // Past the edge, re-anchor so sliding back responds at once.
      if (target !== this.#targetX) {
        drag.startX = event.clientX;
        drag.startTarget = this.#targetX;
      }
    });
    const release = (event: PointerEvent): void => {
      if (this.#drag?.pointer === event.pointerId) this.#drag = undefined;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  // Loop

  #tick(time: number): void {
    this.#timer.update(time);
    const realDt = Math.min(0.1, this.#timer.getDelta());
    const sim = this.#sim;
    sim.setFeel(this.#deps.feel.values);
    const feel = sim.feel;
    let scale = 1;
    if (this.#slowMoLeft > 0) {
      this.#slowMoLeft -= realDt;
      scale = feel.slowMoScale;
    }
    const dt = realDt * scale;
    this.#clock += dt;
    if (this.#started && !sim.done) {
      this.#accumulator += dt;
      // Fixed steps keep the rules deterministic whatever the frame rate.
      while (this.#accumulator >= STEP_SECONDS) {
        this.#accumulator -= STEP_SECONDS;
        for (const event of sim.step(this.#targetX)) this.#onEvent(event);
      }
      if (sim.seconds >= this.#nextCountLog) {
        this.#nextCountLog += 1;
        this.#deps.logger.log('runner.count', {
          seconds: round2(sim.seconds),
          count: sim.squad.count,
          armed: sim.squad.armedCount,
          distance: round2(sim.distance),
          phase: sim.phase,
        });
      }
    }
    if (this.#resultAt !== undefined) {
      this.#resultAt -= realDt;
      if (this.#resultAt <= 0) {
        this.#resultAt = undefined;
        const result = sim.result;
        if (result) this.#showResults(result);
      }
    }
    // For tests and debugging: where the run is.
    document.body.dataset.runner = this.#started ? sim.phase : 'ready';
    this.#animate(dt);
    this.#renderer.render(this.#scene, this.#camera);
    this.#placeLabels();
  }

  #animate(dt: number): void {
    const sim = this.#sim;
    const feel = sim.feel;
    const radius = sim.crowdRadius;
    // The rules' distance is the squad's front line, so the blob is drawn behind it: it touches
    // bandits and the wall where the rules say the fight happens.
    const squadZ = -sim.distance + radius * 0.8;

    // Camera: behind and above, pulling back as the crowd grows.
    const wantDistance = feel.cameraDistance + feel.cameraPullback * radius;
    this.#cameraDistance =
      this.#cameraDistance === 0
        ? wantDistance
        : this.#cameraDistance + (wantDistance - this.#cameraDistance) * (1 - Math.exp(-dt * 3));
    this.#cameraX += (sim.x * 0.3 - this.#cameraX) * (1 - Math.exp(-dt * 6));
    const angle = THREE.MathUtils.degToRad(feel.cameraAngle);
    // Aim a little ahead of the squad so the next seconds of track show above it.
    const lookAhead = feel.cameraLookAhead;
    const shake = this.#shake;
    this.#shake = Math.max(0, this.#shake - dt * 2.5);
    this.#camera.position.set(
      this.#cameraX + this.#fx.range(-1, 1) * shake * 0.3,
      Math.sin(angle) * this.#cameraDistance + this.#fx.range(-1, 1) * shake * 0.2,
      squadZ + Math.cos(angle) * this.#cameraDistance,
    );
    this.#camera.lookAt(this.#cameraX, 0, squadZ - lookAhead);
    this.#fitTrack(this.#cameraDistance);

    this.#layoutUnits(dt, squadZ, radius);
    sim.track.forEach((event, index) => {
      if (event.kind === 'enemies') this.#layoutBandits(event, index, this.#clock);
      if (event.kind === 'gates') this.#updateGates(event, index, -sim.distance);
    });

    // The wall shakes with each hit; broken logs fly.
    this.#wallShake = Math.max(0, this.#wallShake - dt * 4);
    this.#wall.group.position.x = this.#fx.range(-1, 1) * this.#wallShake * 0.12;
    for (const plank of this.#planks) {
      plank.velocity.y -= 18 * dt;
      plank.mesh.position.addScaledVector(plank.velocity, dt);
      plank.mesh.rotation.x += plank.spin.x * dt;
      plank.mesh.rotation.y += plank.spin.y * dt;
      plank.mesh.rotation.z += plank.spin.z * dt;
      if (plank.mesh.position.y < -2) plank.mesh.visible = false;
    }
    this.#animateArrows(dt);
    this.#animateParticles(dt);
  }

  /**
   * Widens the view (within limits) so the track nearly fits a portrait screen where the squad
   * runs; too wide a view makes everything ahead tiny.
   */
  #fitTrack(distance: number): void {
    const aspect = this.#camera.aspect;
    const halfSpan = this.#sim.halfWidth * 0.85;
    const horizontal = Math.atan(halfSpan / Math.max(1, distance));
    const vertical = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal) / aspect));
    const fov = Math.max(FOV.min, Math.min(FOV.max, vertical));
    if (Math.abs(fov - this.#camera.fov) > 0.01) {
      this.#camera.fov = fov;
      this.#camera.updateProjectionMatrix();
    }
  }

  /**
   * The crowd is a loose blob around the squad centre: best spears in the middle, the unarmed
   * outside (they fall first). Units further out trail the centre on turns.
   */
  #layoutUnits(dt: number, squadZ: number, radius: number): void {
    const sim = this.#sim;
    const squad = sim.squad;
    const shown = Math.min(MAX_UNITS, squad.count);
    const armedShown = Math.min(shown, squad.armedCount);
    const running = sim.phase === 'running' && this.#started;
    const pushing = sim.phase === 'clash' || sim.phase === 'wall';
    const lag = sim.feel.edgeLag;
    const matrix = new THREE.Matrix4();
    // Inner slots hold the best spears: tiers from best to worst, then the unarmed outside.
    const tiers: THREE.Color[] = [];
    for (const quality of [...squad.qualities].reverse()) {
      const color = new THREE.Color(this.#tipColor(quality));
      for (let n = squad.armed(quality); n > 0 && tiers.length < armedShown; n--) tiers.push(color);
    }
    const armed = new THREE.Color(COLORS.armed);
    const unarmed = new THREE.Color(COLORS.unarmed);
    for (let i = 0; i < shown; i++) {
      const r = radius * Math.sqrt((i + 0.5) / shown);
      const a = i * GOLDEN_ANGLE;
      const targetX = sim.x + Math.cos(a) * r;
      const tau = lag * 0.12 * r;
      const current = this.#unitX[i] ?? 0;
      const x =
        tau > 0.001 && current !== 0
          ? current + (targetX - current) * (1 - Math.exp(-dt / tau))
          : targetX;
      this.#unitX[i] = x;
      // A big crowd squeezes in at the track's edges rather than spilling off it.
      const edge = sim.halfWidth - UNIT.radius;
      const shownX = Math.max(-edge, Math.min(edge, x));
      let z = squadZ + Math.sin(a) * r * 0.8;
      if (pushing) z += Math.sin(this.#clock * 14 + i) * 0.08 - 0.1;
      const bob = running ? Math.abs(Math.sin(this.#clock * 12 + i * 0.7)) * 0.12 : 0;
      matrix.makeTranslation(shownX, bob, z);
      this.#units.setMatrixAt(i, matrix);
      this.#units.setColorAt(i, i < armedShown ? armed : unarmed);
      const tip = tiers[i];
      if (tip)
        this.#placeSpear(
          this.#spears.shafts,
          this.#spears.tips,
          i,
          shownX + 0.18,
          bob,
          z + 0.1,
          -0.35,
          tip,
        );
    }
    for (let i = shown; i < MAX_UNITS; i++) this.#unitX[i] = 0;
    this.#units.count = shown;
    this.#spears.shafts.count = this.#spears.tips.count = armedShown;
    this.#units.instanceMatrix.needsUpdate = true;
    if (this.#units.instanceColor) this.#units.instanceColor.needsUpdate = true;
    this.#spears.shafts.instanceMatrix.needsUpdate = true;
    this.#spears.tips.instanceMatrix.needsUpdate = true;
    if (this.#spears.tips.instanceColor) this.#spears.tips.instanceColor.needsUpdate = true;
  }

  #updateGates(event: TrackGates, index: number, squadZ: number): void {
    const visuals = this.#gates.get(index);
    if (!visuals) return;
    const feel = this.#sim.feel;
    const ahead = event.at + squadZ;
    // Labels are fully readable `gateReadSeconds` ahead and fade in before that.
    const read = feel.runSpeed * feel.gateReadSeconds;
    const opacity = event.passed ? 0.25 : Math.max(0.15, Math.min(1, (read + 20 - ahead) / 20));
    for (const side of ['left', 'right'] as const) {
      const visual = visuals[side];
      const gate = event[side];
      this.#drawGate(visual, gate);
      visual.label.material.opacity = opacity;
      visual.panel.material.opacity = event.passed ? 0.15 : 0.42;
    }
  }

  #placeLabels(): void {
    const sim = this.#sim;
    const { label, preview } = this.#ui;
    const head = new THREE.Vector3(sim.x, 1.6, -sim.distance + sim.crowdRadius * 0.8);
    head.project(this.#camera);
    const width = this.#element.clientWidth;
    const height = this.#element.clientHeight;
    const x = (head.x * 0.5 + 0.5) * width;
    const y = (-head.y * 0.5 + 0.5) * height - 18;
    const { count, armedCount } = sim.squad;
    const text = `${count}|${armedCount}`;
    if (text !== this.#lastLabel) {
      this.#lastLabel = text;
      label.innerHTML = `${count} <small>(${armedCount} armed)</small>`;
    }
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    const ghost = this.#started && !sim.done ? sim.preview() : undefined;
    preview.hidden = ghost === undefined;
    if (ghost) {
      const event = sim.track[ghost.index];
      const gate = event?.kind === 'gates' ? sim.activeGate(event[ghost.side]) : undefined;
      const good = gate !== undefined && isGoodOp(gate.op);
      preview.className = `runner-preview ${good ? 'runner-preview-good' : 'runner-preview-bad'}`;
      preview.innerHTML = `${ghost.from} → ${ghost.to} <small>(${ghost.armedTo} armed)</small>`;
      preview.style.left = `${x}px`;
      preview.style.top = `${y - 34}px`;
    }
  }

  // Effects

  #burst(at: THREE.Vector3, count: number, color: number, speed: number, size = 1): void {
    for (let i = 0; i < count; i++) {
      if (this.#particles.length >= MAX_PARTICLES) this.#particles.shift();
      const life = this.#fx.range(0.3, 0.6);
      this.#particles.push({
        color: new THREE.Color(color),
        position: at.clone(),
        velocity: new THREE.Vector3(
          this.#fx.range(-1, 1) * speed,
          this.#fx.range(0.5, 1.5) * speed,
          this.#fx.range(-1, 1) * speed,
        ),
        life,
        maxLife: life,
        size,
      });
    }
  }

  #animateParticles(dt: number): void {
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const none = new THREE.Quaternion();
    let alive = 0;
    for (const particle of this.#particles) {
      particle.life -= dt;
      if (particle.life <= 0) continue;
      particle.velocity.y -= 12 * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      const s = particle.size * (particle.life / particle.maxLife);
      matrix.compose(particle.position, none, scale.set(s, s, s));
      this.#sparks.setMatrixAt(alive, matrix);
      this.#sparks.setColorAt(alive, particle.color);
      alive++;
    }
    this.#particles.splice(0, this.#particles.length, ...this.#particles.filter((p) => p.life > 0));
    this.#sparks.count = alive;
    this.#sparks.instanceMatrix.needsUpdate = true;
    if (this.#sparks.instanceColor) this.#sparks.instanceColor.needsUpdate = true;
  }

  #sound(name: string, volume: number, pitch = 0, jitter = 160): void {
    this.#sfx.play(name, volume, pitch + this.#fx.range(-0.5, 0.5) * jitter);
  }

  // Events from the rules

  #onEvent(event: RunnerEvent): void {
    const sim = this.#sim;
    const { haptics, logger } = this.#deps;
    const feel = sim.feel;
    const squadAt = new THREE.Vector3(sim.x, 1, -sim.distance);
    switch (event.type) {
      case 'gate': {
        logger.log('runner.gate', {
          index: event.index,
          side: event.side,
          op: event.gate.op,
          value: event.gate.value,
          flipped: event.flipped,
          before: event.before,
          after: event.after,
          armedBefore: event.armedBefore,
          armedAfter: event.armedAfter,
        });
        this.#flashLabel(event.good);
        if (event.good) {
          this.#burst(squadAt, 24, COLORS.good, 5);
          this.#sound('log-in-1', 0.7, 300);
          this.#sound('star', 0.45, 200 + Math.min(900, event.after * 8), 0);
          haptics.pulse(feel.buzzGoodGateMs);
        } else {
          this.#burst(squadAt, 14, COLORS.bad, 3);
          this.#sound('land-2', 0.9, -500);
          this.#shake = 0.6;
          haptics.pulse(feel.buzzBadGateMs);
        }
        break;
      }
      case 'flip': {
        logger.log('runner.flip', {
          index: event.index,
          side: event.side,
          seconds: round2(sim.seconds),
        });
        const gates = sim.track[event.index];
        if (gates?.kind === 'gates') {
          const visual = this.#gates.get(event.index)?.[event.side];
          if (visual) this.#drawGate(visual, gates[event.side]);
          const at = new THREE.Vector3(
            (event.side === 'left' ? -1 : 1) * (sim.halfWidth / 2),
            3,
            -gates.at,
          );
          this.#burst(at, 30, COLORS.good, 6);
        }
        this.#sound('chest-latch', 1, -200, 0);
        this.#sound('star', 0.6, 700, 0);
        haptics.pulse(feel.buzzFlipMs);
        break;
      }
      case 'clashStart':
        logger.log('runner.clash', {
          index: event.index,
          enemies: event.enemies,
          enemiesArmed: event.enemiesArmed,
          squad: event.squad,
          armed: event.armed,
        });
        break;
      case 'avoided':
        logger.log('runner.avoided', { index: event.index });
        break;
      case 'blow': {
        const front = new THREE.Vector3(
          sim.x + this.#fx.range(-1, 1) * Math.min(sim.crowdRadius, sim.halfWidth) * 0.6,
          0.9,
          -sim.distance - 0.3,
        );
        const bright = event.enemyFell && this.#tierOf(event.fighter) === 'best';
        if (bright) {
          // A Perfect spear's kill: brighter spark, heavier hit.
          this.#burst(front, 14, COLORS.sparkBright, 5, 1.5);
          this.#sound('chop-perfect', 0.7, 0);
          this.#shake = Math.max(this.#shake, 0.25);
        } else {
          this.#burst(front, 3, event.fighter === UNARMED ? COLORS.unarmed : COLORS.spark, 2.5);
          this.#sound(`chop-${1 + this.#fx.int(0, 2)}`, 0.3, event.enemyFell ? 200 : -200);
        }
        if (event.enemyFell) this.#burst(front, 8, COLORS.bandit, 3);
        if (event.unitFell) this.#burst(front, 8, COLORS.armed, 3);
        if (event.enemyFell || event.unitFell) haptics.pulse(feel.buzzTradeMs);
        break;
      }
      case 'clashWon':
        logger.log('runner.clashWon', {
          index: event.index,
          squad: event.squad,
          armed: event.armed,
        });
        this.#sound('star', 0.4, 0, 0);
        break;
      case 'wallStart':
        logger.log('runner.wall', { squad: event.squad, armed: event.armed });
        break;
      case 'wallHit': {
        const wall = sim.track[event.index];
        if (wall?.kind === 'wall') this.#drawWallDamage(1 - wall.hp / wall.maxHp);
        this.#wallShake = 1;
        const at = new THREE.Vector3(sim.x + this.#fx.range(-1.5, 1.5), 1.4, -sim.distance - 0.6);
        this.#burst(at, 5, COLORS.log, 3);
        this.#sound(`land-${1 + this.#fx.int(0, 2)}`, 0.5, 300);
        haptics.pulse(feel.buzzWallHitMs);
        break;
      }
      case 'volley':
        logger.log('runner.volley', { lost: event.lost.length, squad: event.squad });
        this.#fireVolley(Math.max(4, event.lost.length * 3));
        this.#sound('land-2', 0.6, 600);
        haptics.pulse(feel.buzzVolleyMs);
        break;
      case 'won':
        logger.log('runner.result', { seed: this.#seed, ...event.result });
        this.#breakWall();
        this.#slowMoLeft = feel.slowMoSeconds;
        this.#shake = 1;
        this.#callout('Wall broken!', false);
        this.#sound('crash-wood', 1, 0, 0);
        [0, 400, 700].forEach((pitch) => {
          this.#sound('star', 0.6, pitch, 0);
        });
        haptics.pulse(feel.buzzWallBreakMs);
        this.#resultAt = RESULT_DELAY.won;
        break;
      case 'lost':
        logger.log('runner.result', { seed: this.#seed, ...event.result });
        this.#callout('Retreat!', true);
        this.#sound('land-3', 1, -900, 0);
        haptics.pulse(feel.buzzLoseMs);
        this.#resultAt = RESULT_DELAY.lost;
        break;
    }
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Frees the GPU memory of everything under `root`. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
    const mesh = object as THREE.Mesh;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
  });
}
