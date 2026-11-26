import * as THREE from 'three';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import { loadModel } from '../../../app/models';
import { scatter, type Placement } from '../../../app/scatter';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import { Rng, type EventLogger, type Game, type LiveChoice, type LiveTuning } from '../../../core';
import type { SiegeFeel, SiegeFort } from '../../../data';
import type { GhostLine } from '../feel';
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
  aimedVolley,
  clampAim,
  siegeWeapon,
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
  /** Whether the last shot's path stays drawn, kept on this phone. */
  ghost: LiveChoice<GhostLine>;
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
/** Segments, at most, in the solid line along the last shot's path. */
const GHOST_SEGMENTS = 120;
/** A touch that moves less than this (px) is a tap (it skips the camera work), not a look. */
const TAP_PX = 10;
/** The crosshair's ring: its least size on screen (px). */
const CROSSHAIR_PX = 30;
/** How far ahead the sights look, and the bolt cam looks past its spear (m). */
const LOOK_REACH = 50;
const BOLT_LOOK = 8;
/** The longest a bolt cam rides one spear (s), in case it never comes down. */
const BOLT_MOST_SECONDS = 3;
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
 * The camera's blends (0 to 1) at which the mantlet and crosshair hide (looking elsewhere), and the
 * ballista shows (seen from outside, not from its own sights).
 */
const SIGHT_SHOWS_UNDER = 0.15;
const BALLISTA_SHOWS_OVER = 0.3;
/** Weak posts get a red band; anything this wide or wider (a gate) shows by its wood instead (m). */
const WEAK_BAND_UNDER = 0.5;
/** How often the targets on screen are noted for the e2e tests and screenshots (s). */
const TARGETS_SECONDS = 0.25;
/** Least gap between two hit-stops (s), so a volley doesn't stutter. */
const STOP_GAP = 0.25;
/** The haze far off (m), pushed back as the camera rises to scout (so the fort stays clear). */
const FOG = { near: 60, far: 150, scouting: 90 };
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
  mantlet: 0x7a5232,
  ghost: 0x7fe8ff,
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

/**
 * The camera work after a shot: riding its middle spear (`bolt`, until `hitAt` and a moment
 * after), or looking at what it brought down (`kill`: a guard, a collapse, the banner) for
 * `seconds`.
 */
type Cine =
  | { kind: 'bolt'; spear: number; at: number; hitAt: number | undefined; last?: THREE.Vector3 }
  | { kind: 'kill'; target: KillTarget; at: number; seconds: number; away?: THREE.Vector3 };

/** What a kill cam looks at: a guard, a block (the banner), or a point (a collapse). */
type KillTarget = { guard: number } | { block: number } | { point: Vec3 };

/** A finger on the scene: where it went down, where it was last, and whether it's dragging. */
interface Touch {
  id: number;
  x: number;
  y: number;
  last: { x: number; y: number };
  dragging: boolean;
}

