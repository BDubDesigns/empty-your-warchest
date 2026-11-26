import * as THREE from 'three';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import { loadModel } from '../../../app/models';
import { scatter, type Placement } from '../../../app/scatter';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import { drawSplitGrain } from '../../../app/woodGrain';
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
  aimFromDrag,
  spearsEach,
  spearsThrown,
  throwerCount,
  throwerSpots,
  type Aim,
  type ThrowMode,
  type Vec3,
} from '../logic/throw';

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
  rumble: 'audio/woodcutting/crash-rumble.mp3',
  creak: 'audio/woodcutting/creak-2.mp3',
  star: 'audio/woodcutting/star.mp3',
};
/** Dots along each dotted arc. */
const ARC_DOTS = 9;
/** Most particles (dust, debris) alive at once, so a collapsing fort stays smooth. */
const MAX_PUFFS = 160;
const MAX_DEBRIS = 60;
/** Debris pieces a broken block bursts into, and how long they last (s). */
const DEBRIS_PIECES = 4;
const DEBRIS_SECONDS = 1.3;
/** A thrower's arm: how far back (radians) a full pull winds it, and the throw's snap (s). */
const WIND_UP = 1.1;
const SNAP_SECONDS = 0.25;
/** The ground the fort and the line stand on, and the trodden earth between them. */
const FIELD = 140;
const COLORS = {
  sky: 0xa9c6dc,
  tunic: 0x7d2a22,
  tunicTrim: 0xd8b25a,
  skin: 0xd6a77c,
  iron: 0x5d6266,
  leather: 0x4a3322,
  shaft: 0x9a7448,
  banner: 0xb3261e,
  bannerTrim: 0xf0cd5c,
  weakBand: 0xd23a2a,
  stone: 0x9b978d,
  wood: 0xc39a66,
  dust: 0xcdbb9c,
  dot: 0xffffff,
};

interface BlockLook {
  mesh: THREE.Mesh;
  kind: MaterialKind;
  stage: number;
  gone: boolean;
}

interface SpearLook {
  group: THREE.Group;
}

interface Thrower {
  group: THREE.Group;
  arm: THREE.Group;
  /** The spear in hand, shown while there's one to throw. */
  spear: THREE.Group;
  x: number;
  /** When it last threw (real seconds), for the arm's snap forward. */
  threwAt: number;
}

