import * as THREE from 'three';
import { gpuOf } from '../../../app/deviceHints';
import { groundMesh } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import { loadModel } from '../../../app/models';
import { capturePointer } from '../../../app/pointer';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { WarchestHud, arrowModel, type ScreenPoint } from '../../../app/warchestHud';
import { textureBytes } from '../../../bench/logic/stats';
import type {
  EventLogger,
  Game,
  GraphicsSettings,
  GraphicsTier,
  LiveTuning,
  Stack,
} from '../../../core';
import type { Archery, ArcheryFeel } from '../../../data';
import { clampAim, previewPath, wobbleOf } from '../logic/flight';
import {
  ArcheryRound,
  bestArrow,
  type ArcheryEvent,
  type ArcheryResult,
  type LiveBird,
  type ShotArrow,
} from '../logic/round';
import { BirdKit, flap, type BirdModel } from './birdModel';
import { Bow } from './bow';
import { Clouds, SKY, TreeLine, skyTexture } from './scenery';

export interface Archery3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<ArcheryFeel>;
  /** The graphics tier: how many clouds, trees and feathers, and how sharp. Calm frames feed it. */
  graphics: GraphicsSettings;
  haptics: Haptics;
  /** Leaves the station (the end card's Back to camp). */
  onLeave: () => void;
}

const DEG = Math.PI / 180;
const TREES = [
  'models/kenney/tree_default.glb',
  'models/kenney/tree_oak.glb',
  'models/kenney/tree_fat.glb',
];
const SOUNDS: Record<string, string> = {
  creak: 'audio/woodcutting/creak-1.mp3',
  release: 'audio/splitting/press-click.mp3',
  hit: 'audio/woodcutting/chop-2.mp3',
  thud: 'audio/woodcutting/land-1.mp3',
  plop: 'audio/warchest/log-in-1.mp3',
  star: 'audio/woodcutting/star.mp3',
};
/** Dots along the aim preview, at most, and how far apart (seconds of flight). */
const PREVIEW_DOTS = 40;
const PREVIEW_STEP = 1 / 40;
/** Feathers drifting at once, at most. */
const MAX_FEATHERS = 72;
/** A shot bird tumbles down for this long before it's gone. */
const FALL_SECONDS = 2.2;
/** A lost arrow fades out over this long. */
const FADE_SECONDS = 0.35;
/** The card waits this long after the round ends, so the last bird is seen to fall. */
const CARD_DELAY = 0.9;

interface BirdVisual {
  bird: LiveBird;
  model: BirdModel;
  /** Shot down: tumbling from here. */
  fall: { x: number; y: number; vx: number; vy: number; spin: number; age: number } | undefined;
  age: number;
}

interface ArrowVisual {
  arrow: ShotArrow;
  mesh: THREE.Object3D;
  fade: number;
}

interface Feather {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  turn: number;
  age: number;
  life: number;
  color: THREE.Color;
}

interface Poop {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  vy: number;
  age: number;
}

/**
 * The bird hunt in 3D (2.5D): you stand at the forest edge looking up into the sky, the bow at the
 * bottom of the screen. Flocks cross a flat field square on to the camera; drag back anywhere to
 * draw (how far sets the power, the opposite way is the aim), with a short preview of the first
 * part of the arrow's path, and let go to shoot. The rules (ArcheryRound) decide everything; this
 * draws them, feeds them shots, and pours what the birds drop into the chest.
 */
