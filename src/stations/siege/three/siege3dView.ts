import * as THREE from 'three';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import { loadModel } from '../../../app/models';
import { scatter, type Placement } from '../../../app/scatter';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import { Rng, type EventLogger, type Game, type LiveTuning } from '../../../core';
import type { SiegeFeel, SiegeFort } from '../../../data';
import { loadPhysics, type Physics } from '../logic/physics';
import {
  SiegeRound,
  type MaterialKind,
  type Pose,
  type SiegeEvent,
  type SiegeResult,
} from '../logic/round';
import {
  aimDirection,
  aimFromDrag,
  aimedVolley,
  spearsShot,
  startAim,
  volleySize,
  type Aim,
  type ThrowMode,
  type Vec3,
} from '../logic/throw';
import { buildBallista, buildGuard, greyGuard, type BallistaLook, type GuardLook } from './figures';
import { makeTextures, puffTexture, stageTint, whooshUrl } from './looks';

export interface Siege3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<SiegeFeel>;
  haptics: Haptics;
  /** Leaves the station (the card's Back to camp). */
  onLeave: () => void;
}

const DEG = Math.PI / 180;
const TREE_MODEL = 'models/kenney/tree_default.glb';
const SOUNDS: Record<string, string> = {
  'stone-1': 'audio/woodcutting/rock-1.mp3',
  'stone-2': 'audio/woodcutting/rock-2.mp3',
  'wood-1': 'audio/woodcutting/chop-1.mp3',
  'wood-2': 'audio/woodcutting/chop-2.mp3',
  'wood-3': 'audio/woodcutting/chop-3.mp3',
  'thud-1': 'audio/woodcutting/land-1.mp3',
  'thud-2': 'audio/woodcutting/land-2.mp3',
  'thud-3': 'audio/woodcutting/land-3.mp3',
  'break-wood': 'audio/woodcutting/crash-wood.mp3',
  'break-stone': 'audio/splitting/press-slam.mp3',
  release: 'audio/splitting/press-clunk.mp3',
  wind: 'audio/splitting/press-click.mp3',
  rumble: 'audio/woodcutting/crash-rumble.mp3',
  creak: 'audio/woodcutting/creak-2.mp3',
  star: 'audio/woodcutting/star.mp3',
};
/** Dots along each dotted arc, and along the last shot's trail. */
const ARC_DOTS = 10;
const TRAIL_DOTS = 90;
/** Most particles (dust, debris) alive at once, so a collapsing fort stays smooth. */
const MAX_PUFFS = 160;
const MAX_DEBRIS = 60;
/** Debris pieces a broken block bursts into, and how long they last (s). */
const DEBRIS_PIECES = 4;
const DEBRIS_SECONDS = 1.3;
/** How long the bow's arms take to snap forward when it shoots (s). */
const SNAP_SECONDS = 0.18;
/** Real seconds the position's name shows when the ballista rolls on. */
const TITLE_SECONDS = 2.4;
/**
 * The sight: how far over the pivot and behind it the camera sits at a sight blend of 1 (metres),
 * and the share of the bolt's tilt it looks along.
 */
const SIGHT_RISE = 0.7;
const SIGHT_BACK = 1.8;
const SIGHT_TILT = 0.35;
/** Dots nearer the camera than this (metres) aren't drawn: down the sights they'd fill the view. */
const NEAREST_DOT = 3;
/** Least gap between two hit-stops (s), so a volley doesn't stutter. */
const STOP_GAP = 0.25;
/** The ground the fort stands on, and the trodden earth up the middle of it. */
const FIELD = 180;
const COLORS = {
  sky: 0xa9c6dc,
  shaft: 0x9a7448,
  iron: 0x5d6266,
  leather: 0x4a3322,
  bannerTrim: 0xf0cd5c,
  weakBand: 0xd23a2a,
  stone: 0x9b978d,
  wood: 0xc39a66,
  dust: 0xcdbb9c,
  dot: 0xffffff,
  trail: 0xffe7a8,
  spot: 0xffffff,
  spotOn: 0xf0cd5c,
};

interface BlockLook {
  mesh: THREE.Mesh;
  kind: MaterialKind;
  stage: number;
  gone: boolean;
}

interface Puff {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

interface Debris {
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
}

/** A finger dragging to aim: where it went down, the aim then, the aim now, how far it's moved. */
interface Drag {
  id: number;
  x: number;
  y: number;
  last: { x: number; y: number };
  from: Aim;
  travel: number;
}

/**
 * The siege in 3D: the ballista at the bottom of the screen, the fort up the field, seen from
 * behind and above it (or, with the sight blend up, down the bolt itself). Drag anywhere to turn
 * and tilt it (the dotted arc shows the start of the flight, and the last shot's path stays as a
 * faint trail); let go and it shoots, Aimed or Barrage. Tap a spot to move it. Win a position and
 * it rolls on to the next. The rules (SiegeRound, a Rapier physics world) decide everything; this
 * draws its bodies where it says and adds the juice: hit-stop, shake, dust, debris, sounds,
 * buzzes, the camera riding a spear, and slow motion as the banner falls.
 */
export class Siege3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Siege3DDeps;
  readonly #physics: Physics;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(50, 1, 0.1, 260);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #ui: ReturnType<Siege3DView['buildUi']>;
  readonly #sun = new THREE.DirectionalLight(0xfff0d8, 2);
  readonly #fortGroup = new THREE.Group();
  readonly #spearGroup = new THREE.Group();
  readonly #effects = new THREE.Group();
  readonly #spotGroup = new THREE.Group();
  readonly #textures: ReturnType<typeof makeTextures>;
  /** Block looks, by kind and damage stage (0 whole, 1 cracked, 2 crumbling). */
  readonly #materials: Record<MaterialKind, THREE.MeshLambertMaterial[]>;
  readonly #spearParts: { shaft: THREE.BufferGeometry; tip: THREE.BufferGeometry };
  readonly #spearMaterials: { shaft: THREE.Material; tip: THREE.Material };
  readonly #ballista: BallistaLook;
  readonly #dots: THREE.InstancedMesh;
  readonly #trail: THREE.InstancedMesh;
  readonly #puffTexture: THREE.Texture;
  readonly #pose: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  #round: SiegeRound | undefined;
  #fortId: string | undefined;
  #mode: ThrowMode = 'aimed';
  #aim: Aim;
  #blocks: BlockLook[] = [];
  #guards: (GuardLook & { down: boolean })[] = [];
  #spears: THREE.Group[] = [];
  #flag: THREE.Mesh | undefined;
  #puffs: Puff[] = [];
  #debris: Debris[] = [];
  #drag: Drag | undefined;
  /** The last shot's middle spear, and the path it's flown so far. */
  #trailSpear: number | undefined;
  #trailPoints: THREE.Vector3[] = [];
  /** Real seconds since the view started, for the juice's clocks. */
  #now = 0;
  #frozenUntil = 0;
  #lastStop = -Infinity;
  #slowUntil = 0;
  #shake = 0;
  #shotAt = -Infinity;
  /** What the camera rides for a moment: a spear in flight, or the falling banner. */
  #follow: { kind: 'spear' | 'banner'; index: number; at: number; seconds: number } | undefined;
  #followBlend = 0;
  /** The roll on to the next position: its name shows, and the camera lifts as it goes. */
  #title: { text: string; at: number } | undefined;
  #rolling = 0;
  #lastBallista = { x: 0, z: 0 };
  #bankedXp: XpDeposit | undefined;
  #finished: { result: SiegeResult; at: number } | undefined;
  #unlocked: string | undefined;
  #lastPhase = '';