/**
 * The siege in 3D, seen down the ballista's sights through the slit in a wooden mantlet: the
 * crosshair in the middle of the screen is where the bolt points, and a drag turns the view and
 * the weapon together. Fire shoots, Aimed or Barrage; the camera rides the middle spear, and a kill
 * (or a collapse) gets a slow-motion look. The last shot's real path can stay as a solid line, so
 * you learn the drop. Scout looks down on the whole fort. Tap a spot to move. Win a position and it
 * rolls on to the next. The rules (SiegeRound, a Rapier physics world) decide everything; this
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
  readonly #ghost: THREE.InstancedMesh;
  /** The wooden shield framing the view down the sights; it rides with the camera. */
  readonly #mantlet: THREE.Group;
  readonly #raycaster = new THREE.Raycaster();
  readonly #puffTexture: THREE.Texture;
  /** Geometry and materials every round uses, which freeing a round's meshes must leave alone. */
  readonly #shared = new Set<object>();
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
  #touch: Touch | undefined;
  /** Scouting: looking down on the whole fort (`on`), and how far the camera's got there. */
  #scout = { on: false, blend: 0 };
  /** The last shot's middle spear, and the path it's flown so far. */
  #trailSpear: number | undefined;
  #trailPoints: THREE.Vector3[] = [];
  /** Real seconds since the view started, for the juice's clocks. */
  #now = 0;
  #frozenUntil = 0;
  #lastStop = -Infinity;
  /** Slow motion: time runs at `factor` until `until`, easing back over its last third. */
  #slow = { until: 0, seconds: 1, factor: 1 };
  #shake = 0;
  #shotAt = -Infinity;
  /** The camera work going on, how far the camera's gone over to it, and where it looks from. */
  #cine: Cine | undefined;
  #cineBlend = 0;
  #cineOut = false;
  #cinePose = { position: new THREE.Vector3(), look: new THREE.Vector3() };
  /** Whether this shot has had its kill cam (only the first kill of a shot gets one). */
  #killShown = false;
  /** Blocks broken lately (real seconds, and where), to tell a big collapse. */
  #breaks: { at: number; point: Vec3 }[] = [];
  /** The roll on to the next position: its name shows, and the camera lifts as it goes. */
  #title: { text: string; at: number } | undefined;
  #rolling = 0;
  #lastBallista = { x: 0, z: 0 };
  #bankedXp: XpDeposit | undefined;
  #finished: { result: SiegeResult; at: number } | undefined;
  #unlocked: string | undefined;
  #lastPhase = '';
  #targetsAt = -Infinity;

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
    this.#aim = startAim(siegeWeapon(rules));
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'siege');
    this.#skill = station?.skill ?? siegeWeapon(rules).skill;
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
    for (const shared of [
      ...Object.values(this.#materials).flat(),
      shaft,
      tip,
      this.#spearMaterials.shaft,
      this.#spearMaterials.tip,
    ]) {
      this.#shared.add(shared);
    }
    const weapon = siegeWeapon(rules);
    this.#ballista = buildBallista(weapon, () => this.#spearMesh());
    this.#mantlet = this.#buildMantlet();
    this.#camera.add(this.#mantlet);
    // The last shot's path: a solid tube of short segments, bright enough for daylight.
    const segment = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
    segment.rotateX(Math.PI / 2);
    this.#ghost = new THREE.InstancedMesh(
      segment,
      new THREE.MeshBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.9 }),
      GHOST_SEGMENTS,
    );
    this.#ghost.count = 0;
    this.#ghost.frustumCulled = false;
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
        logger: deps.logger,
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
    this.#endRound();
    this.#hud.sleep();
    this.#skillBar.settle();
    this.#bankedXp = undefined;
    delete document.body.dataset.siege;
    this.#lastPhase = '';
    releaseContext(this.#renderer, this.#deps.logger, 'siege3d');
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
    const weapon = siegeWeapon(rules);
    const aimed = aimedVolley(weapon, game.level(weapon.skill));
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
    this.#aim = startAim(weapon);
    this.#scout = { on: false, blend: 0 };
    this.#buildFort(round);
    this.#showForts(open);
    this.#showSpots();
    this.#slow.until = this.#frozenUntil = 0;
    this.#cine = undefined;
    this.#cineBlend = 0;
    this.#cineOut = false;
    this.#breaks = [];
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
    // Each round builds its fort, guards and spears afresh: free what they put on the graphics
    // card, or every round leaves the last one's there.
    for (const look of this.#blocks) this.#free(look.mesh);
    for (const look of this.#guards) this.#free(look.root);
    for (const spear of this.#spears) this.#free(spear);
    this.#blocks = [];
    this.#guards = [];
    this.#spears = [];
    this.#flag = undefined;
    for (const puff of this.#puffs) {
      puff.sprite.removeFromParent();
      puff.material.dispose();
    }
    for (const piece of this.#debris) {
      this.#free(piece.mesh);
    }
    this.#puffs = [];
    this.#debris = [];
    this.#touch = undefined;
    this.#trailSpear = undefined;
    this.#trailPoints = [];
    this.#ghost.count = 0;
  }

  /**
   * Takes a mesh (and what's on it) out of the scene and frees its geometry and materials from the
   * graphics card, all but the looks every round shares.
   */
  #free(root: THREE.Object3D): void {
    root.removeFromParent();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = child as THREE.Mesh;
      if (!this.#shared.has(mesh.geometry)) mesh.geometry.dispose();
      for (const material of [mesh.material].flat()) {
        if (!this.#shared.has(material)) material.dispose();
      }
    });
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
    this.#scene.fog = new THREE.Fog(COLORS.sky, FOG.near, FOG.far);
    this.#scene.add(new THREE.HemisphereLight(0xeef4ff, 0x4a5a32, 1.35));
    const sun = this.#sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const shadow = sun.shadow.camera;
    shadow.left = -20;
    shadow.right = 20;
    shadow.top = 30;
    shadow.bottom = -30;
    shadow.near = 1;
    shadow.far = 70;
    sun.shadow.bias = -0.0005;
    this.#scene.add(sun, sun.target);
    const ground = groundMesh('meadowGrass', FIELD, FIELD);
    ground.position.z = -FIELD / 4;
    this.#scene.add(ground);
    // Trodden earth up the middle, where the ballista rolls and the fighting is.
    const trodden = wornGround('troddenDirt', 32, 96, { cover: 0.55, round: true, seed: 8 });
    trodden.position.z = -40;
    this.#scene.add(trodden);
    this.#scene.add(this.#trees(tree));
    this.#scene.add(
      this.#fortGroup,
      this.#spearGroup,
      this.#effects,
      this.#spotGroup,
      this.#ballista.root,
      this.#ghost,
      // The camera carries the mantlet, so it's in the scene.
      this.#camera,
    );
  }

  /** Trees off to the sides and behind the fort: only looks. */
  #trees(tree: THREE.Object3D): THREE.Group {
    const rng = new Rng(11);
    const placements: Placement[] = [];
    while (placements.length < 44) {
      const x = rng.range(-50, 50);
      const z = rng.range(-115, 6);
      // Clear of the field the ballista rolls up, and of the fort either side of it.
      if (Math.abs(x) < 19 && z > -90) continue;
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
      if (state.block.weak && Math.max(width, depth) < WEAK_BAND_UNDER) {
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
    for (const child of [...this.#spotGroup.children]) this.#free(child);
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
        this.#shotAt = this.#now;
        // The trail follows this shot's middle spear (of its first volley) as it flies, and so
        // does the camera.
        const first = this.#spears.length;
        this.#trailSpear = first + Math.floor((Math.min(event.spears, round.aimed) - 1) / 2);
        this.#trailPoints = [];
        this.#ghost.count = 0;
        this.#endSlow();
        this.#cine = { kind: 'bolt', spear: this.#trailSpear, at: this.#now, hitAt: undefined };
        this.#cineOut = false;
        this.#killShown = false;
        break;
      }
      case 'launch': {
        const spear = this.#spearMesh();
        this.#spearGroup.add(spear);
        this.#spears[event.spear] = spear;
        this.#play('whoosh', 0.16, (Math.random() - 0.5) * 300);
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
      case 'break': {
        this.#breakBlock(event.block, event.kind, event.at);
        // Many blocks at once is a collapse worth watching.
        this.#breaks = this.#breaks.filter(
          (entry) => this.#now - entry.at <= feel.collapseWindowSeconds,
        );
        this.#breaks.push({ at: this.#now, point: event.at });
        if (!this.#killShown && this.#breaks.length >= feel.collapseBlocks) {
          const count = this.#breaks.length;
          const middle = this.#breaks.reduce(
            (sum, entry) => ({
              x: sum.x + entry.point.x / count,
              y: sum.y + entry.point.y / count,
              z: sum.z + entry.point.z / count,
            }),
            { x: 0, y: 0, z: 0 },
          );
          this.#killCam({ point: middle }, feel.killCamSeconds, feel.killCamSlowMo);
        }
        break;
      }
      case 'guardDown': {
        const look = this.#guards[event.guard];
        if (look && !look.down) {
          look.down = true;
          greyGuard(look);
        }
        this.#dust(event.at, Math.ceil(feel.dust * 0.6), 0.6);
        if (!this.#killShown) {
          // The shot's first kill: watched, slowed down, felt. Any more in the same shot are
          // quick, so rapid play isn't held up.
          this.#play('thud-2', 0.8, -500);
          this.#play('break-wood', 0.35, 300);
          this.#deps.haptics.pulse(feel.buzzKillMs);
          this.#killCam({ guard: event.guard }, feel.killCamSeconds, feel.killCamSlowMo);
        } else {
          this.#play('thud-2', 0.45, -200);
          this.#deps.haptics.pulse(feel.buzzGuardMs);
        }
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
        this.#aim = startAim(round.weapon);
        this.#play('thud-3', 0.4, -700);
        break;
      case 'bannerFalling':
        // The camera watches the keep come down, slowly: the keep as it stood, so it's framed.
        this.#killCam(
          { point: this.#pieceMiddle(round.bannerIndex) },
          feel.slowMoSeconds,
          feel.slowMo,
        );
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

  /**
   * A kill cam: a freeze, then slow motion for `seconds` while the camera looks at `target`.
   * Once a shot, unless it's the banner.
   */
  #killCam(target: KillTarget, seconds: number, slowMo: number): void {
    const feel = this.#deps.feel.values;
    this.#killShown = true;
    this.#cine = { kind: 'kill', target, at: this.#now, seconds };
    this.#cineOut = false;
    this.#frozenUntil = Math.max(this.#frozenUntil, this.#now + feel.killCamStopMs / 1000);
    this.#lastStop = this.#now;
    this.#slow = { until: this.#now + seconds, seconds, factor: slowMo };
  }

  /** Back to full speed at once (a skip, or the next shot). */
  #endSlow(): void {
    this.#slow.until = this.#now;
    this.#frozenUntil = Math.min(this.#frozenUntil, this.#now);
  }

  /** A tap (or the next shot) during camera work: back to the sights, and to full speed. */
  #skipCine(): void {
    if (!this.#cine || this.#cineOut) return;
    this.#cineOut = true;
    this.#endSlow();
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
    const frozen = this.#now < this.#frozenUntil;
    // Slow motion (a kill, a collapse, the banner), easing back to full speed over its last third.
    const slow = this.#slow;
    const slowLeft = slow.until - this.#now;
    const slowShare = slow.seconds > 0 ? slowLeft / slow.seconds : 0;
    const scale =
      slowLeft > 0 ? slow.factor + (1 - slow.factor) * Math.max(0, 1 - slowShare * 3) : 1;
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
    this.#drawAim();
    this.#updateEffects(dt);
    this.#updateFlag(time / 1000);
    this.#updateUi();
    this.#updateCamera(realDt);
    // The sun's shadows cover the field ahead of the weapon, where it's looking.
    const ahead = aimDirection(this.#aim);
    const middle = {
      x: this.#lastBallista.x + ahead.x * 18,
      z: this.#lastBallista.z + ahead.z * 18,
    };
    this.#sun.position.set(middle.x - 8, 16, middle.z + 16);
    this.#sun.target.position.set(middle.x, 0, middle.z);
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
    // The last shot's middle spear leaves its line while it flies.
    const trailed = this.#trailSpear;
    if (trailed !== undefined && round.spears[trailed]?.flying) {
      round.spearPose(trailed, pose);
      const point = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
      const last = this.#trailPoints.at(-1);
      if (!last || last.distanceTo(point) > 0.3) {
        this.#trailPoints.push(point);
        if (this.#trailPoints.length > GHOST_SEGMENTS + 1) this.#trailPoints.shift();
        this.#drawGhost();
      }
    }
  }

  /** The solid line along the last shot's path, `ghostWidth` thick. */
  #drawGhost(): void {
    const width = this.#deps.feel.values.ghostWidth;
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const forward = new THREE.Vector3(0, 0, 1);
    let count = 0;
    for (let index = 1; index < this.#trailPoints.length; index++) {
      const from = this.#trailPoints[index - 1];
      const to = this.#trailPoints[index];
      if (!from || !to) continue;
      const way = to.clone().sub(from);
      const length = way.length();
      turn.setFromUnitVectors(forward, way.normalize());
      matrix.compose(from.clone().lerp(to, 0.5), turn, new THREE.Vector3(width, width, length));
      this.#ghost.setMatrixAt(count++, matrix);
    }
    this.#ghost.count = count;
    this.#ghost.instanceMatrix.needsUpdate = true;
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
    look.turn.rotation.y = -aim.yaw;
    look.tilt.rotation.x = aim.tilt;
    // From its own sights it's all around the eye: it shows only from outside.
    look.root.visible = Math.max(this.#cineBlend, this.#scout.blend) > BALLISTA_SHOWS_OVER;
    // Loaded: the bolt in the groove, the arms swept back. Just shot: they snap forward.
    const since = this.#now - this.#shotAt;
    look.bolt.visible = round.canThrow || (!round.reloading && since > SNAP_SECONDS);
    const sweep = since < SNAP_SECONDS ? 0.35 * (1 - since / SNAP_SECONDS) - 0.15 : 0.35;
    look.arms.forEach((arm, index) => {
      arm.rotation.y = (index === 0 ? -1 : 1) * sweep;
    });
  }

  /**
   * The aim, down the sights: the crosshair sits in the middle of the screen, where the bolt
   * points, as wide as the shot's spread (a barrage's far wider). The mantlet frames it. The last
   * shot's path shows if it's turned on.
   */
  #drawAim(): void {
    const round = this.#round;
    const ui = this.#ui;
    const feel = this.#deps.feel.values;
    // Not while riding the spear that's drawing it: from just behind, it'd fill the screen.
    this.#ghost.visible = this.#deps.ghost.value === 'on' && this.#cine?.kind !== 'bolt';
    const sighting = Math.max(this.#cineBlend, this.#scout.blend) < SIGHT_SHOWS_UNDER;
    this.#mantlet.visible = sighting;
    const showing =
      round !== undefined && round.phase === 'aim' && ui.card.hidden && !this.#scout.on && sighting;
    ui.crosshair.hidden = !showing;
    if (!showing) return;
    const spread = (this.#mode === 'barrage' ? feel.barrageSpread : feel.aimedSpread) * DEG;
    const half = Math.tan((this.#camera.fov * DEG) / 2);
    const radius = Math.max(
      (Math.tan(spread) / half) * (this.#element.clientHeight / 2),
      CROSSHAIR_PX / 2,
    );
    ui.crosshair.style.width = ui.crosshair.style.height = `${String(radius * 2)}px`;
    ui.crosshair.dataset.mode = this.#mode;
  }

  /**
   * The mantlet: a wooden shield of planks with a sight slit through the middle, just in front of
   * the eye, sized from the data. It frames the view; the slit leaves the crosshair clear.
   */
  #buildMantlet(): THREE.Group {
    const { distance, width, height, thickness, slitWidth, slitHeight } =
      this.#deps.game.data.siege.mantlet;
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      map: this.#textures.wood[0] ?? null,
      color: COLORS.mantlet,
    });
    const board = (w: number, h: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, thickness), material);
      mesh.position.set(x, y, -distance);
      group.add(mesh);
    };
    const above = (height - slitHeight) / 2;
    const beside = (width - slitWidth) / 2;
    // Above and below the slit, full width; either side of it, the slit's height.
    board(width, above, 0, slitHeight / 2 + above / 2);
    board(width, above, 0, -slitHeight / 2 - above / 2);
    board(beside, slitHeight, -slitWidth / 2 - beside / 2, 0);
    board(beside, slitHeight, slitWidth / 2 + beside / 2, 0);
    // Drawn over everything, as it's nearer than anything else.
    group.traverse((child) => {
      child.renderOrder = 10;
    });
    material.depthTest = false;
    return group;
  }

  /**
   * The raycaster's nearest hit on a block of the fort that's still standing (broken blocks only
   * hide), within `far`: what a camera mustn't end up inside. Guards don't count.
   */
  #wallHit(far = Infinity): THREE.Intersection | undefined {
    this.#raycaster.far = far;
    const standing = this.#blocks.filter((look) => !look.gone).map((look) => look.mesh);
    const [hit] = this.#raycaster.intersectObjects(standing, true);
    this.#raycaster.far = Infinity;
    return hit;
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
   * Down the sights: the eye on the bolt's line, `sightBack` behind the pivot, looking along it,
   * so the crosshair in the middle of the screen is exactly where the bolt points. From there, the
   * camera work after a shot (riding its middle spear, then looking at a kill or a collapse) and
   * scouting (up over the whole fort) blend in, and ease back.
   */
  #updateCamera(dt: number): void {
    const feel = this.#deps.feel.values;
    const weapon = siegeWeapon(this.#deps.game.data.siege);
    const at = this.#lastBallista;
    const way = aimDirection(this.#aim);
    const forward = new THREE.Vector3(way.x, way.y, way.z);
    const pivot = new THREE.Vector3(at.x, weapon.pivotHeight, at.z);
    const home = pivot.clone().addScaledVector(forward, -feel.sightBack);
    const look = pivot.clone().addScaledVector(forward, LOOK_REACH);
    this.#updateCine(dt, home, look);
    const eased = (share: number) => share * share * (3 - 2 * share);
    if (this.#cineBlend > 0) {
      const share = eased(this.#cineBlend);
      home.lerp(this.#cinePose.position, share);
      look.lerp(this.#cinePose.look, share);
    }
    // Scouting: up over the whole fort, looking down on it.
    const scoutWant = this.#scout.on ? 1 : 0;
    const scoutRate = dt / Math.max(feel.scoutSeconds, 0.05);
    this.#scout.blend +=
      Math.sign(scoutWant - this.#scout.blend) *
      Math.min(Math.abs(scoutWant - this.#scout.blend), scoutRate);
    if (this.#scout.blend > 0) {
      const middle = this.#fortMiddle();
      const above = new THREE.Vector3(middle.x, feel.scoutHeight, middle.z + feel.scoutBack);
      const share = eased(this.#scout.blend);
      home.lerp(above, share);
      look.lerp(middle, share);
    }
    if (this.#scene.fog instanceof THREE.Fog) {
      this.#scene.fog.near = FOG.near + FOG.scouting * this.#scout.blend;
      this.#scene.fog.far = FOG.far + FOG.scouting * this.#scout.blend;
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
    if (this.#camera.fov !== feel.sightFov) {
      this.#camera.fov = feel.sightFov;
      this.#camera.updateProjectionMatrix();
    }
  }

  /**
   * The camera work: where it would put the camera now (`#cinePose`), and how far over to it the
   * camera has gone. It goes over fast, and eases back once it's done (or skipped). `sight` and
   * `sightLook` are the view down the sights, where a spear not yet out starts from.
   */
  #updateCine(dt: number, sight: THREE.Vector3, sightLook: THREE.Vector3): void {
    const feel = this.#deps.feel.values;
    const cine = this.#cine;
    const round = this.#round;
    if (!cine || !round) {
      this.#cine = undefined;
      this.#cineBlend = 0;
      return;
    }
    const pose = this.#cinePose;
    const age = this.#now - cine.at;
    if (!this.#cineOut) {
      if (cine.kind === 'bolt') {
        const spear = round.spears[cine.spear];
        const flying = spear?.flying === true;
        if (spear && this.#spears[cine.spear]) {
          round.spearPose(cine.spear, this.#pose);
          const { x, y, z } = this.#pose.position;
          const now = new THREE.Vector3(x, y, z);
          if (flying) {
            // Behind it and a little above, looking on past it along its flight.
            const travel = cine.last ? now.clone().sub(cine.last) : new THREE.Vector3();
            const heading =
              travel.lengthSq() > 1e-8
                ? travel.normalize()
                : sightLook.clone().sub(sight).normalize();
            pose.position
              .copy(now)
              .addScaledVector(heading, -feel.boltCamBack)
              .add(new THREE.Vector3(0, feel.boltCamRise, 0));
            pose.look.copy(now).addScaledVector(heading, BOLT_LOOK);
            cine.last = now;
          } else {
            // It's hit: hold there a moment, looking at where it struck.
            cine.hitAt ??= this.#now;
            pose.look.lerp(now, Math.min(1, dt * 6));
          }
        } else {
          pose.position.copy(sight);
          pose.look.copy(sightLook);
        }
        const done =
          (cine.hitAt !== undefined && this.#now - cine.hitAt >= feel.boltCamHoldSeconds) ||
          age >= BOLT_MOST_SECONDS;
        if (done) this.#cineOut = true;
      } else {
        const target = this.#killPoint(cine.target);
        const share = cine.seconds > 0 ? Math.min(age / cine.seconds, 1) : 1;
        // A guard close up; a collapse (a point) from further off, to see all of it.
        const off = 'point' in cine.target ? feel.collapseCamDistance : feel.killCamDistance;
        const distance = off * (1.25 - 0.25 * share);
        // Which way it looks from, picked once: off to the side and up if that's clear, else back
        // along the shot (clear, or the shot couldn't have got there), else from above.
        cine.away ??= this.#killView(target, distance);
        // Not inside a wall: short of whatever stands between it and a guard. (A collapse is
        // looked at from where it was clear: what flies about in it would only jerk the camera.)
        this.#raycaster.set(target, cine.away);
        const wall = 'guard' in cine.target ? this.#wallHit(distance) : undefined;
        pose.position
          .copy(target)
          .addScaledVector(
            cine.away,
            wall ? Math.max(wall.distance - feel.cameraClearance, 0.5) : distance,
          );
        pose.look.copy(target);
        if (age >= cine.seconds) this.#cineOut = true;
      }
      // In fast: the shot's barely left, the kill's already falling.
      this.#cineBlend = Math.min(1, this.#cineBlend + dt / Math.max(feel.boltCamInSeconds, 0.01));
      return;
    }
    // Easing back to the sights from where it was.
    this.#cineBlend -= dt / Math.max(feel.boltCamReturnSeconds, 0.05);
    if (this.#cineBlend <= 0) {
      this.#cineBlend = 0;
      this.#cine = undefined;
      this.#cineOut = false;
    }
  }

  /** The way a kill cam looks at `target` from (a unit vector from it), `distance` off. */
  #killView(target: THREE.Vector3, distance: number): THREE.Vector3 {
    const feel = this.#deps.feel.values;
    const at = this.#lastBallista;
    const from = new THREE.Vector3(target.x - at.x, 0, target.z - at.z);
    if (from.lengthSq() < 1e-6) from.set(0, 0, -1);
    from.normalize();
    const side = new THREE.Vector3(-from.z, 0, from.x);
    const up = new THREE.Vector3(0, 1, 0);
    // The view down the sights: the shot's line back from the target, clear or it'd not be hit.
    const weapon = siegeWeapon(this.#deps.game.data.siege);
    const way = aimDirection(this.#aim);
    const eye = new THREE.Vector3(
      at.x - way.x * feel.sightBack,
      weapon.pivotHeight - way.y * feel.sightBack,
      at.z - way.z * feel.sightBack,
    );
    const choices = [
      from
        .clone()
        .negate()
        .addScaledVector(side, 0.45)
        .addScaledVector(up, feel.killCamRise / distance),
      eye.clone().sub(target).normalize().addScaledVector(up, 0.15),
      from.clone().multiplyScalar(-0.5).add(up),
    ].map((way) => way.normalize());
    const clear = choices.find((way) => {
      this.#raycaster.set(target, way);
      return !this.#wallHit(distance);
    });
    return clear ?? choices[1] ?? up;
  }

  /** The middle of the piece block `index` is part of, as the fort was built (the keep, say). */
  #pieceMiddle(index: number): Vec3 {
    const blocks = this.#round?.fort.blocks ?? [];
    const piece = blocks[index]?.piece;
    const parts = blocks.filter((block) => block.piece === piece);
    const middle = { x: 0, y: 0, z: 0 };
    for (const block of parts) {
      middle.x += block.at[0] / parts.length;
      middle.y += block.at[1] / parts.length;
      middle.z += block.at[2] / parts.length;
    }
    return middle;
  }

  /** Where a kill cam's target is now: a guard's chest, a block, a point. */
  #killPoint(target: KillTarget): THREE.Vector3 {
    const round = this.#round;
    if (round && 'guard' in target) {
      round.guardPose(target.guard, this.#pose);
    } else if (round && 'block' in target) {
      round.blockPose(target.block, this.#pose);
    } else if ('point' in target) {
      return new THREE.Vector3(target.point.x, target.point.y, target.point.z);
    }
    const { x, y, z } = this.#pose.position;
    return new THREE.Vector3(x, y, z);
  }

  /** The middle of the fort on the ground: what scouting looks down on. */
  #fortMiddle(): THREE.Vector3 {
    const blocks = this.#round?.fort.blocks ?? [];
    if (blocks.length === 0) return new THREE.Vector3();
    const zs = blocks.map((block) => block.at[2]);
    return new THREE.Vector3(0, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
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
      if (this.#touch || !this.#round || this.#scout.on) return;
      canvas.setPointerCapture(event.pointerId);
      this.#touch = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        last: { x: event.clientX, y: event.clientY },
        dragging: false,
      };
    });
    canvas.addEventListener('pointermove', (event) => {
      const touch = this.#touch;
      if (!touch || touch.id !== event.pointerId) return;
      if (
        !touch.dragging &&
        Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_PX
      ) {
        touch.dragging = true;
        // Looking around ends any camera work: you're aiming again.
        this.#skipCine();
      }
      if (!touch.dragging) return;
      // A drag turns the view, and the weapon with it: right to turn right, up to look up. It
      // stops at the weapon's limits, so the crosshair never points where the bolt can't go.
      const feel = this.#deps.feel.values;
      const weapon = siegeWeapon(this.#deps.game.data.siege);
      this.#aim = clampAim(
        {
          yaw: this.#aim.yaw + (event.clientX - touch.last.x) * feel.lookYawPerPx * DEG,
          tilt: this.#aim.tilt - (event.clientY - touch.last.y) * feel.lookTiltPerPx * DEG,
        },
        weapon,
        feel,
      );
      touch.last = { x: event.clientX, y: event.clientY };
    });
    const end = (event: PointerEvent) => {
      const touch = this.#touch;
      if (!touch || touch.id !== event.pointerId) return;
      this.#touch = undefined;
      // A tap: back to the sights early.
      if (!touch.dragging) this.#skipCine();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', (event) => {
      if (this.#touch?.id === event.pointerId) this.#touch = undefined;
    });
  }

  /** Fire: the weapon shoots at the crosshair, if it can. */
  #fire(): void {
    if (this.#scout.on) return;
    this.#skipCine();
    if (this.#round?.throw(this.#mode, this.#aim)) this.#ui.picker.hidden = true;
  }

  /** Scout: up over the fort to look down on it, or back down to the weapon. */
  #toggleScout(): void {
    const round = this.#round;
    if (!round) return;
    this.#scout.on = !this.#scout.on;
    this.#deps.logger.log('siege.scout', {
      fort: round.fort.id,
      on: this.#scout.on,
      position: round.position,
      throws: round.throws,
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
    // The last shot's path, on or off (kept on this phone).
    const ghost = button('Ghost line', 'sg-ghost', () => {
      this.#deps.ghost.set(this.#deps.ghost.value === 'on' ? 'off' : 'on');
      this.#deps.logger.log('siege.ghost', { on: this.#deps.ghost.value === 'on' });
    });
    spots.append(ghost);
    controls.append(spots, modes);
    // Fire, big, and Scout, beside the shot buttons.
    const fire = button('Fire', 'sg-fire', () => {
      this.#fire();
    });
    const scout = button('Scout', 'sg-scout', () => {
      this.#toggleScout();
    });
    scout.setAttribute('aria-pressed', 'false');
    const shoot = el('div', 'sg-shoot');
    shoot.append(scout, modes, fire);
    controls.replaceChildren(spots, shoot);
    // The crosshair, over the scene where the weapon's aimed.
    const crosshair = el('div', 'sg-crosshair');
    crosshair.setAttribute('aria-hidden', 'true');
    crosshair.hidden = true;
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
    root.append(crosshair, picker, status, goal, title, hint, controls, card);
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
      fire,
      scout,
      ghost,
      crosshair,
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
    this.#element.dataset.aim = `${(this.#aim.yaw / DEG).toFixed(2)} ${(this.#aim.tilt / DEG).toFixed(2)}`;
    const cine = this.#cine;
    // What the camera's doing: the sights, scouting, the bolt cam, or a kill cam (on a guard, or
    // a collapse).
    this.#element.dataset.camera = !cine
      ? this.#scout.on
        ? 'scout'
        : 'sights'
      : cine.kind === 'bolt'
        ? 'bolt'
        : 'guard' in cine.target
          ? 'kill'
          : 'collapse';
    if (round && this.#now - this.#targetsAt > TARGETS_SECONDS) {
      this.#targetsAt = this.#now;
      this.#element.dataset.targets = JSON.stringify(this.#targetsOnScreen(round));
    }
    if (!round) return;
    const title = this.#title;
    const showing =
      title !== undefined && this.#now >= title.at && this.#now - title.at < TITLE_SECONDS;
    ui.title.hidden = !showing;
    if (title) ui.title.textContent = title.text;
    const aiming = phase === 'aim' && ui.card.hidden;
    ui.controls.hidden = !aiming;
    ui.fire.disabled = !round.canThrow || this.#scout.on;
    ui.scout.setAttribute('aria-pressed', String(this.#scout.on));
    ui.scout.textContent = this.#scout.on ? 'Back' : 'Scout';
    ui.ghost.setAttribute('aria-pressed', String(this.#deps.ghost.value === 'on'));
    for (const { mode, element, cost } of ui.modeButtons) {
      element.setAttribute('aria-checked', String(mode === this.#mode));
      const spears = spearsShot(mode, round.aimed, left, round.weapon);
      cost.textContent = `${String(spears)} spear${spears === 1 ? '' : 's'}`;
      // A short volley: fewer spears left than the shot takes.
      element.dataset.short = String(spears < volleySize(mode, round.aimed, round.weapon));
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
          ? this.#scout.on
            ? 'Scouting: tap Back to aim again'
            : 'Drag to aim, then Fire'
          : '';
    ui.hint.hidden = !ui.card.hidden;
  }

  /**
   * Where the position's targets are on screen (px in the view, off its edges too, `on` if they're
   * in it): its guards' heads, gates and the keep's thin posts. For the e2e tests and screenshots
   * to aim at, as a player would by eye, turning to what's off to one side.
   */
  #targetsOnScreen(round: SiegeRound): { kind: string; x: number; y: number; on: boolean }[] {
    const { clientWidth: width, clientHeight: height } = this.#element;
    const [, tall] = this.#deps.game.data.siege.guard.size;
    const onScreen = (kind: string, at: THREE.Vector3) => {
      const point = at.project(this.#camera);
      return point.z < 1
        ? [
            {
              kind,
              x: Math.round(((point.x + 1) / 2) * width),
              y: Math.round(((1 - point.y) / 2) * height),
              on: Math.abs(point.x) < 1 && Math.abs(point.y) < 1,
            },
          ]
        : [];
    };
    const guards = round.guards.flatMap((guard, index) => {
      if (guard.down || guard.position !== round.position) return [];
      round.guardPose(index, this.#pose);
      const { x, y, z } = this.#pose.position;
      return onScreen('guard', new THREE.Vector3(x, y + tall * 0.42, z));
    });
    const weak = round.blocks.flatMap((block) => {
      if (!block.block.weak || block.broken) return [];
      const [x, y, z] = block.block.at;
      return onScreen(block.block.pieceKind, new THREE.Vector3(x, y, z));
    });
    return [...guards, ...weak];
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