export class Archery3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Archery3DDeps;
  readonly #rules: Archery;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #ui: ReturnType<Archery3DView['buildUi']>;
  /** The play field, square on to the camera: its x and y are the rules' field units. */
  readonly #field = new THREE.Group();
  /** Where the bow is held, square on to the camera too, between it and the field's origin. */
  readonly #bowSpot = new THREE.Group();
  readonly #bow: Bow;
  readonly #ground: THREE.Mesh;
  readonly #groundLooks: { high: THREE.Material; low: THREE.Material };
  readonly #clouds: Clouds;
  readonly #trees: TreeLine;
  readonly #preview: THREE.InstancedMesh;
  readonly #feathers: THREE.InstancedMesh;
  readonly #arrowModels: Record<'fletched' | 'bare', THREE.Object3D>;
  #tier: GraphicsTier;
  #look: Archery['looks']['tiers']['high'];
  #round: ArcheryRound | undefined;
  #kits = new Map<string, BirdKit>();
  #birds: BirdVisual[] = [];
  #arrows: ArrowVisual[] = [];
  #featherList: Feather[] = [];
  #poops: Poop[] = [];
  /** The arrow kind (its item) the quiver's on. */
  #quiver: string | undefined;
  #pointer: { id: number; startX: number; startY: number; draw: number; angle: number } | undefined;
  /** Round time (real seconds) the next arrow's on the string. */
  #reloadAt = 0;
  #clock = 0;
  #frozenUntil = 0;
  #shake = 0;
  #drawTicks = 0;
  #endedAt: number | undefined;
  #cardShown = false;
  #bonus: { result: ArcheryResult; deposits: ReturnType<WarchestHud['hold']>[] } | undefined;
  #perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };
  #statsAt = 0;

  private constructor(
    element: HTMLElement,
    deps: Archery3DDeps,
    hud: WarchestHud,
    trees: THREE.Object3D[],
  ) {
    this.#element = element;
    this.#deps = deps;
    this.#hud = hud;
    this.#rules = deps.game.data.archery;
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'archery');
    this.#skill = station?.skill ?? 'archery';
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    deps.graphics.noteGpu(gpuOf(this.#renderer.getContext()).gpu);
    this.#tier = deps.graphics.tier;
    this.#look = this.#rules.looks.tiers[this.#tier];
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.#look.pixelRatio));
    this.#renderer.domElement.className = 'ar-canvas';
    element.dataset.graphics = this.#tier;
    element.append(this.#renderer.domElement);
    this.#ui = this.buildUi();
    this.#sfx.load(SOUNDS);

    const looks = this.#rules.looks;
    this.#scene.background = skyTexture();
    this.#scene.fog = new THREE.Fog(
      SKY.horizon,
      looks.treeDistance.min * 0.7,
      looks.treeDistance.max * 1.6,
    );
    this.#scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5a6a3a, 2.1));
    const sun = new THREE.DirectionalLight(0xfff1d8, 1.6);
    sun.position.set(30, 60, 20);
    this.#scene.add(sun);
    this.#camera.position.set(0, looks.eyeHeight, 0);
    this.#camera.rotation.set(looks.pitch * DEG, 0, 0);
    this.#camera.updateMatrixWorld();

    // The ground: meadow out to the trees (plain on the low tier, its texture is a big one).
    const size = looks.treeDistance.max * 3;
    this.#ground = groundMesh('meadowGrass', size, size);
    this.#ground.position.z = -size / 4;
    this.#groundLooks = {
      high: this.#ground.material as THREE.Material,
      low: new THREE.MeshLambertMaterial({ color: SKY.ground }),
    };
    this.#ground.material = this.#groundLooks[this.#tier];
    this.#scene.add(this.#ground);

    const { high } = looks.tiers;
    this.#trees = new TreeLine(trees, Math.max(high.trees, looks.tiers.low.trees), looks.seed, {
      near: looks.treeDistance.min,
      far: looks.treeDistance.max,
      height: looks.treeHeight,
    });
    this.#scene.add(this.#trees.group);
    this.#clouds = new Clouds(
      Math.max(high.clouds, looks.tiers.low.clouds),
      looks.seed,
      this.#camera,
      looks.distance,
    );
    this.#scene.add(this.#clouds.mesh);
    this.#scene.add(this.#field, this.#bowSpot);

    this.#bow = new Bow(looks.bowSize);
    this.#bowSpot.add(this.#bow.group);
    this.#arrowModels = { fletched: arrowModel(true), bare: arrowModel(false) };

    this.#preview = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.14, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, fog: false }),
      PREVIEW_DOTS,
    );
    this.#preview.count = 0;
    this.#preview.frustumCulled = false;
    this.#field.add(this.#preview);
    this.#feathers = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false }),
      MAX_FEATHERS,
    );
    this.#feathers.count = 0;
    this.#feathers.frustumCulled = false;
    this.#field.add(this.#feathers);

    this.#applyTier(this.#tier, true);
    deps.graphics.onTier(({ tier }) => {
      this.#applyTier(tier);
    });
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Archery3DDeps): Promise<Archery3DView> {
    const [hud, trees] = await Promise.all([
      WarchestHud.create(element, {
        game: deps.game,
        item: deps.game.data.archery.feathers.item,
        haptics: deps.haptics,
        logger: deps.logger,
      }),
      Promise.all(TREES.map((url) => loadModel(url))),
    ]);
    return new Archery3DView(element, deps, hud, trees);
  }

  /** Loads the models ahead of time (e.g. at the camp), so `create` doesn't wait for them. */
  static async preload(): Promise<void> {
    await Promise.all([WarchestHud.preload(), ...TREES.map((url) => loadModel(url))]);
  }

  // ScreenView

  start(): void {
    restoreContext(this.#renderer);
    this.#hud.wake();
    this.#resize();
    this.#startRound();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#round?.exit();
    this.#round = undefined;
    this.#pointer = undefined;
    this.#hud.sleep();
    this.#hud.settle();
    this.#skillBar.settle();
    this.#bonus = undefined;
    delete document.body.dataset.archery;
    releaseContext(this.#renderer, this.#deps.logger, 'archery3d');
  }

  // Rounds

  #startRound(): void {
    const { game } = this.#deps;
    const rules = this.#rules;
    this.#clearRound();
    this.#ui.card.hidden = true;
    this.#cardShown = false;
    this.#endedAt = undefined;
    const count = (item: string) => game.inventory.count(item);
    this.#quiver = bestArrow(rules, count);
    if (!this.#quiver) {
      this.#round = undefined;
      this.#bow.setArrow(undefined);
      this.#showEmpty();
      this.#updateUi();
      return;
    }
    const feel = this.#deps.feel.values;
    this.#round = new ArcheryRound(rules, feel, {
      logger: this.#deps.logger,
      level: game.level(this.#skill),
      seed: Date.now() >>> 0,
      count,
      spend: (item) => {
        game.removeItems(item, 1);
      },
      bank: (items, xp) => {
        for (const stack of items) if (stack.count > 0) game.addItems(stack.item, stack.count);
        if (xp > 0) game.addXp(this.#skill, xp);
      },
      onEvent: (event) => {
        this.#onEvent(event);
      },
    });
    // A model for every bird of the round, waiting off the side.
    for (const bird of this.#round.birds) {
      const species = bird.plan.bird;
      let kit = this.#kits.get(species.id);
      if (!kit) {
        kit = new BirdKit(species, species.radius * feel.hitRadius);
        this.#kits.set(species.id, kit);
      }
      const model = kit.make();
      model.group.visible = false;
      this.#field.add(model.group);
      this.#birds.push({ bird, model, fall: undefined, age: 0 });
    }
    this.#reloadAt = this.#clock;
    this.#perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };
    this.#ui.hint.hidden = game.hasDone('tutorial.archery');
    this.#updateUi();
  }

  /** Takes the last round's birds, arrows, feathers and droppings off the field. */
  #clearRound(): void {
    for (const visual of this.#birds) this.#field.remove(visual.model.group);
    for (const visual of this.#arrows) this.#field.remove(visual.mesh);
    for (const poop of this.#poops) this.#field.remove(poop.mesh);
    this.#birds = [];
    this.#arrows = [];
    this.#poops = [];
    this.#featherList = [];
    this.#feathers.count = 0;
    this.#preview.count = 0;
    // The feel may have changed the birds' size: build their kits again.
    for (const kit of this.#kits.values()) kit.dispose();
    this.#kits.clear();
  }

  #onEvent(event: ArcheryEvent): void {
    const feel = this.#deps.feel.values;
    const { haptics } = this.#deps;
    if (event.type === 'shot') {
      const fletched =
        this.#deps.game.data.items.find((item) => item.id === event.arrow.flight.kind.item)
          ?.look !== 'shaft';
      const mesh = new THREE.Group();
      const model = this.#arrowModels[fletched ? 'fletched' : 'bare'].clone(true);
      // Along +x, its point at the group's origin (where the rules have the arrow).
      model.rotation.y = Math.PI / 2;
      model.position.x = -0.55;
      mesh.add(model);
      mesh.scale.setScalar(this.#rules.looks.arrowLength);
      this.#field.add(mesh);
      this.#arrows.push({ arrow: event.arrow, mesh, fade: 0 });
      return;
    }
    if (event.type === 'hit') {
      const visual = this.#birds.find((entry) => entry.bird === event.bird);
      if (visual) {
        visual.fall = {
          x: event.bird.x,
          y: event.bird.y,
          vx: event.bird.vx * 0.35 + event.arrow.flight.vx * 0.08,
          vy: 3 + event.arrow.flight.vy * 0.05,
          spin: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 5),
          age: 0,
        };
      }
      this.#puffFeathers(event.bird);
      this.#frozenUntil = this.#clock + feel.hitStopMs / 1000;
      this.#shake = Math.max(this.#shake, 0.12 * feel.shakeStrength);
      haptics.pulse(feel.buzzHitMs);
      this.#sfx.play('hit', 0.8, 300);
      this.#flash('🎯 Hit! +1');
      this.#pour(event.drops, event.xp, this.#fieldToScreen(event.bird.x, event.bird.y));
      return;
    }
    if (event.type === 'scare') {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 6, 4),
        new THREE.MeshLambertMaterial({ color: 0xf3f0e6 }),
      );
      this.#field.add(mesh);
      this.#poops.push({ mesh, x: event.bird.x, y: event.bird.y - 0.4, vy: -1, age: 0 });
      haptics.pulse(feel.buzzPoopMs);
      this.#sfx.play('plop', 0.7, 1100);
      this.#pour(event.drops, 0, this.#fieldToScreen(event.bird.x, event.bird.y - 0.6));
      this.#flash('💩 Grazed it! +1');
      return;
    }
    if (event.type === 'end') {
      this.#endedAt = this.#clock;
      this.#bow.setArrow(undefined);
      // The stars' bonus seeds wait in the chest until the card's up.
      const deposits = event.bonus.map((stack) =>
        this.#hud.hold(stack.count, undefined, stack.item),
      );
      this.#bonus = { result: event, deposits };
      this.#logPerf(event);
      return;
    }
  }

  /** Pours a hit's or a scare's drops into the chest from where the bird was, with its XP. */
  #pour(drops: Stack[], xp: number, from: ScreenPoint): void {
    const deposit: XpDeposit | undefined = xp > 0 ? this.#skillBar.hold(xp) : undefined;
    const feather = this.#rules.feathers.item;
    for (const stack of drops) {
      if (stack.count <= 0) continue;
      // The XP ticks in with the feathers (every hit drops some).
      const arrive =
        stack.item === feather && deposit
          ? (share: number) => {
              deposit.arrive(share);
            }
          : undefined;
      const held = this.#hud.hold(stack.count, arrive, stack.item);
      held.pour([from]);
    }
  }

  // The loop

  #loop(time: number): void {
    this.#timer.update(time);
    const realDt = Math.min(this.#timer.getDelta(), 0.1);
    this.#clock += realDt;
    const round = this.#round;
    const frozen = this.#clock < this.#frozenUntil;
    if (round && !frozen) round.tick(realDt);
    const dt = frozen ? 0 : realDt;
    this.#drawBirds(dt);
    this.#drawArrows(dt);
    this.#drawFeathers(dt);
    this.#drawPoops(dt);
    this.#clouds.update(realDt);
    this.#drawBow();
    this.#updateUi();
    if (round?.phase === 'done' && !this.#cardShown && this.#endedAt !== undefined) {
      if (this.#clock - this.#endedAt >= CARD_DELAY && round.result) this.#showCard(round.result);
    }
    // Calm frames tell the graphics tier how this phone copes.
    if (round?.phase === 'hunt' && !frozen) this.#deps.graphics.sample(realDt * 1000);
    this.#shake = Math.max(this.#shake - realDt * 0.6, 0);
    const shake = this.#shake;
    const looks = this.#rules.looks;
    this.#camera.position.set(
      (Math.random() - 0.5) * shake,
      looks.eyeHeight + (Math.random() - 0.5) * shake,
      0,
    );
    this.#renderer.render(this.#scene, this.#camera);
    const perf = this.#perf;
    perf.frames++;
    perf.seconds += realDt;
    perf.worst = Math.max(perf.worst, realDt);
    perf.calls = Math.max(perf.calls, this.#renderer.info.render.calls);
    perf.triangles = Math.max(perf.triangles, this.#renderer.info.render.triangles);
    if (this.#clock - this.#statsAt > 1) {
      this.#statsAt = this.#clock;
      this.#element.dataset.calls = String(this.#renderer.info.render.calls);
      this.#element.dataset.triangles = String(this.#renderer.info.render.triangles);
      this.#measureTextures();
    }
  }

  #drawBirds(dt: number): void {
    const tilt = this.#rules.looks.birdTilt * DEG;
    const bottom = -this.#rules.frame.bottom - 4;
    for (const visual of this.#birds) {
      const { bird, model } = visual;
      const group = model.group;
      if (visual.fall) {
        const fall = visual.fall;
        fall.age += dt;
        fall.vy -= 18 * dt;
        fall.x += fall.vx * dt;
        fall.y += fall.vy * dt;
        group.visible = fall.age < FALL_SECONDS && fall.y > bottom;
        group.position.set(fall.x, fall.y, 0);
        group.rotation.set(
          -tilt,
          bird.plan.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
          fall.age * fall.spin,
          'ZXY',
        );
        // Limp wings.
        model.wings[0].rotation.z = 0.5;
        model.wings[1].rotation.z = -0.5;
        continue;
      }
      group.visible = bird.state === 'flying';
      if (!group.visible) continue;
      visual.age += dt;
      group.position.set(bird.x, bird.y, 0);
      // Nose up or down with its climb, belly toward us.
      const pitch = Math.atan2(bird.vy, Math.abs(bird.vx) || 1) * 0.6 * bird.plan.dir;
      group.rotation.set(-tilt, bird.plan.dir > 0 ? Math.PI / 2 : -Math.PI / 2, pitch, 'ZXY');
      flap(model, visual.age, bird.scaredAt === undefined ? 1 : 1.6);
    }
  }

  #drawArrows(dt: number): void {
    this.#arrows = this.#arrows.filter((visual) => {
      const { arrow, mesh } = visual;
      const { flight } = arrow;
      if (arrow.state === 'hit' && arrow.bird) {
        // Stuck in the bird as it falls.
        const fallen = this.#birds.find((entry) => entry.bird === arrow.bird);
        if (fallen?.fall) {
          mesh.position.set(fallen.fall.x, fallen.fall.y, 0.05);
          mesh.rotation.z += dt * fallen.fall.spin * 0.5;
          mesh.visible = fallen.model.group.visible;
        }
        if (!fallen?.model.group.visible) {
          this.#field.remove(mesh);
          return false;
        }
        return true;
      }
      mesh.position.set(flight.x, flight.y, 0.05);
      const fishtail = flight.kind.fishtail * wobbleOf(flight) * DEG;
      mesh.rotation.z = Math.atan2(flight.vy, flight.vx) + fishtail;
      if (arrow.state === 'lost') {
        visual.fade += dt;
        mesh.visible = visual.fade < FADE_SECONDS && flight.y > -this.#rules.frame.bottom;
        if (visual.fade >= FADE_SECONDS) {
          this.#field.remove(mesh);
          return false;
        }
      }
      return true;
    });
  }

  /** A puff of feathers bursting out of a hit bird, in its colours. */
  #puffFeathers(bird: LiveBird): void {
    const look = bird.plan.bird.look;
    const colors = [look.body, look.wing, look.belly].map((hex) => new THREE.Color(hex));
    for (let index = 0; index < this.#look.featherPuff; index++) {
      if (this.#featherList.length >= MAX_FEATHERS) this.#featherList.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.#featherList.push({
        x: bird.x,
        y: bird.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 1,
        spin: (Math.random() - 0.5) * 10,
        turn: Math.random() * Math.PI,
        age: 0,
        life: 1.4 + Math.random() * 1.2,
        color: colors[index % colors.length] ?? new THREE.Color(0xffffff),
      });
    }
  }

  #drawFeathers(dt: number): void {
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 0, 1);
    this.#featherList = this.#featherList.filter((feather) => feather.age < feather.life);
    this.#featherList.forEach((feather, index) => {
      feather.age += dt;
      // Air catches them: they slow quickly and drift down, rocking.
      const drag = Math.exp(-dt * 3);
      feather.vx *= drag;
      feather.vy = feather.vy * drag - 2.5 * dt;
      feather.x += (feather.vx + Math.sin(feather.age * 4 + feather.turn) * 0.6) * dt;
      feather.y += feather.vy * dt;
      feather.turn += feather.spin * dt;
      const fade = Math.min(1, (feather.life - feather.age) * 2);
      turn.setFromAxisAngle(axis, Math.sin(feather.turn) * 1.2);
      matrix.compose(
        new THREE.Vector3(feather.x, feather.y, 0.1),
        turn,
        new THREE.Vector3(fade, fade, fade),
      );
      this.#feathers.setMatrixAt(index, matrix);
      this.#feathers.setColorAt(index, feather.color);
    });
    this.#feathers.count = this.#featherList.length;
    this.#feathers.instanceMatrix.needsUpdate = true;
    if (this.#feathers.instanceColor) this.#feathers.instanceColor.needsUpdate = true;
  }

  #drawPoops(dt: number): void {
    this.#poops = this.#poops.filter((poop) => {
      poop.age += dt;
      poop.vy -= 14 * dt;
      poop.y += poop.vy * dt;
      poop.mesh.position.set(poop.x, poop.y, 0.1);
      poop.mesh.scale.set(1, 1.3, 1);
      if (poop.y < -this.#rules.frame.bottom || poop.age > 3) {
        this.#field.remove(poop.mesh);
        poop.mesh.geometry.dispose();
        return false;
      }
      return true;
    });
  }

  /** The bow, aimed and drawn as the finger has it, with the next arrow on once it's reloaded. */
  #drawBow(): void {
    const pointer = this.#pointer;
    const round = this.#round;
    const draw = pointer?.draw ?? 0;
    const angle = pointer?.angle ?? 90;
    this.#bow.group.rotation.z = (angle - 90) * DEG;
    this.#bow.setDraw(draw);
    const ready =
      round?.phase === 'hunt' && this.#quiver !== undefined && this.#clock >= this.#reloadAt;
    const quiver = this.#quiver;
    const look = quiver
      ? this.#deps.game.data.items.find((item) => item.id === quiver)?.look
      : undefined;
    const has = quiver !== undefined && this.#deps.game.inventory.count(quiver) > 0;
    this.#bow.setArrow(ready && has ? (look === 'shaft' ? 'bare' : 'fletched') : undefined);
    // The aim preview: the first part of the arrow's plain path.
    const kind = quiver && round ? round.kind(quiver) : undefined;
    const feel = this.#deps.feel.values;
    if (!pointer || !kind || !round || draw < round.feel.minDraw || !ready) {
      this.#preview.count = 0;
      return;
    }
    const points = previewPath(kind, round.feel, angle, draw, feel.previewSeconds, PREVIEW_STEP);
    const matrix = new THREE.Matrix4();
    let shown = 0;
    points.slice(1, PREVIEW_DOTS + 1).forEach((point, index) => {
      // Fading out along the preview.
      const size = 1 - (index / PREVIEW_DOTS) * 0.6;
      matrix.makeScale(size, size, 1).setPosition(point.x, point.y, 0.2);
      this.#preview.setMatrixAt(index, matrix);
      shown++;
    });
    this.#preview.count = shown;
    this.#preview.instanceMatrix.needsUpdate = true;
  }

  // Input

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      const round = this.#round;
      if (!round || round.phase !== 'hunt' || this.#pointer) return;
      if (!capturePointer(canvas, event.pointerId)) return;
      this.#pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        draw: 0,
        angle: 90,
      };
      this.#drawTicks = 0;
    });
    canvas.addEventListener('pointermove', (event) => {
      const pointer = this.#pointer;
      if (!pointer || event.pointerId !== pointer.id) return;
      const feel = this.#deps.feel.values;
      // The pull: from where the finger is back to where it started is the shot's way.
      const dx = pointer.startX - event.clientX;
      const dy = pointer.startY - event.clientY;
      const pull = Math.hypot(dx, dy);
      pointer.draw = Math.min(pull / feel.fullDrawPx, 1);
      if (pull > 6) pointer.angle = clampAim(Math.atan2(-dy, dx) / DEG, this.#rules.aim);
      const ticks = Math.floor(pointer.draw * 4);
      if (ticks > this.#drawTicks) {
        this.#deps.haptics.pulse(feel.buzzDrawMs);
        if (this.#drawTicks === 0) this.#sfx.play('creak', 0.35, 400);
      }
      this.#drawTicks = ticks;
    });
    const release = (event: PointerEvent, cancelled: boolean) => {
      const pointer = this.#pointer;
      if (!pointer || event.pointerId !== pointer.id) return;
      this.#pointer = undefined;
      const round = this.#round;
      const quiver = this.#quiver;
      if (cancelled || !round || !quiver || this.#clock < this.#reloadAt) return;
      if (round.shoot(quiver, pointer.angle, pointer.draw)) {
        const feel = this.#deps.feel.values;
        this.#deps.haptics.pulse(feel.buzzReleaseMs);
        this.#sfx.play('release', 0.6, -300);
        this.#reloadAt = this.#clock + this.#rules.looks.reloadSeconds;
        if (!this.#deps.game.hasDone('tutorial.archery'))
          this.#deps.game.markDone('tutorial.archery');
        this.#ui.hint.hidden = true;
        // Out of this kind: on to the best one left.
        if (this.#deps.game.inventory.count(quiver) === 0) {
          this.#quiver =
            bestArrow(this.#rules, (item) => this.#deps.game.inventory.count(item)) ?? quiver;
        }
      }
    };
    canvas.addEventListener('pointerup', (event) => {
      release(event, false);
    });
    canvas.addEventListener('pointercancel', (event) => {
      release(event, true);
    });
  }

  // Layout

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    const { field, frame, looks } = this.#rules;
    const aspect = width / height;
    // The field and its frame, fitted to the screen: by height on a tall phone, else by width
    // (with more sky above).
    const boxWidth = field.width + frame.side * 2;
    const boxHeight = field.height + frame.top + frame.bottom;
    const visible = Math.max(boxHeight, boxWidth / aspect);
    this.#camera.fov = (2 * Math.atan(visible / 2 / looks.distance)) / DEG;
    this.#camera.aspect = aspect;
    this.#camera.position.set(0, looks.eyeHeight, 0);
    this.#camera.rotation.set(looks.pitch * DEG, 0, 0);
    this.#camera.updateProjectionMatrix();
    this.#camera.updateMatrixWorld();
    const turn = this.#camera.quaternion;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
    // The field's bottom edge (with the frame below it) on the screen's bottom.
    this.#field.quaternion.copy(turn);
    this.#field.position
      .copy(this.#camera.position)
      .addScaledVector(forward, looks.distance)
      .addScaledVector(up, -visible / 2 + frame.bottom);
    this.#field.updateMatrixWorld();
    // The bow, between the camera and the field's origin (where arrows leave from).
    const toOrigin = this.#field.position.clone().sub(this.#camera.position).normalize();
    this.#bowSpot.quaternion.copy(turn);
    this.#bowSpot.position.copy(this.#camera.position).addScaledVector(toOrigin, looks.bowDistance);
    this.#measureTextures();
  }

  #fieldToScreen(x: number, y: number): ScreenPoint {
    const projected = this.#field.localToWorld(new THREE.Vector3(x, y, 0)).project(this.#camera);
    const { clientWidth: width, clientHeight: height } = this.#element;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
  }

  // Graphics tiers

  /** Draws at `tier` from now on: only looks (how sharp, the clouds, trees, feathers, ground). */
  #applyTier(tier: GraphicsTier, first = false): void {
    if (tier === this.#tier && !first) return;
    this.#tier = tier;
    this.#look = this.#rules.looks.tiers[tier];
    this.#element.dataset.graphics = tier;
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.#look.pixelRatio));
    this.#clouds.show(this.#look.clouds);
    this.#trees.show(this.#look.trees);
    this.#ground.material = this.#groundLooks[tier];
    this.#resize();
    if (!first) this.#deps.logger.log('archery.graphics', { tier });
  }

  /** Texture memory the scene holds (MB), for the stress-test numbers. */
  #measureTextures(): void {
    const seen = new Set<unknown>();
    const add = (texture: unknown) => {
      if (texture instanceof THREE.Texture) seen.add(texture.image);
    };
    add(this.#scene.background);
    this.#scene.traverseVisible((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const material of [child.material as THREE.Material | THREE.Material[]].flat()) {
        const maps = material as unknown as Record<string, unknown>;
        add(maps.map);
        add(maps.normalMap);
        add(maps.alphaMap);
      }
    });
    let bytes = 0;
    for (const image of seen) {
      const { width, height } = (image ?? {}) as { width?: number; height?: number };
      if (width && height) bytes += textureBytes(width, height);
    }
    this.#element.dataset.textureMb = (bytes / 1024 / 1024).toFixed(1);
  }

  #logPerf(result: ArcheryResult): void {
    const perf = this.#perf;
    this.#deps.logger.log('archery.perf', {
      tier: this.#tier,
      seconds: Math.round(result.seconds),
      fps: Math.round(perf.frames / Math.max(perf.seconds, 0.001)),
      worstMs: Math.round(perf.worst * 1000),
      drawCalls: perf.calls,
      triangles: perf.triangles,
      textureMb: Number(this.#element.dataset.textureMb ?? 0),
    });
  }

  // Overlay

  buildUi() {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };
    const button = (label: string, className: string, onTap: () => void) => {
      const element = el('button', className, label);
      element.type = 'button';
      element.addEventListener('pointerdown', () => {
        this.#sfx.unlock();
      });
      element.addEventListener('click', onTap);
      return element;
    };
    const root = el('div', 'ar-ui');
    const status = el('div', 'ar-status');
    const flash = el('div', 'ar-flash');
    flash.hidden = true;
    const hint = el('div', 'ar-hint', 'Drag back to draw the bow · let go to shoot');
    hint.hidden = true;
    // The quiver: one button per arrow kind, with how many there are.
    const quiver = el('div', 'ar-quiver');
    quiver.setAttribute('role', 'radiogroup');
    quiver.setAttribute('aria-label', 'Quiver');
    const kinds = this.#rules.arrows.map((arrow) => {
      const item = this.#deps.game.data.items.find((entry) => entry.id === arrow.item);
      const kind = button('', 'ar-kind', () => {
        if (this.#deps.game.inventory.count(arrow.item) > 0) this.#quiver = arrow.item;
        this.#updateUi();
      });
      kind.setAttribute('role', 'radio');
      kind.dataset.item = arrow.item;
      const count = el('span', 'ar-kind-count');
      const name = el('span', 'ar-kind-name', item?.name.replace(/ arrow$/i, '') ?? arrow.item);
      kind.append(count, name);
      quiver.append(kind);
      return { item: arrow.item, name: item?.name ?? arrow.item, button: kind, count };
    });
    const card = el('div', 'fm-card ar-card');
    const cardStars = el('div', 'w3d-stars fm-card-stars');
    const cardTitle = el('div', 'fm-card-title');
    const cardText = el('div', 'fm-card-text');
    const cardButtons = el('div', 'fm-card-buttons');
    const leave = button('Back to camp', 'fm-button fm-secondary', () => {
      this.#deps.onLeave();
    });
    const next = button('Hunt again', 'fm-button', () => {
      this.#hud.settle();
      this.#skillBar.settle();
      this.#startRound();
    });
    cardButtons.append(leave, next);
    card.append(cardStars, cardTitle, cardText, cardButtons);
    card.hidden = true;
    root.append(status, flash, hint, quiver, card);
    this.#element.append(root);
    return { root, status, flash, hint, quiver, kinds, card, cardStars, cardTitle, cardText, next };
  }

  #flashTimer: number | undefined;

  #flash(text: string): void {
    const flash = this.#ui.flash;
    flash.textContent = text;
    flash.hidden = false;
    flash.classList.remove('ar-flash-show');
    flash.getBoundingClientRect();
    flash.classList.add('ar-flash-show');
    window.clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => {
      flash.hidden = true;
    }, 1200);
  }

  #shownStatus = '';

  #updateUi(): void {
    const ui = this.#ui;
    const round = this.#round;
    const { game } = this.#deps;
    const phase = round ? round.phase : 'empty';
    if (document.body.dataset.archery !== phase) document.body.dataset.archery = phase;
    const hits = round?.arrows.filter((arrow) => arrow.state === 'hit').length ?? 0;
    const shots = round?.arrows.length ?? 0;
    // Points (a hit or a graze each) against par: every bird that flies by.
    const points = round?.points ?? 0;
    const par = round?.par ?? 0;
    const status = round
      ? `⏱ ${String(Math.ceil(round.left))} s · ⭐ ${String(points)} / ${String(par)}`
      : '';
    if (status !== this.#shownStatus) {
      this.#shownStatus = status;
      ui.status.textContent = status;
      ui.status.hidden = !round;
      this.#element.dataset.shots = String(shots);
      this.#element.dataset.hits = String(hits);
      this.#element.dataset.points = String(points);
      this.#element.dataset.par = String(par);
    }
    const flying = round?.birds.filter((bird) => bird.state === 'flying').length ?? 0;
    if (this.#element.dataset.birds !== String(flying))
      this.#element.dataset.birds = String(flying);
    for (const kind of ui.kinds) {
      const count = game.inventory.count(kind.item);
      const text = String(count);
      if (kind.count.textContent !== text) kind.count.textContent = text;
      const on = kind.item === this.#quiver;
      kind.button.setAttribute('aria-checked', String(on));
      kind.button.setAttribute('aria-label', `${kind.name}: ${text}`);
      kind.button.classList.toggle('ar-kind-none', count === 0);
    }
    this.#element.dataset.quiver = this.#quiver ?? '';
  }

  /** The end card: stars, birds, what they dropped, and what came of the arrows. */
  #showCard(result: ArcheryResult): void {
    this.#cardShown = true;
    const ui = this.#ui;
    const { game } = this.#deps;
    const name = (item: string) => game.data.items.find((entry) => entry.id === item)?.name ?? item;
    ui.cardStars.replaceChildren(
      ...[0, 1, 2].map((index) => {
        const star = document.createElement('span');
        star.className = `w3d-star ${index < result.stars ? 'w3d-star-on' : 'w3d-star-off'}`;
        star.textContent = '★';
        star.style.animationDelay = `${String(index * 0.18)}s`;
        return star;
      }),
    );
    for (let index = 0; index < result.stars; index++) {
      window.setTimeout(
        () => {
          this.#sfx.play('star', 0.6, index * 250);
        },
        50 + index * 180,
      );
    }
    const lines: string[] = [];
    const plural = (count: number, word: string) =>
      `${String(count)} ${word}${count === 1 ? '' : 's'}`;
    // How the points add up, and what a star more would take.
    lines.push(
      `🎯 ${plural(result.hits, 'hit')} + 💩 ${plural(result.scares, 'graze')} · par ${String(result.par)}, every bird that flew by`,
    );
    lines.push('A hit or a graze is a point: graze a bird, then hit it as it flees, for 2');
    const { one, two } = this.#rules.stars;
    const nextShare = result.stars === 0 ? one : result.stars === 1 ? two : 1;
    if (result.stars < 3) {
      const need = Math.ceil(nextShare * result.par - 1e-9) - result.points;
      if (need > 0) lines.push(`${plural(need, 'point')} more for ${'★'.repeat(result.stars + 1)}`);
    }
    if (result.seeds.length > 0) {
      lines.push(
        result.seeds.map((stack) => `${name(stack.item)} ×${String(stack.count)}`).join(' · '),
      );
    }
    if (result.feathers > 0) lines.push(`${String(result.feathers)} feathers`);
    const arrows = [`${String(result.returned)} back`];
    if (result.broken > 0) arrows.push(`${String(result.broken)} broke`);
    if (result.lost > 0) arrows.push(`${String(result.lost)} lost`);
    if (result.shots > 0) lines.push(`Arrows: ${arrows.join(', ')}`);
    const bonus = result.bonus.reduce((sum, stack) => sum + stack.count, 0);
    if (bonus > 0) lines.push(`${'★'.repeat(result.stars)} bonus +${String(bonus)} seeds`);
    const left = this.#rules.arrows.reduce(
      (sum, arrow) => sum + game.inventory.count(arrow.item),
      0,
    );
    if (left === 0) lines.push('Out of arrows: Fletching will make more soon');
    ui.cardTitle.textContent = `${String(result.points)} / ${String(result.par)} points`;
    ui.cardText.textContent = lines.join('\n');
    ui.next.hidden = left === 0;
    ui.card.hidden = false;
    // The bonus seeds pour in from the card.
    const bonusPour = this.#bonus;
    this.#bonus = undefined;
    if (bonusPour) {
      const box = ui.card.getBoundingClientRect();
      const root = this.#element.getBoundingClientRect();
      const from = { x: box.left - root.left + box.width / 2, y: box.top - root.top + 40 };
      for (const deposit of bonusPour.deposits) deposit.pour([from]);
    }
  }

  #showEmpty(): void {
    const ui = this.#ui;
    ui.cardStars.replaceChildren();
    ui.cardTitle.textContent = 'Out of arrows';
    ui.cardText.textContent =
      "The quiver's empty. Arrows will come from the Fletching bench (coming soon).";
    ui.next.hidden = true;
    ui.card.hidden = false;
    this.#cardShown = true;
  }
}