  private constructor(
    element: HTMLElement,
    deps: Siege3DDeps,
    physics: Physics,
    hud: WarchestHud,
    tree: THREE.Object3D,
  ) {
    this.#element = element;
    this.#deps = deps;
    this.#physics = physics;
    this.#hud = hud;
    const rules = deps.game.data.siege;
    this.#aim = startAim(rules);
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'siege');
    this.#skill = station?.skill ?? rules.ballista.skill;
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'sg-canvas';
    element.append(this.#renderer.domElement);
    this.#textures = makeTextures();
    this.#materials = {
      stone: this.#textures.stone.map(
        (map, stage) =>
          new THREE.MeshLambertMaterial({ map, color: stageTint(COLORS.stone, stage) }),
      ),
      wood: this.#textures.wood.map(
        (map, stage) =>
          new THREE.MeshLambertMaterial({ map, color: stageTint(COLORS.wood, stage) }),
      ),
    };
    const { length, radius } = rules.projectile;
    // A spear's length runs along its local y, as the rules' capsule does, point at +y.
    const tipLength = Math.min(0.22, length * 0.12);
    const shaft = new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, length - tipLength, 6);
    shaft.translate(0, -tipLength / 2, 0);
    const tip = new THREE.ConeGeometry(radius * 1.1, tipLength, 6);
    tip.translate(0, length / 2 - tipLength / 2, 0);
    this.#spearParts = { shaft, tip };
    this.#spearMaterials = {
      shaft: new THREE.MeshLambertMaterial({ color: COLORS.shaft }),
      tip: new THREE.MeshLambertMaterial({ color: COLORS.iron }),
    };
    this.#ballista = buildBallista(rules.ballista, () => this.#spearMesh());
    const dot = (color: number, opacity: number, size: number, count: number) => {
      const made = new THREE.InstancedMesh(
        new THREE.SphereGeometry(size, 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
        count,
      );
      made.count = 0;
      made.frustumCulled = false;
      return made;
    };
    this.#dots = dot(COLORS.dot, 0.9, 0.07, ARC_DOTS * 3);
    this.#trail = dot(COLORS.trail, 0.35, 0.05, TRAIL_DOTS);
    this.#puffTexture = puffTexture();
    this.#buildWorld(tree);
    this.#ui = this.buildUi();
    this.#sfx.load({ ...SOUNDS, whoosh: whooshUrl() });
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Siege3DDeps): Promise<Siege3DView> {
    const [physics, hud, tree] = await Promise.all([
      loadPhysics(),
      WarchestHud.create(element, {
        game: deps.game,
        item: deps.game.data.siege.item,
        haptics: deps.haptics,
      }),
      loadModel(TREE_MODEL),
    ]);
    return new Siege3DView(element, deps, physics, hud, tree);
  }

  /** Loads the physics engine (and starts its wasm) and the models ahead of time, at the camp. */
  static async preload(): Promise<void> {
    await Promise.all([loadPhysics(), WarchestHud.preload(), loadModel(TREE_MODEL)]);
  }

  // ScreenView

  start(): void {
    this.#resize();
    this.#startRound();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#endRound();
    this.#hud.settle();
    this.#skillBar.settle();
    this.#bankedXp = undefined;
    delete document.body.dataset.siege;
    this.#lastPhase = '';
  }

  // Rounds

  /** The forts open: the first, and each one after a fort that's been won. */
  #openForts(): SiegeFort[] {
    const { game } = this.#deps;
    const forts = game.data.siege.forts;
    return forts.filter((_, index) => {
      const before = forts[index - 1];
      return !before || game.hasDone(wonKey(before.id));
    });
  }

  #startRound(): void {
    const { game } = this.#deps;
    const rules = game.data.siege;
    this.#endRound();
    this.#ui.card.hidden = true;
    this.#finished = undefined;
    this.#unlocked = undefined;
    const open = this.#openForts();
    const fort =
      open.find((entry) => entry.id === this.#fortId) ?? open[open.length - 1] ?? rules.forts[0];
    if (!fort) return;
    this.#fortId = fort.id;
    const aimed = aimedVolley(rules, game.level(rules.ballista.skill));
    const round = new SiegeRound(
      this.#physics,
      game.data,
      fort.id,
      {
        logger: this.#deps.logger,
        feel: () => this.#deps.feel.values,
        spears: () => game.inventory.count(rules.item),
        spend: (count) => {
          game.removeItems(rules.item, count);
        },
        finish: (result) => {
          this.#pay(result);
        },
        onEvent: (event) => {
          this.#onEvent(event);
        },
      },
      { aimed, seed: Date.now() >>> 0 },
    );
    this.#round = round;
    this.#aim = startAim(rules);
    this.#buildFort(round);
    this.#showForts(open);
    this.#showSpots();
    this.#slowUntil = this.#frozenUntil = 0;
    this.#follow = undefined;
    this.#followBlend = 0;
    this.#title = undefined;
    this.#rolling = 0;
    this.#lastBallista = round.ballista();
    if (game.inventory.count(rules.item) < 1) this.#showNoSpears();
  }

  /** Throws the round away (leaving, or starting another): its spears are spent. */
  #endRound(): void {
    const round = this.#round;
    if (!round) return;
    round.quit();
    round.dispose();
    this.#round = undefined;
    for (const look of this.#blocks) look.mesh.removeFromParent();
    for (const look of this.#guards) look.root.removeFromParent();
    for (const spear of this.#spears) spear.removeFromParent();
    this.#blocks = [];
    this.#guards = [];
    this.#spears = [];
    this.#flag = undefined;
    for (const puff of this.#puffs) {
      puff.sprite.removeFromParent();
      puff.material.dispose();
    }
    for (const piece of this.#debris) {
      piece.mesh.removeFromParent();
      piece.material.dispose();
    }
    this.#puffs = [];
    this.#debris = [];
    this.#drag = undefined;
    this.#trailSpear = undefined;
    this.#trailPoints = [];
    this.#dots.count = this.#trail.count = 0;
    this.#ui.pull.hidden = true;
  }

  /** The round is over: pay its Command XP and the spears it got back. */
  #pay(result: SiegeResult): void {
    const { game } = this.#deps;
    const rules = game.data.siege;
    const before = game.xp(this.#skill);
    if (result.xp > 0) game.addXp(this.#skill, result.xp);
    this.#bankedXp = this.#skillBar.hold(game.xp(this.#skill) - before);
    if (result.recovered > 0) game.addItems(rules.item, result.recovered);
    if (result.won) {
      const index = rules.forts.findIndex((fort) => fort.id === result.fort);
      const next = rules.forts[index + 1];
      if (next && !game.hasDone(wonKey(result.fort))) this.#unlocked = next.name;
      game.markDone(wonKey(result.fort));
    }
    // The card waits a moment, so the last of the fort is seen to come down.
    this.#finished = { result, at: this.#now + (result.won ? 0.6 : 0.2) };
  }

  // World

  #buildWorld(tree: THREE.Object3D): void {
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.fog = new THREE.Fog(COLORS.sky, 60, 150);
    this.#scene.add(new THREE.HemisphereLight(0xeef4ff, 0x4a5a32, 1.35));
    const sun = this.#sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const shadow = sun.shadow.camera;
    shadow.left = -14;
    shadow.right = 14;
    shadow.top = 20;
    shadow.bottom = -20;
    shadow.near = 1;
    shadow.far = 70;
    sun.shadow.bias = -0.0005;
    this.#scene.add(sun, sun.target);
    const ground = groundMesh('meadowGrass', FIELD, FIELD);
    ground.position.z = -FIELD / 4;
    this.#scene.add(ground);
    // Trodden earth up the middle, where the ballista rolls and the fighting is.
    const trodden = wornGround('troddenDirt', 16, 64, { cover: 0.55, round: true, seed: 8 });
    trodden.position.z = -26;
    this.#scene.add(trodden);
    this.#scene.add(this.#trees(tree));
    this.#scene.add(
      this.#fortGroup,
      this.#spearGroup,
      this.#effects,
      this.#spotGroup,
      this.#ballista.root,
      this.#dots,
      this.#trail,
    );
  }

  /** Trees off to the sides and behind the fort: only looks. */
  #trees(tree: THREE.Object3D): THREE.Group {
    const rng = new Rng(11);
    const placements: Placement[] = [];
    while (placements.length < 44) {
      const x = rng.range(-42, 42);
      const z = rng.range(-95, 4);
      // Clear of the field the ballista rolls up, and of the fort either side of it.
      if (Math.abs(x) < 10 && z > -62) continue;
      placements.push({ x, z, height: rng.range(5, 9), turn: rng.range(0, Math.PI * 2) });
    }
    const trees = scatter(tree, placements);
    trees.traverse((child) => {
      child.castShadow = false;
    });
    return trees;
  }

  /** The fort's blocks and guards, sized from the rules'; the banner gets its flag. */
  #buildFort(round: SiegeRound): void {
    this.#blocks = round.blocks.map((state, index) => {
      const [width, height, depth] = state.block.size;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        this.#materials[state.kind][0],
      );
      mesh.castShadow = mesh.receiveShadow = true;
      if (state.block.weak) {
        // A red band round a weak post, so it reads as the place to hit.
        const across = Math.max(width, depth) * 0.62;
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(across, across, height * 0.18, 10),
          new THREE.MeshLambertMaterial({ color: COLORS.weakBand }),
        );
        band.position.y = height * 0.12;
        mesh.add(band);
      }
      if (index === round.bannerIndex) {
        mesh.material = new THREE.MeshLambertMaterial({ color: COLORS.leather });
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.1, 0.7, 10, 4),
          new THREE.MeshLambertMaterial({ map: this.#textures.banner, side: THREE.DoubleSide }),
        );
        // Flying from the top of the pole, out to the right.
        flag.geometry.translate(0.55, 0, 0);
        flag.position.set(width / 2, height / 2 - 0.4, 0);
        flag.castShadow = true;
        mesh.add(flag);
        this.#flag = flag;
        const knob = new THREE.Mesh(
          new THREE.SphereGeometry(width * 0.9, 8, 6),
          new THREE.MeshLambertMaterial({ color: COLORS.bannerTrim }),
        );
        knob.position.y = height / 2;
        mesh.add(knob);
      }
      this.#fortGroup.add(mesh);
      return { mesh, kind: state.kind, stage: 0, gone: false };
    });
    const size = this.#deps.game.data.siege.guard.size;
    this.#guards = round.guards.map(() => {
      const look = buildGuard(size);
      this.#fortGroup.add(look.root);
      return { ...look, down: false };
    });
    this.#drawBodies();
  }

  /** Rings on the ground at the position's spots, the ballista's own lit. */
  #showSpots(): void {
    const round = this.#round;
    for (const child of [...this.#spotGroup.children]) child.removeFromParent();
    if (!round) return;
    const spots = round.currentPosition.spots;
    spots.forEach(([x, z], index) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.75, 28),
        new THREE.MeshBasicMaterial({
          color: index === round.spot ? COLORS.spotOn : COLORS.spot,
          transparent: true,
          opacity: index === round.spot ? 0.85 : 0.45,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.03, z);
      this.#spotGroup.add(ring);
    });
    const ui = this.#ui;
    ui.spotButtons.replaceChildren(
      ...spots.map((_, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sg-spot';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(index === round.spot));
        button.setAttribute('aria-label', `Spot ${String(index + 1)}`);
        button.textContent = String(index + 1);
        button.addEventListener('pointerdown', () => {
          this.#sfx.unlock();
        });
        button.addEventListener('click', () => {
          if (this.#round?.moveTo(index)) this.#showSpots();
        });
        return button;
      }),
    );
  }

  #spearMesh(): THREE.Group {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(this.#spearParts.shaft, this.#spearMaterials.shaft);
    const tip = new THREE.Mesh(this.#spearParts.tip, this.#spearMaterials.tip);
    shaft.castShadow = tip.castShadow = true;
    group.add(shaft, tip);
    return group;
  }

  // Events

  #onEvent(event: SiegeEvent): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    if (!round) return;
    switch (event.type) {
      case 'throw': {
        this.#deps.haptics.pulse(event.mode === 'barrage' ? feel.buzzBarrageMs : feel.buzzThrowMs);
        this.#play('release', 0.5, event.mode === 'barrage' ? -300 : 0);
        this.#follow = undefined;
        this.#shotAt = this.#now;
        // The trail follows this shot's middle spear (of its first volley) as it flies.
        const first = this.#spears.length;
        this.#trailSpear = first + Math.floor((Math.min(event.spears, round.aimed) - 1) / 2);
        this.#trailPoints = [];
        this.#trail.count = 0;
        break;
      }
      case 'launch': {
        const spear = this.#spearMesh();
        this.#spearGroup.add(spear);
        this.#spears[event.spear] = spear;
        this.#play('whoosh', 0.16, (Math.random() - 0.5) * 300);
        this.#follow ??= {
          kind: 'spear',
          index: this.#trailSpear ?? event.spear,
          at: this.#now,
          seconds: feel.followSeconds,
        };
        break;
      }
      case 'hit': {
        const heavy = event.speed >= feel.heavyHitSpeed;
        const kind = event.kind;
        if (kind === 'guard') this.#play('thud-1', 0.35, 500);
        else {
          this.#play(
            kind === 'stone'
              ? `stone-${String(1 + Math.floor(Math.random() * 2))}`
              : `wood-${String(1 + Math.floor(Math.random() * 3))}`,
            Math.min(0.25 + event.speed / 30, 0.8),
            kind === 'stone' ? 200 : 0,
          );
        }
        this.#stop(heavy ? feel.heavyHitStopMs : feel.hitStopMs);
        this.#deps.haptics.pulse(feel.buzzHitMs);
        if (heavy) this.#shake = Math.max(this.#shake, 0.05 * feel.shakeStrength);
        this.#dust(event.at, Math.ceil(feel.dust * 0.4), 0.5);
        break;
      }
      case 'land':
        this.#dust(event.at, Math.ceil(feel.dust * 0.3), 0.35);
        break;
      case 'thud': {
        const strength = Math.min(event.speed / feel.thudSpeed, 3);
        const block = round.blocks[event.block];
        const at = { ...event.at, y: event.at.y - (block?.block.size[1] ?? 0) / 2 };
        this.#dust(at, Math.round(feel.dust * strength * 0.6), 0.6 + strength * 0.2);
        this.#play(
          `thud-${String(1 + Math.floor(Math.random() * 3))}`,
          Math.min(0.1 + strength * 0.12, 0.5),
          event.kind === 'stone' ? -500 : 0,
        );
        if (strength >= 2) {
          this.#shake = Math.max(this.#shake, 0.025 * strength * feel.shakeStrength);
          this.#deps.haptics.pulse(feel.buzzThudMs);
        }
        break;
      }
      case 'break':
        this.#breakBlock(event.block, event.kind, event.at);
        break;
      case 'guardDown': {
        const look = this.#guards[event.guard];
        if (look && !look.down) {
          look.down = true;
          greyGuard(look);
        }
        this.#play('thud-2', 0.45, -200);
        this.#deps.haptics.pulse(feel.buzzGuardMs);
        this.#dust(event.at, Math.ceil(feel.dust * 0.6), 0.6);
        break;
      }
      case 'spot':
        this.#play('wind', 0.35, -400);
        break;
      case 'positionWon': {
        this.#play('star', 0.45, -300);
        this.#deps.haptics.pulse(feel.buzzGuardMs);
        // The next position's name, big, as the ballista rolls on to it.
        const count = round.fort.positions.length;
        const next = round.fort.positions[event.position + 1];
        if (next) {
          this.#title = {
            text: `${next.name}\nPosition ${String(event.position + 2)} of ${String(count)}`,
            at: this.#now + feel.advanceDelaySeconds,
          };
        }
        break;
      }
      case 'arrived':
        this.#showSpots();
        this.#play('thud-3', 0.4, -700);
        break;
      case 'bannerFalling':
        this.#slowUntil = this.#now + feel.slowMoSeconds;
        // The camera leans in on the banner as it goes.
        this.#follow = {
          kind: 'banner',
          index: round.bannerIndex,
          at: this.#now,
          seconds: feel.slowMoSeconds,
        };
        this.#deps.haptics.rumble(feel.buzzBannerMs, 3);
        this.#play('creak', 0.6, -200);
        break;
      case 'won':
        this.#play('rumble', 0.5);
        break;
      default:
        break;
    }
  }

  /** A block bursts: a few chunks fly off and fade, in a cloud of dust. */
  #breakBlock(index: number, kind: MaterialKind, at: Vec3): void {
    const feel = this.#deps.feel.values;
    const look = this.#blocks[index];
    const state = this.#round?.blocks[index];
    if (!look || !state) return;
    look.gone = true;
    look.mesh.visible = false;
    this.#play(kind === 'stone' ? 'break-stone' : 'break-wood', 0.55, kind === 'stone' ? -900 : 0);
    this.#stop(feel.heavyHitStopMs);
    this.#deps.haptics.pulse(feel.buzzBreakMs);
    this.#shake = Math.max(this.#shake, 0.06 * feel.shakeStrength);
    const [width, height, depth] = state.block.size;
    this.#dust(at, Math.round(feel.dust * 1.6), Math.max(width, height) * 0.8);
    const base = this.#materials[kind][2] ?? this.#materials[kind][0];
    if (!base) return;
    for (let piece = 0; piece < DEBRIS_PIECES && this.#debris.length < MAX_DEBRIS; piece++) {
      const material = base.clone();
      material.transparent = true;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(
          width * (0.25 + Math.random() * 0.2),
          height * (0.3 + Math.random() * 0.2),
          depth * (0.3 + Math.random() * 0.2),
        ),
        material,
      );
      mesh.position.set(
        at.x + (Math.random() - 0.5) * width * 0.6,
        at.y + (Math.random() - 0.5) * height * 0.6,
        at.z + (Math.random() - 0.5) * depth * 0.6,
      );
      mesh.castShadow = true;
      this.#effects.add(mesh);
      this.#debris.push({
        mesh,
        material,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          1.5 + Math.random() * 3,
          (Math.random() - 0.5) * 4,
        ),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        age: 0,
      });
    }
  }

  /** A hit-stop of `ms`, unless one has only just ended (a volley would stutter). */
  #stop(ms: number): void {
    if (ms <= 0 || this.#now - this.#lastStop < STOP_GAP) return;
    this.#lastStop = this.#now;
    this.#frozenUntil = Math.max(this.#frozenUntil, this.#now + ms / 1000);
  }

  #dust(at: Vec3, count: number, size: number): void {
    for (let index = 0; index < count && this.#puffs.length < MAX_PUFFS; index++) {
      const material = new THREE.SpriteMaterial({
        map: this.#puffTexture,
        color: COLORS.dust,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(
        at.x + (Math.random() - 0.5) * size,
        Math.max(at.y, 0.1) + Math.random() * size * 0.3,
        at.z + (Math.random() - 0.5) * size,
      );
      this.#effects.add(sprite);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1.4;
      this.#puffs.push({
        sprite,
        material,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          0.4 + Math.random() * 0.8,
          Math.sin(angle) * speed,
        ),
        age: 0,
        life: 0.9 + Math.random() * 0.8,
        size: size * (0.6 + Math.random() * 0.6),
      });
    }
  }

  // Loop

  #loop(time: number): void {
    this.#timer.update(time);
    const realDt = Math.min(this.#timer.getDelta(), 0.05);
    this.#now += realDt;
    const feel = this.#deps.feel.values;
    const frozen = this.#now < this.#frozenUntil;
    // Slow motion as the banner falls, easing back to full speed over its last third.
    const slowLeft = this.#slowUntil - this.#now;
    const slowShare = feel.slowMoSeconds > 0 ? slowLeft / feel.slowMoSeconds : 0;
    const scale =
      slowLeft > 0 ? feel.slowMo + (1 - feel.slowMo) * Math.max(0, 1 - slowShare * 3) : 1;
    const dt = frozen ? 0 : realDt * scale;
    const round = this.#round;
    round?.advance(dt);
    const finished = this.#finished;
    if (finished && this.#now >= finished.at) {
      this.#finished = undefined;
      this.#showCard(finished.result);
    }
    this.#drawBodies();
    this.#drawBallista(realDt);
    this.#drawArcs();
    this.#updateEffects(dt);
    this.#updateFlag(time / 1000);
    this.#updateUi();
    this.#updateCamera(realDt);
    this.#sun.position.set(this.#lastBallista.x - 8, 16, this.#lastBallista.z + 4);
    this.#sun.target.position.set(this.#lastBallista.x, 0, this.#lastBallista.z - 12);
    this.#renderer.render(this.#scene, this.#camera);
  }

  /** Every block, guard and spear where the rules have it, and blocks' damage showing. */
  #drawBodies(): void {
    const round = this.#round;
    if (!round) return;
    const pose = this.#pose;
    const place = (object: THREE.Object3D) => {
      object.position.set(pose.position.x, pose.position.y, pose.position.z);
      object.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    };
    this.#blocks.forEach((look, index) => {
      if (look.gone) return;
      round.blockPose(index, pose);
      place(look.mesh);
      const state = round.blocks[index];
      if (!state || index === round.bannerIndex) return;
      const share = state.hp / state.maxHp;
      const stage = share > 0.66 ? 0 : share > 0.33 ? 1 : 2;
      if (stage !== look.stage) {
        look.stage = stage;
        const material = this.#materials[look.kind][stage];
        if (material) look.mesh.material = material;
        // Crumbling: a touch smaller, as if chips have come off.
        look.mesh.scale.setScalar(stage === 2 ? 0.94 : 1);
      }
    });
    this.#guards.forEach((look, index) => {
      round.guardPose(index, pose);
      place(look.root);
    });
    this.#spears.forEach((spear, index) => {
      round.spearPose(index, pose);
      place(spear);
    });
    // The last shot's middle spear leaves its trail while it flies.
    const trailed = this.#trailSpear;
    if (trailed !== undefined && round.spears[trailed]?.flying) {
      round.spearPose(trailed, pose);
      const point = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
      const last = this.#trailPoints.at(-1);
      if (!last || last.distanceTo(point) > 0.35) {
        this.#trailPoints.push(point);
        if (this.#trailPoints.length > TRAIL_DOTS) this.#trailPoints.shift();
        const matrix = new THREE.Matrix4();
        this.#trailPoints.forEach((at, dot) => {
          this.#trail.setMatrixAt(dot, matrix.makeTranslation(at.x, at.y, at.z));
        });
        this.#trail.count = this.#trailPoints.length;
        this.#trail.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** The ballista where the rules have it, turned and tilted to the aim, its bow drawn or loosed. */
  #drawBallista(dt: number): void {
    const round = this.#round;
    if (!round) return;
    const at = round.ballista();
    const look = this.#ballista;
    const moved = Math.hypot(at.x - this.#lastBallista.x, at.z - this.#lastBallista.z);
    look.root.position.set(at.x, 0, at.z);
    // The wheels turn as it rolls.
    for (const wheel of look.wheels) wheel.rotation.x -= moved / look.wheelRadius;
    this.#lastBallista = at;
    const rolling = round.phase === 'advance' ? 1 : 0;
    this.#rolling += (rolling - this.#rolling) * Math.min(1, dt * 2);
    const aim = this.#aim;
    look.turn.rotation.y += (-aim.yaw - look.turn.rotation.y) * Math.min(1, dt * 18);
    look.tilt.rotation.x += (aim.tilt - look.tilt.rotation.x) * Math.min(1, dt * 18);
    // Loaded: the bolt in the groove, the arms swept back. Just shot: they snap forward.
    const since = this.#now - this.#shotAt;
    look.bolt.visible = round.canThrow || (!round.reloading && since > SNAP_SECONDS);
    const sweep = since < SNAP_SECONDS ? 0.35 * (1 - since / SNAP_SECONDS) - 0.15 : 0.35;
    look.arms.forEach((arm, index) => {
      arm.rotation.y = (index === 0 ? -1 : 1) * sweep;
    });
  }

  /** The dotted arc for the aim now (when it can shoot): the first part of the flight only. */
  #drawArcs(): void {
    const round = this.#round;
    if (!round || !round.canThrow || !this.#ui.card.hidden) {
      this.#dots.count = 0;
      return;
    }
    const arcs = round.preview(this.#mode, this.#aim, ARC_DOTS);
    const matrix = new THREE.Matrix4();
    let count = 0;
    for (const arc of arcs) {
      arc.forEach((dot, index) => {
        if (count >= this.#dots.instanceMatrix.count) return;
        const near = this.#camera.position;
        if (Math.hypot(dot.x - near.x, dot.y - near.y, dot.z - near.z) < NEAREST_DOT) return;
        // Dots shrink toward the end of what's shown: the rest is up to you.
        const size = 1 - (index / ARC_DOTS) * 0.6;
        matrix.makeScale(size, size, size).setPosition(dot.x, dot.y, dot.z);
        this.#dots.setMatrixAt(count++, matrix);
      });
    }
    this.#dots.count = count;
    this.#dots.instanceMatrix.needsUpdate = true;
  }

  #updateEffects(dt: number): void {
    const gravity = this.#deps.game.data.siege.physics.gravity;
    this.#puffs = this.#puffs.filter((puff) => {
      puff.age += dt;
      if (puff.age >= puff.life) {
        puff.sprite.removeFromParent();
        puff.material.dispose();
        return false;
      }
      const share = puff.age / puff.life;
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      puff.velocity.multiplyScalar(Math.exp(-2.2 * dt));
      puff.sprite.scale.setScalar(puff.size * (0.6 + share * 1.4));
      puff.material.opacity = 0.7 * (1 - share) ** 1.5;
      return true;
    });
    this.#debris = this.#debris.filter((piece) => {
      piece.age += dt;
      if (piece.age >= DEBRIS_SECONDS) {
        piece.mesh.removeFromParent();
        piece.mesh.geometry.dispose();
        piece.material.dispose();
        return false;
      }
      piece.velocity.y -= gravity * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      // Debris only bounces off the ground: it never touches the fort, and the rules never see it.
      const floor = 0.08;
      if (piece.mesh.position.y < floor) {
        piece.mesh.position.y = floor;
        piece.velocity.y = Math.abs(piece.velocity.y) * 0.3;
        piece.velocity.x *= 0.6;
        piece.velocity.z *= 0.6;
        piece.spin.multiplyScalar(0.5);
      }
      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;
      piece.material.opacity = Math.min(1, (DEBRIS_SECONDS - piece.age) / 0.5);
      return true;
    });
  }

  /** The flag ripples in the wind. */
  #updateFlag(seconds: number): void {
    const flag = this.#flag;
    if (!flag) return;
    const position = flag.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index);
      const y = position.getY(index);
      position.setZ(index, Math.sin(x * 4 - seconds * 5 + y) * 0.07 * x);
    }
    position.needsUpdate = true;
  }

  // Camera

  /**
   * Behind and above the ballista, looking up the field (sight blend 0), or at its sight looking
   * down the bolt (1), anywhere between. It lifts a little as the ballista rolls on, and rides a
   * spear (or the falling banner) for a moment.
   */
  #updateCamera(dt: number): void {
    const feel = this.#deps.feel.values;
    const rules = this.#deps.game.data.siege;
    const at = this.#lastBallista;
    const lift = 1 + this.#rolling * 0.25;
    // Behind it, turned part of the way with its aim.
    const turn = this.#aim.yaw * feel.cameraTurn;
    const back = feel.cameraBack * lift;
    const behind = new THREE.Vector3(
      at.x - Math.sin(turn) * back,
      feel.cameraHeight * lift,
      at.z + Math.cos(turn) * back,
    );
    const behindLook = new THREE.Vector3(
      at.x + Math.sin(turn) * feel.cameraLookAhead,
      feel.cameraLookHeight,
      at.z - Math.cos(turn) * feel.cameraLookAhead,
    );
    const way = aimDirection(this.#aim);
    const pivot = new THREE.Vector3(at.x, rules.ballista.pivotHeight, at.z);
    const forward = new THREE.Vector3(way.x, way.y, way.z);
    // Over the back of the stock, sighting along the bolt; it looks a little under the bolt's
    // tilt, so a lob still shows what it's aimed at rather than the sky.
    const sight = pivot
      .clone()
      .add(new THREE.Vector3(0, SIGHT_RISE, 0))
      .addScaledVector(forward, -SIGHT_BACK);
    const level = aimDirection({ yaw: this.#aim.yaw, tilt: this.#aim.tilt * SIGHT_TILT });
    const sightLook = pivot
      .clone()
      .addScaledVector(new THREE.Vector3(level.x, level.y, level.z), 30);
    const blend = feel.sightBlend;
    const home = behind.lerp(sight, blend);
    const look = behindLook.lerp(sightLook, blend);
    // Riding a spear (or the falling banner): toward it for a while, then easing back.
    const follow = this.#follow;
    const round = this.#round;
    let want = 0;
    if (follow && round && this.#now - follow.at < follow.seconds) want = feel.follow;
    const rate = want > this.#followBlend ? 4 : 1 / Math.max(feel.followReturnSeconds, 0.05);
    this.#followBlend += (want - this.#followBlend) * Math.min(1, dt * rate * 2);
    const tracked =
      follow?.kind === 'spear' ? this.#spears[follow.index] : this.#blocks[follow?.index ?? -1];
    if (follow && round && tracked) {
      if (follow.kind === 'spear') round.spearPose(follow.index, this.#pose);
      else round.blockPose(follow.index, this.#pose);
      const { x, y, z } = this.#pose.position;
      look.lerp(new THREE.Vector3(x, y, z), this.#followBlend);
      // A push in along the field after it, at the same height, so the ballista stays in view.
      home.x += (x - home.x) * this.#followBlend * 0.3;
      home.z += (z - home.z) * this.#followBlend * 0.3;
    }
    this.#shake *= Math.exp(-9 * dt);
    this.#camera.position.copy(home);
    if (this.#shake > 0.001) {
      this.#camera.position.add(
        new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(
          this.#shake * 4,
        ),
      );
    }
    this.#camera.lookAt(look);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  #play(name: string, volume: number, detune = 0): void {
    this.#sfx.play(name, volume, detune + (Math.random() - 0.5) * 120);
  }

  // Input

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      if (this.#drag || !this.#round || this.#round.phase !== 'aim') return;
      canvas.setPointerCapture(event.pointerId);
      this.#drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        last: { x: event.clientX, y: event.clientY },
        from: this.#aim,
        travel: 0,
      };
    });
    canvas.addEventListener('pointermove', (event) => {
      const drag = this.#drag;
      if (!drag || drag.id !== event.pointerId) return;
      drag.travel += Math.hypot(event.clientX - drag.last.x, event.clientY - drag.last.y);
      drag.last = { x: event.clientX, y: event.clientY };
      const rules = this.#deps.game.data.siege;
      this.#aim = aimFromDrag(
        drag.from,
        event.clientX - drag.x,
        event.clientY - drag.y,
        this.#deps.feel.values,
        rules,
      );
      this.#showPull(drag, event.clientX, event.clientY);
    });
    const end = (event: PointerEvent, cancelled: boolean) => {
      const drag = this.#drag;
      if (!drag || drag.id !== event.pointerId) return;
      this.#drag = undefined;
      this.#ui.pull.hidden = true;
      const moved = drag.travel >= this.#deps.feel.values.deadPx;
      if (!cancelled && moved && this.#round?.throw(this.#mode, this.#aim)) {
        this.#ui.picker.hidden = true;
      }
    };
    canvas.addEventListener('pointerup', (event) => {
      end(event, false);
    });
    canvas.addEventListener('pointercancel', (event) => {
      end(event, true);
    });
  }

  /** The drag: a line from where the finger went down, and the aim it makes. */
  #showPull(drag: Drag, x: number, y: number): void {
    const ui = this.#ui;
    const rect = this.#element.getBoundingClientRect();
    ui.pull.hidden = false;
    ui.pullLine.setAttribute('x1', String(drag.x - rect.left));
    ui.pullLine.setAttribute('y1', String(drag.y - rect.top));
    ui.pullLine.setAttribute('x2', String(x - rect.left));
    ui.pullLine.setAttribute('y2', String(y - rect.top));
    ui.pullStart.setAttribute('cx', String(drag.x - rect.left));
    ui.pullStart.setAttribute('cy', String(drag.y - rect.top));
    ui.pull.dataset.ready = String(this.#round?.canThrow === true);
    const turn = Math.round(this.#aim.yaw / DEG);
    ui.pullPower.textContent = `↑${String(Math.round(this.#aim.tilt / DEG))}° ${turn === 0 ? '' : `${turn > 0 ? '→' : '←'}${String(Math.abs(turn))}°`}`;
    ui.pullPower.setAttribute('x', String(x - rect.left));
    ui.pullPower.setAttribute('y', String(y - rect.top + 44));
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
    const root = el('div', 'sg-ui');
    // The forts open, before the first shot.
    const picker = el('div', 'sg-forts');
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', 'Fort');
    const status = el('div', 'sg-status');
    const goal = el('div', 'sg-goal');
    const title = el('div', 'sg-title');
    title.hidden = true;
    const hint = el('div', 'sg-hint');
    // Where the ballista stands at this position, and how it shoots.
    const controls = el('div', 'sg-controls');
    const spots = el('div', 'sg-spots');
    spots.setAttribute('role', 'radiogroup');
    spots.setAttribute('aria-label', 'Spot');
    const spotLabel = el('span', 'sg-spots-label', 'Move');
    const spotButtons = el('div', 'sg-spot-buttons');
    spots.append(spotLabel, spotButtons);
    const modes = el('div', 'sg-modes');
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', 'Shot');
    const modeButtons = (['aimed', 'barrage'] as const).map((mode) => {
      const element = button('', 'sg-mode', () => {
        this.#mode = mode;
      });
      element.setAttribute('role', 'radio');
      element.dataset.mode = mode;
      const name = el('span', 'sg-mode-name', mode === 'aimed' ? 'Aimed' : 'Barrage');
      const cost = el('span', 'sg-mode-cost');
      element.append(name, cost);
      modes.append(element);
      return { mode, element, cost };
    });
    controls.append(spots, modes);
    // The drag, drawn over the scene (in a div: only HTML elements can be hidden).
    const svg = 'http://www.w3.org/2000/svg';
    const pull = el('div', 'sg-pull');
    pull.setAttribute('aria-hidden', 'true');
    const drawing = document.createElementNS(svg, 'svg');
    const pullLine = document.createElementNS(svg, 'line');
    const pullStart = document.createElementNS(svg, 'circle');
    pullStart.setAttribute('r', '14');
    const pullPower = document.createElementNS(svg, 'text');
    pullPower.setAttribute('text-anchor', 'middle');
    drawing.append(pullLine, pullStart, pullPower);
    pull.append(drawing);
    pull.hidden = true;
    const card = el('div', 'sg-card');
    const cardStars = el('div', 'w3d-stars sg-card-stars');
    const cardTitle = el('div', 'sg-card-title');
    const cardText = el('div', 'sg-card-text');
    const cardButtons = el('div', 'sg-card-buttons');
    const leave = button('Back to camp', 'sg-button sg-secondary', () => {
      this.#deps.onLeave();
    });
    const again = button('Again', 'sg-button', () => {
      this.#hud.settle();
      this.#skillBar.settle();
      this.#startRound();
    });
    cardButtons.append(leave, again);
    card.append(cardStars, cardTitle, cardText, cardButtons);
    card.hidden = true;
    root.append(picker, status, goal, title, pull, hint, controls, card);
    this.#element.append(root);
    return {
      root,
      picker,
      status,
      goal,
      title,
      hint,
      controls,
      spotButtons,
      modeButtons,
      pull,
      pullLine,
      pullStart,
      pullPower,
      card,
      cardStars,
      cardTitle,
      cardText,
      again,
    };
  }

  /** The fort picker: each fort open, and the next one locked until the last is won. */
  #showForts(open: SiegeFort[]): void {
    const ui = this.#ui;
    const forts = this.#deps.game.data.siege.forts;
    ui.picker.replaceChildren(
      ...forts.map((fort) => {
        const isOpen = open.includes(fort);
        const element = document.createElement('button');
        element.type = 'button';
        element.className = isOpen ? 'sg-fort' : 'sg-fort sg-fort-locked';
        element.setAttribute('role', 'radio');
        element.setAttribute('aria-checked', String(fort.id === this.#fortId));
        element.disabled = !isOpen;
        element.textContent = isOpen ? `${fort.name} · par ${String(fort.par)}` : `🔒 ${fort.name}`;
        element.addEventListener('click', () => {
          if (fort.id === this.#fortId || this.#round?.used) return;
          this.#fortId = fort.id;
          this.#startRound();
        });
        return element;
      }),
    );
    ui.picker.hidden = forts.length < 2;
  }

  #updateUi(): void {
    const ui = this.#ui;
    const round = this.#round;
    const phase = round?.phase ?? 'none';
    if (phase !== this.#lastPhase) {
      this.#lastPhase = phase;
      // Lets the e2e test follow along.
      document.body.dataset.siege = phase;
    }
    const rules = this.#deps.game.data.siege;
    const left = this.#deps.game.inventory.count(rules.item);
    this.#element.dataset.thrown = String(round?.used ?? 0);
    this.#element.dataset.position = String(round?.position ?? 0);
    this.#element.dataset.spot = String(round?.spot ?? 0);
    this.#element.dataset.guardsLeft = String(round?.guardsLeft ?? 0);
    if (!round) return;
    const title = this.#title;
    const showing =
      title !== undefined && this.#now >= title.at && this.#now - title.at < TITLE_SECONDS;
    ui.title.hidden = !showing;
    if (title) ui.title.textContent = title.text;
    const aiming = phase === 'aim' && ui.card.hidden;
    ui.controls.hidden = !aiming;
    for (const { mode, element, cost } of ui.modeButtons) {
      element.setAttribute('aria-checked', String(mode === this.#mode));
      const spears = spearsShot(mode, round.aimed, left, rules);
      cost.textContent = `${String(spears)} spear${spears === 1 ? '' : 's'}`;
      // A short volley: fewer spears left than the shot takes.
      element.dataset.short = String(spears < volleySize(mode, round.aimed, rules));
    }
    ui.status.hidden = !ui.card.hidden;
    ui.status.textContent = `Throws ${String(round.throws)} / par ${String(round.fort.par)} · ${String(round.used)} spears`;
    const position = round.currentPosition;
    const goals: Record<string, string> = {
      guards_down: `${position.name}: bring down the guards (${String(round.guardsLeft)} left)`,
      banner_down: `${position.name}: bring down the banner`,
    };
    ui.goal.hidden = !ui.card.hidden || showing;
    ui.goal.textContent =
      phase === 'advance'
        ? `${position.name} taken!`
        : phase === 'won'
          ? 'The banner is down!'
          : (goals[position.objective.kind] ?? '');
    ui.hint.textContent =
      phase === 'aim' && left < 1 && !round.reloading
        ? 'Out of spears…'
        : phase === 'aim' && round.throws === 0
          ? 'Drag to aim, let go to shoot · tap a number to move'
          : '';
    ui.hint.hidden = !ui.card.hidden;
  }

  /** The end card: won or lost, throws against par, stars, XP and the spears back. */
  #showCard(result: SiegeResult): void {
    const ui = this.#ui;
    ui.cardStars.replaceChildren(
      ...(result.won ? [0, 1, 2] : []).map((index) => {
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
    const fort = this.#round?.fort;
    ui.cardTitle.textContent = result.won
      ? `${fort?.name ?? 'The fort'} has fallen!`
      : 'The fort holds';
    const perPosition =
      result.throwsPerPosition.length > 1 ? ` (${result.throwsPerPosition.join(' · ')})` : '';
    const lines = [
      `Throws: ${String(result.throws)} / par ${String(result.par)}${perPosition}`,
      `Spears shot: ${String(result.used)}`,
      `Guards down: ${String(result.guardsDown)} · blocks down: ${String(result.blocksDown)}`,
      `+${String(result.xp)} Command XP${result.starXp > 0 ? ` (★ bonus +${String(result.starXp)})` : ''}`,
    ];
    if (result.won) {
      lines.push(
        `${String(result.recovered)} spear${result.recovered === 1 ? '' : 's'} recovered${result.starSpears > 0 ? ` (★ bonus +${String(result.starSpears)})` : ''}`,
      );
    } else {
      lines.push('Out of spears: none recovered');
    }
    if (this.#unlocked) lines.push(`🔓 ${this.#unlocked} is open`);
    ui.cardText.textContent = lines.join('\n');
    ui.again.hidden = false;
    ui.card.hidden = false;
    ui.picker.hidden = true;
    // The XP ticks in now; the spears back pour into the chest from where they lie.
    const xp = this.#bankedXp;
    this.#bankedXp = undefined;
    if (result.recovered > 0) {
      const deposit = this.#hud.hold(result.recovered, (share) => xp?.arrive(share));
      deposit.pour(this.#spearPoints());
    } else {
      xp?.arrive(1);
    }
  }

  /** Where the shot spears lie on screen, for the recovered ones to pour from. */
  #spearPoints(): ScreenPoint[] {
    const { clientWidth: width, clientHeight: height } = this.#element;
    return this.#spears
      .map((spear) => spear.getWorldPosition(new THREE.Vector3()).project(this.#camera))
      .filter((point) => Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z < 1)
      .map((point) => ({ x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height }));
  }

  #showNoSpears(): void {
    const ui = this.#ui;
    ui.cardStars.replaceChildren();
    ui.cardTitle.textContent = 'No spears';
    ui.cardText.textContent =
      'The warchest has no spears to shoot. Harden staves into spears at the fire pit.';
    ui.again.hidden = true;
    ui.card.hidden = false;
    ui.picker.hidden = true;
  }
}

function wonKey(fortId: string): string {
  return `siege.won.${fortId}`;
}