/** A finger pulling back to aim: where it went down, and the throw it would make now. */
interface Drag {
  id: number;
  x: number;
  y: number;
  aim: Aim | undefined;
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

/**
 * The siege in 3D: your line of throwers at the bottom of the screen, the fort up the field, seen
 * from behind and above the line. Drag back anywhere to aim (the dotted arcs show the start of the
 * flight), let go and the whole line throws; Aimed or Barrage picks how. The rules (SiegeRound, a
 * Rapier physics world) decide everything; this draws its bodies where it says and adds the juice:
 * hit-stop, shake, dust, debris, sounds, buzzes, the camera riding a spear, and slow motion as the
 * banner falls.
 */
export class Siege3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Siege3DDeps;
  readonly #physics: Physics;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #ui: ReturnType<Siege3DView['buildUi']>;
  readonly #fortGroup = new THREE.Group();
  readonly #spearGroup = new THREE.Group();
  readonly #lineGroup = new THREE.Group();
  readonly #effects = new THREE.Group();
  readonly #textures: ReturnType<typeof makeTextures>;
  /** Block looks, by kind and damage stage (0 whole, 1 cracked, 2 crumbling). */
  readonly #materials: Record<MaterialKind, THREE.MeshLambertMaterial[]>;
  readonly #spearParts: { shaft: THREE.BufferGeometry; tip: THREE.BufferGeometry };
  readonly #spearMaterials: { shaft: THREE.Material; tip: THREE.Material };
  readonly #dots: THREE.InstancedMesh;
  readonly #puffTexture: THREE.Texture;
  readonly #pose: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  #round: SiegeRound | undefined;
  #fortId: string | undefined;
  #mode: ThrowMode = 'aimed';
  #blocks: BlockLook[] = [];
  #spears: SpearLook[] = [];
  #throwers: Thrower[] = [];
  #flag: THREE.Mesh | undefined;
  #puffs: Puff[] = [];
  #debris: Debris[] = [];
  #drag: Drag | undefined;
  /** Real seconds since the view started, for the juice's clocks. */
  #now = 0;
  #frozenUntil = 0;
  #lastStop = -Infinity;
  #slowUntil = 0;
  #shake = 0;
  /** The spear the camera rides, and when it set off. */
  #follow: { kind: 'spear' | 'banner'; index: number; at: number; seconds: number } | undefined;
  #followBlend = 0;
  #lookAt = new THREE.Vector3();
  #cameraAt = new THREE.Vector3();
  /** How much further back the camera sits so the whole line fits across the screen. */
  #fitBack = 0;
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
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'siege');
    this.#skill = station?.skill ?? deps.game.data.siege.throwers.skill;
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
    const { length, radius } = deps.game.data.siege.projectile;
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
    this.#dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: COLORS.dot, transparent: true, opacity: 0.9 }),
      ARC_DOTS * 40,
    );
    this.#dots.count = 0;
    this.#dots.frustumCulled = false;
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
    const throwers = throwerCount(rules, game.level(rules.throwers.skill));
    this.#buildLine(throwers);
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
      { throwers, seed: Date.now() >>> 0 },
    );
    this.#round = round;
    this.#buildFort(round);
    this.#showForts(open);
    this.#slowUntil = this.#frozenUntil = 0;
    this.#follow = undefined;
    this.#followBlend = 0;
    if (game.inventory.count(rules.item) < 1) this.#showNoSpears();
  }

  /** Throws the round away (leaving, or starting another): its thrown spears are spent. */
  #endRound(): void {
    const round = this.#round;
    if (!round) return;
    round.quit();
    round.dispose();
    this.#round = undefined;
    for (const look of this.#blocks) look.mesh.removeFromParent();
    for (const look of this.#spears) look.group.removeFromParent();
    this.#blocks = [];
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
    this.#dots.count = 0;
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
    this.#scene.fog = new THREE.Fog(COLORS.sky, 45, 120);
    this.#scene.add(new THREE.HemisphereLight(0xeef4ff, 0x4a5a32, 1.35));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2);
    sun.position.set(-8, 16, 6);
    sun.target.position.set(0, 0, -14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const shadow = sun.shadow.camera;
    shadow.left = -12;
    shadow.right = 12;
    shadow.top = 16;
    shadow.bottom = -16;
    shadow.near = 1;
    shadow.far = 60;
    sun.shadow.bias = -0.0005;
    this.#scene.add(sun, sun.target);
    const ground = groundMesh('meadowGrass', FIELD, FIELD);
    ground.position.z = -FIELD / 4;
    this.#scene.add(ground);
    // Trodden earth where the line stands and round the fort, where the fighting is.
    const trodden = wornGround('troddenDirt', 14, 34, { cover: 0.55, round: true, seed: 8 });
    trodden.position.z = -12;
    this.#scene.add(trodden);
    this.#scene.add(this.#trees(tree));
    this.#scene.add(this.#fortGroup, this.#spearGroup, this.#lineGroup, this.#effects, this.#dots);
  }

  /** A few trees off to the sides and behind the fort: only looks. */
  #trees(tree: THREE.Object3D): THREE.Group {
    const rng = new Rng(11);
    const placements: Placement[] = [];
    while (placements.length < 26) {
      const x = rng.range(-40, 40);
      const z = rng.range(-70, -8);
      // Clear of the field between the line and the fort, and of the fort itself.
      if (Math.abs(x) < 9 + (z > -26 ? 3 : 0)) continue;
      placements.push({ x, z, height: rng.range(5, 9), turn: rng.range(0, Math.PI * 2) });
    }
    for (let index = 0; index < 8; index++) {
      placements.push({
        x: rng.range(-18, 18),
        z: rng.range(-60, -36),
        height: rng.range(6, 10),
        turn: rng.range(0, Math.PI * 2),
      });
    }
    const trees = scatter(tree, placements);
    trees.traverse((child) => {
      child.castShadow = false;
    });
    return trees;
  }

  /** The fort's blocks, sized from the rules' blocks; the banner gets its flag. */
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
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(
            Math.max(width, depth) * 0.62,
            Math.max(width, depth) * 0.62,
            height * 0.18,
            10,
          ),
          new THREE.MeshLambertMaterial({ color: COLORS.weakBand }),
        );
        band.position.y = height * 0.12;
        mesh.add(band);
      }
      if (index === round.bannerIndex) {
        mesh.material = new THREE.MeshLambertMaterial({ color: COLORS.leather });
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.1, 0.7, 10, 4),
          new THREE.MeshLambertMaterial({
            map: this.#textures.banner,
            side: THREE.DoubleSide,
          }),
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
    this.#drawBodies();
  }

  /** The line of throwers, one figure each where the rules stand them. */
  #buildLine(count: number): void {
    for (const thrower of this.#throwers) thrower.group.removeFromParent();
    const rules = this.#deps.game.data.siege;
    const [handX, handY, handZ] = rules.projectile.launch;
    this.#throwers = throwerSpots(count, rules).map((x) => {
      const group = new THREE.Group();
      group.position.set(x, 0, 0);
      const part = (geometry: THREE.BufferGeometry, color: number, at: Vec3) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
        mesh.position.set(at.x, at.y, at.z);
        mesh.castShadow = true;
        group.add(mesh);
        return mesh;
      };
      for (const side of [-1, 1]) {
        part(new THREE.BoxGeometry(0.14, 0.8, 0.16), COLORS.leather, {
          x: side * 0.1,
          y: 0.4,
          z: 0,
        });
      }
      part(new THREE.BoxGeometry(0.44, 0.62, 0.26), COLORS.tunic, { x: 0, y: 1.1, z: 0 });
      part(new THREE.BoxGeometry(0.46, 0.08, 0.28), COLORS.tunicTrim, { x: 0, y: 0.84, z: 0 });
      part(new THREE.SphereGeometry(0.14, 10, 8), COLORS.skin, { x: 0, y: 1.56, z: 0 });
      part(new THREE.SphereGeometry(0.155, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.iron, {
        x: 0,
        y: 1.6,
        z: 0,
      });
      part(new THREE.BoxGeometry(0.1, 0.5, 0.1), COLORS.tunic, { x: -0.27, y: 1.1, z: 0 });
      // The throwing arm turns at the shoulder, holding its spear over it, level, point first.
      const arm = new THREE.Group();
      arm.position.set(handX, 1.38, 0);
      const limb = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.5, 0.1),
        new THREE.MeshLambertMaterial({ color: COLORS.skin }),
      );
      limb.position.y = 0.22;
      limb.castShadow = true;
      arm.add(limb);
      const spear = this.#spearMesh();
      spear.rotation.x = -Math.PI / 2;
      spear.position.set(0, handY - 1.38, handZ + 0.3);
      arm.add(spear);
      group.add(arm);
      this.#lineGroup.add(group);
      return { group, arm, spear, x, threwAt: -Infinity };
    });
    this.#fitCamera();
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
      case 'throw':
        this.#deps.haptics.pulse(event.mode === 'barrage' ? feel.buzzBarrageMs : feel.buzzThrowMs);
        this.#follow = undefined;
        break;
      case 'launch': {
        const look = { group: this.#spearMesh() };
        this.#spearGroup.add(look.group);
        this.#spears[event.spear] = look;
        const thrower = this.#throwers[event.thrower];
        if (thrower) thrower.threwAt = this.#now;
        this.#play('whoosh', 0.18, (Math.random() - 0.5) * 300);
        // The camera rides the first spear of the throw from the middle of the line.
        this.#follow ??= {
          kind: 'spear',
          index: event.spear,
          at: this.#now,
          seconds: feel.followSeconds,
        };
        break;
      }
      case 'hit': {
        const heavy = event.speed >= feel.heavyHitSpeed;
        const broke = round.blocks[event.block]?.broken === true;
        if (!broke) {
          this.#play(
            event.kind === 'stone'
              ? `stone-${String(1 + Math.floor(Math.random() * 2))}`
              : `wood-${String(1 + Math.floor(Math.random() * 3))}`,
            Math.min(0.25 + event.speed / 40, 0.8),
            event.kind === 'stone' ? 200 : 0,
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
    const base = this.#materials[kind][2];
    for (let piece = 0; piece < DEBRIS_PIECES && this.#debris.length < MAX_DEBRIS; piece++) {
      const material = (base ?? this.#materials[kind][0])?.clone();
      if (!material) return;
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

  /** A hit-stop of `ms`, unless one has only just ended (a barrage would stutter). */
  #stop(ms: number): void {
    if (ms <= 0 || this.#now - this.#lastStop < 0.25) return;
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
    this.#updateLine();
    this.#updateEffects(dt);
    this.#updateFlag(time / 1000);
    this.#updateUi();
    this.#updateCamera(realDt);
    this.#renderer.render(this.#scene, this.#camera);
  }

  /** Every block and spear where the rules have it, and blocks' damage showing. */
  #drawBodies(): void {
    const round = this.#round;
    if (!round) return;
    const pose = this.#pose;
    this.#blocks.forEach((look, index) => {
      if (look.gone) return;
      round.blockPose(index, pose);
      look.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      look.mesh.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
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
    this.#spears.forEach((look, index) => {
      round.spearPose(index, pose);
      look.group.position.set(pose.position.x, pose.position.y, pose.position.z);
      look.group.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    });
  }

  /** The throwers turn to the aim, wind back as you pull, and snap forward as they throw. */
  #updateLine(): void {
    const round = this.#round;
    const rules = this.#deps.game.data.siege;
    const aim = this.#drag?.aim;
    const left = this.#deps.game.inventory.count(rules.item);
    const ready = round?.canThrow === true;
    // Who has a spear in hand: the middle ones first, as the rules hand them out.
    const order = [...this.#throwers.keys()].sort(
      (a, b) => Math.abs(this.#throwers[a]?.x ?? 0) - Math.abs(this.#throwers[b]?.x ?? 0) || a - b,
    );
    const armed = new Set(order.slice(0, Math.min(left, this.#throwers.length)));
    this.#throwers.forEach((thrower, index) => {
      const reach = rules.throwers.converge;
      const yaw = aim?.yaw ?? 0;
      const target = Math.atan2(Math.sin(yaw) * reach - thrower.x, Math.cos(yaw) * reach);
      thrower.group.rotation.y += (-target - thrower.group.rotation.y) * 0.25;
      const since = this.#now - thrower.threwAt;
      let swing = aim ? aim.power * WIND_UP : 0;
      if (since < SNAP_SECONDS) swing = -0.9 * Math.sin((since / SNAP_SECONDS) * Math.PI);
      thrower.arm.rotation.x += (swing - thrower.arm.rotation.x) * (since < SNAP_SECONDS ? 1 : 0.3);
      thrower.spear.visible =
        armed.has(index) && (ready || (aim !== undefined && since > SNAP_SECONDS));
    });
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

  /** How far back the camera must sit for the whole line to fit across the screen. */
  #fitCamera(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    const across = Math.max(...this.#throwers.map((thrower) => Math.abs(thrower.x)), 0) + 0.8;
    const halfWide = Math.atan(Math.tan((this.#camera.fov * DEG) / 2) * (width / height));
    const feel = this.#deps.feel.values;
    this.#fitBack = Math.max(across / Math.tan(halfWide) - feel.cameraBack, 0);
  }

  #updateCamera(dt: number): void {
    const feel = this.#deps.feel.values;
    const back = feel.cameraBack + this.#fitBack;
    // Higher in step with the step back, so the fort stays in view over the line.
    const lift = feel.cameraHeight * (back / feel.cameraBack);
    const home = new THREE.Vector3(0, lift, back);
    const look = new THREE.Vector3(0, feel.cameraLookHeight, -feel.cameraLookAhead);
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
      const spear = this.#pose.position;
      const at = new THREE.Vector3(spear.x, spear.y, spear.z);
      look.lerp(at, this.#followBlend);
      // A push in along the field after it, at the same height, so the line stays in view.
      home.x += at.x * this.#followBlend * 0.3;
      home.z += (at.z - home.z) * this.#followBlend * 0.3;
    }
    this.#cameraAt.copy(home);
    this.#lookAt.copy(look);
    this.#shake *= Math.exp(-9 * dt);
    this.#camera.position.copy(this.#cameraAt);
    if (this.#shake > 0.001) {
      this.#camera.position.add(
        new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(
          this.#shake * 4,
        ),
      );
    }
    this.#camera.lookAt(this.#lookAt);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#fitCamera();
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
      this.#drag = { id: event.pointerId, x: event.clientX, y: event.clientY, aim: undefined };
    });
    canvas.addEventListener('pointermove', (event) => {
      const drag = this.#drag;
      if (!drag || drag.id !== event.pointerId) return;
      drag.aim = aimFromDrag(
        event.clientX - drag.x,
        event.clientY - drag.y,
        this.#deps.feel.values,
      );
      this.#showPull(drag, event.clientX, event.clientY);
    });
    const end = (event: PointerEvent, cancelled: boolean) => {
      const drag = this.#drag;
      if (!drag || drag.id !== event.pointerId) return;
      this.#drag = undefined;
      this.#dots.count = 0;
      this.#ui.pull.hidden = true;
      if (!cancelled && drag.aim && this.#round?.throw(this.#mode, drag.aim)) {
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

  /** The pull: a line from where the finger went down, and the dotted arcs of the throw. */
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
    const aim = drag.aim;
    ui.pull.dataset.ready = String(aim !== undefined && this.#round?.canThrow === true);
    ui.pullPower.textContent = aim ? `${String(Math.round(aim.power * 100))}%` : '';
    ui.pullPower.setAttribute('x', String(x - rect.left));
    ui.pullPower.setAttribute('y', String(y - rect.top + 44));
    const round = this.#round;
    if (!aim || !round) {
      this.#dots.count = 0;
      return;
    }
    const arcs = round.preview(this.#mode, aim, ARC_DOTS);
    const matrix = new THREE.Matrix4();
    let count = 0;
    for (const arc of arcs) {
      arc.forEach((dot, index) => {
        if (count >= this.#dots.instanceMatrix.count) return;
        // Dots shrink toward the end of what's shown: the rest is up to you.
        const size = 1 - (index / ARC_DOTS) * 0.6;
        matrix.makeScale(size, size, size).setPosition(dot.x, dot.y, dot.z);
        this.#dots.setMatrixAt(count++, matrix);
      });
    }
    this.#dots.count = count;
    this.#dots.instanceMatrix.needsUpdate = true;
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
    // The forts open, before the first throw.
    const picker = el('div', 'sg-forts');
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', 'Fort');
    const status = el('div', 'sg-status');
    const hint = el('div', 'sg-hint');
    const modes = el('div', 'sg-modes');
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', 'Throw');
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
    // The pull, drawn over the scene.
    const svg = 'http://www.w3.org/2000/svg';
    // In a div: only HTML elements can be hidden.
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
    root.append(picker, status, pull, hint, modes, card);
    this.#element.append(root);
    return {
      root,
      picker,
      status,
      hint,
      modes,
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
        element.textContent = isOpen
          ? `${fort.name} · par ${String(fort.par)} throws`
          : `🔒 ${fort.name}`;
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
    this.#element.dataset.blocksDown = String(round?.blocksDown ?? 0);
    if (!round) return;
    const aiming = phase === 'aim' && ui.card.hidden;
    ui.modes.hidden = !aiming;
    for (const { mode, element, cost } of ui.modeButtons) {
      element.setAttribute('aria-checked', String(mode === this.#mode));
      const spears = spearsThrown(mode, round.throwers, left, rules);
      cost.textContent = `${String(spears)} spear${spears === 1 ? '' : 's'}`;
      // A short line: fewer spears than the throw takes.
      element.dataset.short = String(spears < round.throwers * spearsEach(mode, rules));
    }
    ui.status.hidden = !aiming && phase !== 'won';
    ui.status.textContent = `${String(round.throwers)} throwers · throws ${String(round.throws)} / par ${String(round.fort.par)} · ${String(round.used)} spears`;
    const hints: Record<string, string> = {
      aim: round.used === 0 ? 'Drag back anywhere, then let go: the whole line throws' : '',
      won: 'The banner is down!',
    };
    ui.hint.textContent =
      phase === 'aim' && left < 1 && !round.reloading ? 'Out of spears…' : (hints[phase] ?? '');
    ui.hint.hidden = !ui.card.hidden;
  }

  /** The end card: won or lost, spears against par, stars, XP and the spears back. */
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
    const lines = [
      `Throws: ${String(result.throws)} / par ${String(result.par)}`,
      `Spears thrown: ${String(result.used)}`,
      `Blocks down: ${String(result.blocksDown)}${result.blocksBroken > 0 ? ` (${String(result.blocksBroken)} broken)` : ''}`,
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

  /** Where the thrown spears lie on screen, for the recovered ones to pour from. */
  #spearPoints(): ScreenPoint[] {
    const { clientWidth: width, clientHeight: height } = this.#element;
    return this.#spears
      .map((look) => look.group.getWorldPosition(new THREE.Vector3()).project(this.#camera))
      .filter((point) => Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z < 1)
      .map((point) => ({ x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height }));
  }

  #showNoSpears(): void {
    const ui = this.#ui;
    ui.cardStars.replaceChildren();
    ui.cardTitle.textContent = 'No spears';
    ui.cardText.textContent =
      'The warchest has no spears to throw. Harden staves into spears at the fire pit.';
    ui.again.hidden = true;
    ui.card.hidden = false;
    ui.picker.hidden = true;
  }
}

function wonKey(fortId: string): string {
  return `siege.won.${fortId}`;
}

/** Darker as it takes damage. */
function stageTint(color: number, stage: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(1 - stage * 0.17);
}

/**
 * The block faces, drawn once: dressed stone and planks, each at three stages of damage (whole,
 * cracked, crumbling), and the banner's cloth.
 */
function makeTextures() {
  const canvas = (size: number) => {
    const element = document.createElement('canvas');
    element.width = element.height = size;
    const context = element.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    return { element, context };
  };
  const texture = (element: HTMLCanvasElement) => {
    const made = new THREE.CanvasTexture(element);
    made.colorSpace = THREE.SRGBColorSpace;
    made.anisotropy = 4;
    return made;
  };
  const rng = new Rng(5);
  const size = 128;
  /** Speckle, and a darker edge all round so every block reads on its own. */
  const face = (
    context: CanvasRenderingContext2D,
    base: string,
    grain: HTMLCanvasElement | undefined,
  ) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    if (grain) context.drawImage(grain, 0, 0, size, size);
    for (let index = 0; index < 900; index++) {
      const shade = rng.range(-30, 30);
      context.fillStyle = `rgba(${shade > 0 ? '255,255,255' : '0,0,0'},${String(Math.abs(shade) / 255)})`;
      context.fillRect(rng.int(0, size), rng.int(0, size), 2, 2);
    }
    const edge = context.createLinearGradient(0, 0, size, 0);
    for (const [at, alpha] of [
      [0, 0.45],
      [0.08, 0],
      [0.92, 0],
      [1, 0.45],
    ] as const) {
      edge.addColorStop(at, `rgba(30,24,18,${String(alpha)})`);
    }
    context.fillStyle = edge;
    context.fillRect(0, 0, size, size);
    const across = context.createLinearGradient(0, 0, 0, size);
    for (const [at, alpha] of [
      [0, 0.45],
      [0.1, 0],
      [0.9, 0],
      [1, 0.5],
    ] as const) {
      across.addColorStop(at, `rgba(30,24,18,${String(alpha)})`);
    }
    context.fillStyle = across;
    context.fillRect(0, 0, size, size);
  };
  /** Dark jagged cracks from the edges in; at the last stage chips knocked off the corners. */
  const damage = (context: CanvasRenderingContext2D, stage: number) => {
    context.strokeStyle = 'rgba(20,16,12,0.85)';
    context.lineCap = 'round';
    for (let crack = 0; crack < stage * 3; crack++) {
      context.lineWidth = rng.range(1.5, 3.5);
      context.beginPath();
      let x = rng.pick([0, size, rng.range(0, size)]);
      let y = x === 0 || x === size ? rng.range(0, size) : rng.pick([0, size]);
      context.moveTo(x, y);
      for (let step = 0; step < 6; step++) {
        x += rng.range(-22, 22) + (size / 2 - x) * 0.25;
        y += rng.range(-22, 22) + (size / 2 - y) * 0.25;
        context.lineTo(x, y);
      }
      context.stroke();
    }
    if (stage >= 2) {
      context.fillStyle = 'rgba(25,20,15,0.7)';
      for (let chip = 0; chip < 7; chip++) {
        const x = rng.pick([0, size]) + rng.range(-6, 6);
        const y = rng.range(0, size);
        context.beginPath();
        context.ellipse(x, y, rng.range(5, 14), rng.range(4, 10), rng.range(0, 3), 0, Math.PI * 2);
        context.fill();
      }
    }
  };
  const staged = (base: string, grain: () => HTMLCanvasElement | undefined) =>
    [0, 1, 2].map((stage) => {
      const { element, context } = canvas(size);
      face(context, base, grain());
      damage(context, stage);
      return texture(element);
    });
  const stone = staged('#c9c4b8', () => undefined);
  const wood = staged('#d9b88a', () => {
    const grain = drawSplitGrain(32, 128, 6, 3);
    return grain;
  });
  const { element, context } = canvas(128);
  context.fillStyle = '#b3261e';
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = '#f0cd5c';
  context.fillRect(0, 0, 128, 10);
  context.fillRect(0, 118, 128, 10);
  // A crossed pair of spears: the warband's mark.
  context.strokeStyle = '#f0cd5c';
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(30, 100);
  context.lineTo(98, 28);
  context.moveTo(98, 100);
  context.lineTo(30, 28);
  context.stroke();
  return { stone, wood, banner: texture(element) };
}

function puffTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A spear's whoosh, made rather than recorded: a short burst of noise swelling and dying away,
 * low-passed more as it fades, as a WAV in memory (no file to ship or credit).
 */
function whooshUrl(): string {
  const rate = 22050;
  const length = Math.round(rate * 0.32);
  const data = new Int16Array(length);
  const rng = new Rng(3);
  let low = 0;
  for (let index = 0; index < length; index++) {
    const t = index / length;
    const envelope = Math.sin(Math.PI * t) ** 2;
    const cutoff = 0.35 - 0.28 * t;
    low += (rng.range(-1, 1) - low) * cutoff;
    data[index] = Math.round(low * envelope * 0.9 * 32767);
  }
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      header.setUint8(at + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  header.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, length * 2, true);
  return URL.createObjectURL(new Blob([header.buffer, data.buffer], { type: 'audio/wav' }));
}
