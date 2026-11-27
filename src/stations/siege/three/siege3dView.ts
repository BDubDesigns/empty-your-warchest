import * as THREE from 'three';
import { BlobShadows, blobTexture } from '../../../app/blobShadows';
import { gpuOf } from '../../../app/deviceHints';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadAnimatedModel, loadModel, type AnimatedModel } from '../../../app/models';
import { scatter, type Placement } from '../../../app/scatter';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import {
  Rng,
  type EventLogger,
  type Game,
  type GraphicsSettings,
  type GraphicsTier,
  type LiveChoice,
  type LiveTuning,
} from '../../../core';
import type { Siege, SiegeFeel, SiegeFort } from '../../../data';
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
  solveAim,
  spearsShot,
  startAim,
  volleySize,
  type Aim,
  type ThrowMode,
  type Vec3,
} from '../logic/throw';
import { buildBallista, type BallistaLook } from './figures';
import { makeTextures, puffTexture, stageTint, whooshUrl } from './looks';
import { capturePointer } from '../../../app/pointer';

export interface Siege3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<SiegeFeel>;
  /** Whether the last shot's path stays drawn, kept on this phone. */
  ghost: LiveChoice<GhostLine>;
  /** The graphics tier: what the siege draws (shadows, debris, dust). Calm frames feed its pick. */
  graphics: GraphicsSettings;
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
/** How long the bow's arms take to snap forward when it shoots (s). */
const SNAP_SECONDS = 0.18;
/** Real seconds the position's name shows when the ballista rolls on. */
const TITLE_SECONDS = 2.4;
/**
 * The camera's blends (0 to 1) at which the sight on screen hides (looking elsewhere), and the
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
  glass: 0x9fd8ec,
  sense: 0xff2a2a,
  stone: 0x9b978d,
  wood: 0xc39a66,
  dust: 0xcdbb9c,
  ghost: 0x7fe8ff,
  spot: 0xffffff,
  spotOn: 0xf0cd5c,
};

/**
 * A block as drawn: on its own (a weak post, the banner, glass, a skinned piece), or one slot of a
 * batch, the blocks of a size and kind drawn at once (damage as their colour; broken, shrunk away).
 */
interface BlockLook {
  object?: THREE.Object3D;
  batch?: { mesh: THREE.InstancedMesh; slot: number };
  kind: MaterialKind;
  stage: number;
  gone: boolean;
}

/** The models the siege's things are skinned with (`skins` in the data), loaded. */
interface Skins {
  gate: THREE.Object3D;
  tower: THREE.Object3D;
  banner: THREE.Object3D;
  ballista: THREE.Object3D;
  spear: THREE.Object3D;
  guard: AnimatedModel;
}

/** A guard as drawn: Kenney's soldier, playing what he's about. */
interface GuardLook {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  clip: string;
  down: boolean;
  downAt: number;
}

/** Beyond this far from the camera (m) a guard's animation isn't played on. */
const ANIMATE_WITHIN = 90;
/** How long a fallen guard's animation runs before it's left on its last frame (s). */
const DIE_SECONDS = 2.5;

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
 * The siege in 3D, seen down the ballista's sights: the sight in the middle of the screen is what
 * a shot hits (Fire allows for the drop), and a drag turns the view and the weapon together. Fire
 * shoots, Aimed or Barrage, with a kick; the camera rides the middle spear, and a kill
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
  readonly #spearMaterials: { shaft: THREE.Material; tip: THREE.Material };
  readonly #ballista: BallistaLook;
  readonly #ghost: THREE.InstancedMesh;
  /**
   * Frames drawn this round, to log how smoothly: all, and while watching a collapse; and the
   * rules' physics time each frame (ms), to tell physics from drawing.
   */
  #perf = newPerf();
  /** The graphics tier drawn at, and its looks (shadows, debris, dust). */
  #tier: GraphicsTier;
  #look: Siege['looks']['tiers']['high'];
  /** Blob shadows (low tier): one per block, one per guard, and the ballista's. */
  #blobs: BlobShadows | undefined;
  readonly #blobTexture = blobTexture();
  /** Every debris chunk is this box, scaled. */
  readonly #debrisBox = new THREE.BoxGeometry(1, 1, 1);
  /** Scratch for the blob shadows' footprints. */
  readonly #footprint = {
    turn: new THREE.Quaternion(),
    axes: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
  };
  /** The kick of the last shot, from 1 (just shot) down to 0 (settled). */
  #kick = 0;
  /** Over each guard's head: "Z z z" while he sleeps, "!" a moment when he's alerted. */
  #marks: {
    zs: { sprite: THREE.Sprite; material: THREE.SpriteMaterial }[];
    bang: THREE.Sprite;
    alertedAt: number;
    /** Red through walls, while a Sense potion lasts or scouting. */
    sense: THREE.Mesh;
  }[] = [];
  /** A Sense potion's red lasts until then (real seconds). */
  #senseUntil = 0;
  readonly #senseMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.sense,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
    depthWrite: false,
  });
  readonly #zzzMaterial = new THREE.SpriteMaterial({
    map: textSprite('z', '#eef4ff'),
  });
  readonly #bangMaterial = new THREE.SpriteMaterial({
    map: textSprite('!', '#ffd23c'),
  });
  /**
   * The flyover as a fort first opens: when it began, the camera's way through the fort and
   * where it looks on the way, and the positions' names to show as it passes each.
   */
  #fly:
    | {
        at: number;
        path: THREE.CatmullRomCurve3;
        looks: THREE.CatmullRomCurve3;
        names: string[];
        shown: number;
      }
    | undefined;
  /** The next round starts with the flyover (a fort opened, not Again). */
  #flyNext = true;
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
  #guards: GuardLook[] = [];
  /** The batches of plain blocks, by size and kind. */
  #batches: THREE.InstancedMesh[] = [];
  readonly #skins: Skins;
  /** Plain blocks in batches: their look per kind (the damage is the colour). */
  readonly #batchMaterials: Record<MaterialKind, THREE.MeshLambertMaterial>;
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
    skins: Skins,
  ) {
    this.#element = element;
    this.#deps = deps;
    this.#skins = skins;
    this.#physics = physics;
    this.#hud = hud;
    const rules = deps.game.data.siege;
    this.#aim = startAim(siegeWeapon(rules));
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'siege');
    this.#skill = station?.skill ?? siegeWeapon(rules).skill;
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    deps.graphics.noteGpu(gpuOf(this.#renderer.getContext()).gpu);
    this.#tier = deps.graphics.tier;
    this.#look = rules.looks.tiers[this.#tier];
    this.#renderer.shadowMap.enabled = this.#look.shadows === 'map';
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'sg-canvas';
    element.dataset.graphics = this.#tier;
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
      glass: [0, 1, 2].map(
        () =>
          new THREE.MeshLambertMaterial({
            color: COLORS.glass,
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
          }),
      ),
    };
    this.#batchMaterials = {
      stone: new THREE.MeshLambertMaterial({ map: this.#textures.stone[0] ?? null }),
      wood: new THREE.MeshLambertMaterial({ map: this.#textures.wood[0] ?? null }),
      glass: new THREE.MeshLambertMaterial({ color: COLORS.glass }),
    };
    const { length, radius } = rules.projectile;
    // A spear's length runs along its local y, as the rules' capsule does, point at +y.
    const tipLength = Math.min(0.22, length * 0.12);
    const shaft = new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, length - tipLength, 6);
    shaft.translate(0, -tipLength / 2, 0);
    const tip = new THREE.ConeGeometry(radius * 1.1, tipLength, 6);
    tip.translate(0, length / 2 - tipLength / 2, 0);
    this.#spearMaterials = {
      shaft: new THREE.MeshLambertMaterial({ color: COLORS.shaft }),
      tip: new THREE.MeshLambertMaterial({ color: COLORS.iron }),
    };
    for (const shared of [
      ...Object.values(this.#materials).flat(),
      this.#debrisBox,
      shaft,
      tip,
      this.#spearMaterials.shaft,
      this.#spearMaterials.tip,
    ]) {
      this.#shared.add(shared);
    }
    const weapon = siegeWeapon(rules);
    this.#ballista = buildBallista(weapon, () => this.#spearMesh());
    this.#ballista.root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.visible = false;
    });
    const carriage = fitted(skins.ballista, weapon.size, rules.skins.ballista);
    carriage.position.y = weapon.size[1] / 2 - weapon.pivotHeight;
    this.#ballista.turn.add(carriage);
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
    deps.graphics.onTier(({ tier }) => {
      this.#applyTier(tier);
    });
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Siege3DDeps): Promise<Siege3DView> {
    const [physics, hud, tree, skins] = await Promise.all([
      loadPhysics(),
      WarchestHud.create(element, {
        game: deps.game,
        item: deps.game.data.siege.item,
        haptics: deps.haptics,
        logger: deps.logger,
      }),
      loadModel(TREE_MODEL),
      loadSkins(deps.game.data.siege.skins),
    ]);
    return new Siege3DView(element, deps, physics, hud, tree, skins);
  }

  /** Loads the physics engine (and starts its wasm) and the models ahead of time, at the camp. */
  static async preload(skins?: Siege['skins']): Promise<void> {
    await Promise.all([
      loadPhysics(),
      WarchestHud.preload(),
      loadModel(TREE_MODEL),
      ...(skins ? [loadSkins(skins)] : []),
    ]);
  }

  // ScreenView

  start(): void {
    restoreContext(this.#renderer);
    this.#hud.wake();
    this.#resize();
    this.#flyNext = true;
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
    this.#perf = newPerf();
    this.#fly = undefined;
    if (this.#flyNext) {
      this.#flyNext = false;
      this.#startFlyover(round);
    }
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
    for (const look of this.#blocks) if (look.object) this.#free(look.object);
    for (const mesh of this.#batches) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.#batches = [];
    this.#blobs?.dispose(true);
    this.#blobs = undefined;
    for (const look of this.#guards) {
      look.mixer.stopAllAction();
      look.mixer.uncacheRoot(look.model);
      this.#free(look.root);
    }
    // The marks' look is shared: only out of the scene.
    for (const mark of this.#marks) {
      for (const z of mark.zs) {
        z.sprite.removeFromParent();
        z.material.dispose();
      }
      mark.bang.removeFromParent();
      mark.sense.removeFromParent();
      mark.sense.geometry.dispose();
    }
    this.#marks = [];
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
    const perf = this.#perf;
    this.#deps.logger.log('siege.perf', {
      fort: result.fort,
      fps: Math.round(perf.frames / Math.max(perf.seconds, 0.001)),
      worstMs: Math.round(perf.worst * 1000),
      collapseFps:
        perf.collapseFrames > 0
          ? Math.round(perf.collapseFrames / Math.max(perf.collapseSeconds, 0.001))
          : undefined,
      drawCalls: perf.calls,
      tier: this.#tier,
      physicsP95Ms: round1(quantile(perf.physicsMs, 0.95)),
      physicsWorstMs: round1(perf.physicsMs.reduce((most, ms) => Math.max(most, ms), 0)),
    });
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

  /**
   * Draws at `tier` from now on: the sun's shadow map or blob shadows, and the debris and dust
   * from here on. Only looks; the round goes on as it was.
   */
  #applyTier(tier: GraphicsTier): void {
    if (tier === this.#tier) return;
    this.#tier = tier;
    this.#look = this.#deps.game.data.siege.looks.tiers[tier];
    this.#element.dataset.graphics = tier;
    const map = this.#look.shadows === 'map';
    this.#renderer.shadowMap.enabled = map;
    this.#sun.castShadow = map;
    if (this.#blobs) this.#blobs.mesh.visible = !map;
    // Every look is built again, with or without the shadows.
    this.#scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const material of [child.material as THREE.Material | THREE.Material[]].flat()) {
        material.needsUpdate = true;
      }
    });
    this.#deps.logger.log('siege.graphics', { tier });
  }

  // World

  #buildWorld(tree: THREE.Object3D): void {
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.fog = new THREE.Fog(COLORS.sky, FOG.near, FOG.far);
    this.#scene.add(new THREE.HemisphereLight(0xeef4ff, 0x4a5a32, 1.35));
    const sun = this.#sun;
    const map = this.#deps.game.data.siege.looks.shadowMap;
    sun.castShadow = this.#look.shadows === 'map';
    sun.shadow.mapSize.set(map.size, map.size);
    const shadow = sun.shadow.camera;
    shadow.left = -map.halfWidth;
    shadow.right = map.halfWidth;
    shadow.top = map.halfHeight;
    shadow.bottom = -map.halfHeight;
    shadow.near = 1;
    shadow.far = map.far;
    sun.shadow.bias = map.bias;
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

  /**
   * The fort's blocks and guards, sized from the rules'. Gates, tower blocks and the banner wear
   * the Castle Kit's pieces; weak posts and glass are drawn on their own; every other block goes in
   * a batch with the others of its size and kind (one draw for them all).
   */
  #buildFort(round: SiegeRound): void {
    const rules = this.#deps.game.data.siege;
    const skinFor = (index: number, kind: string): THREE.Object3D | undefined => {
      if (index === round.bannerIndex) return this.#skins.banner;
      if (kind === 'gate') return this.#skins.gate;
      if (kind === 'tower') return this.#skins.tower;
      return undefined;
    };
    const settingFor = (index: number, kind: string) =>
      index === round.bannerIndex
        ? rules.skins.banner
        : kind === 'gate'
          ? rules.skins.gate
          : rules.skins.tower;
    // First the batches' sizes: how many of each size and kind.
    const keyOf = (index: number) => {
      const state = round.blocks[index];
      if (!state) return undefined;
      const { block } = state;
      const alone =
        skinFor(index, block.pieceKind) !== undefined ||
        (block.weak && Math.max(block.size[0], block.size[2]) < WEAK_BAND_UNDER) ||
        state.kind === 'glass';
      return alone ? undefined : `${block.size.join('x')}:${state.kind}`;
    };
    const counts = new Map<string, number>();
    round.blocks.forEach((_, index) => {
      const key = keyOf(index);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const batches = new Map<string, { mesh: THREE.InstancedMesh; next: number }>();
    this.#blocks = round.blocks.map((state, index) => {
      const [width, height, depth] = state.block.size;
      const key = keyOf(index);
      if (key) {
        let batch = batches.get(key);
        if (!batch) {
          const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(width, height, depth),
            this.#batchMaterials[state.kind],
            counts.get(key) ?? 1,
          );
          mesh.castShadow = mesh.receiveShadow = true;
          // Their boxes move with the fort: bounds are worked out afresh, not from the start.
          mesh.frustumCulled = false;
          this.#fortGroup.add(mesh);
          this.#batches.push(mesh);
          batch = { mesh, next: 0 };
          batches.set(key, batch);
        }
        const slot = batch.next++;
        batch.mesh.setColorAt(slot, stageTint(COLORS[state.kind], 0));
        return { batch: { mesh: batch.mesh, slot }, kind: state.kind, stage: 0, gone: false };
      }
      const skin = skinFor(index, state.block.pieceKind);
      let object: THREE.Object3D;
      if (skin) {
        object = fitted(skin, state.block.size, settingFor(index, state.block.pieceKind));
      } else {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(width, height, depth),
          this.#materials[state.kind][0],
        );
        mesh.castShadow = mesh.receiveShadow = state.kind !== 'glass';
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
        object = mesh;
      }
      this.#fortGroup.add(object);
      return { object, kind: state.kind, stage: 0, gone: false };
    });
    for (const mesh of this.#batches) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const size = rules.guard.size;
    this.#guards = round.guards.map(() => {
      const look = this.#guardLook(size);
      this.#fortGroup.add(look.root);
      return look;
    });
    const [width, height, depth] = size;
    this.#marks = round.guards.map(() => {
      const zs = [0, 1, 2].map(() => {
        const material = this.#zzzMaterial.clone();
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 5;
        this.#effects.add(sprite);
        return { sprite, material };
      });
      const bang = new THREE.Sprite(this.#bangMaterial);
      bang.renderOrder = 5;
      const sense = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        this.#senseMaterial,
      );
      sense.renderOrder = 20;
      sense.visible = false;
      this.#effects.add(bang, sense);
      return { zs, bang, alertedAt: -Infinity, sense };
    });
    // A blob under each block and guard, and one under the ballista (shown on the low tier).
    this.#blobs = new BlobShadows(
      round.blocks.length + round.guards.length + 1,
      rules.looks.blobShadows.opacity,
      this.#blobTexture,
    );
    this.#blobs.mesh.visible = this.#look.shadows === 'blob';
    this.#effects.add(this.#blobs.mesh);
    this.#drawBodies();
  }

  /**
   * A guard: Kenney's soldier (cloned with his skeleton), scaled evenly to the guard's height, his
   * feet at the bottom of the rules' box, with his own mixer for his clips.
   */
  #guardLook(size: readonly [number, number, number]): GuardLook {
    const skin = this.#deps.game.data.siege.skins.guard;
    const model = SkeletonUtils.clone(this.#skins.guard.scene);
    const bounds = new THREE.Box3().setFromObject(model);
    const tall = Math.max(bounds.max.y - bounds.min.y, 0.001);
    model.scale.setScalar(size[1] / tall);
    model.rotation.y = skin.turn * DEG;
    model.position.y = -size[1] / 2;
    model.traverse((child) => {
      child.castShadow = true;
    });
    const root = new THREE.Group();
    root.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.#skins.guard.animations) actions.set(clip.name, mixer.clipAction(clip));
    return { root, model, mixer, actions, clip: '', down: false, downAt: 0 };
  }

  /** Plays `name` on a guard, crossfading from what he was playing. */
  #playClip(look: GuardLook, name: string): void {
    if (look.clip === name) return;
    const next = look.actions.get(name);
    if (!next) return;
    const previous = look.actions.get(look.clip);
    next.reset();
    if (name === this.#deps.game.data.siege.skins.guard.clips.down) {
      // Down: once through, and left lying on its last frame.
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    next.play();
    if (previous) next.crossFadeFrom(previous, 0.2, false);
    look.clip = name;
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
    // The ballista model's bolt, its length along y (as the rules' capsule) and the rules' length.
    const group = new THREE.Group();
    const bolt = this.#skins.spear.clone(true);
    const size = new THREE.Box3().setFromObject(bolt).getSize(new THREE.Vector3());
    const long = Math.max(size.x, size.y, size.z, 0.001);
    // Its length the spear's; half as thick as that would make it, so it reads as a bolt.
    const along = this.#deps.game.data.siege.projectile.length / long;
    bolt.scale.set(along, along * 0.5, along * 0.5);
    bolt.rotation.z = Math.PI / 2;
    bolt.traverse((child) => {
      child.castShadow = true;
    });
    group.add(bolt);
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
        // The string snaps and the frame thumps: a kick you feel.
        this.#play('release', 0.8, event.mode === 'barrage' ? -300 : 0);
        this.#play('wind', 0.6, 700);
        this.#kick = 1;
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
          look.downAt = this.#now;
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
      case 'alerted': {
        const mark = this.#marks[event.guard];
        if (mark) mark.alertedAt = this.#now;
        this.#play(event.woke ? 'creak' : 'wind', 0.35, event.woke ? 400 : 900);
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
    if (look.object) look.object.visible = false;
    if (look.batch) {
      look.batch.mesh.setMatrixAt(look.batch.slot, new THREE.Matrix4().makeScale(0, 0, 0));
      look.batch.mesh.instanceMatrix.needsUpdate = true;
    }
    if (kind === 'glass') {
      // A bright, high shatter.
      this.#play('break-stone', 0.6, 1400);
      this.#play('star', 0.4, 900);
    } else {
      this.#play(
        kind === 'stone' ? 'break-stone' : 'break-wood',
        0.55,
        kind === 'stone' ? -900 : 0,
      );
    }
    this.#stop(feel.heavyHitStopMs);
    this.#deps.haptics.pulse(feel.buzzBreakMs);
    this.#shake = Math.max(this.#shake, 0.06 * feel.shakeStrength);
    const [width, height, depth] = state.block.size;
    this.#dust(at, Math.round(feel.dust * 1.6), Math.max(width, height) * 0.8);
    const base = this.#materials[kind][2] ?? this.#materials[kind][0];
    if (!base) return;
    const { debrisPieces, maxDebris } = this.#look;
    for (let piece = 0; piece < debrisPieces && this.#debris.length < maxDebris; piece++) {
      const material = base.clone();
      material.transparent = true;
      // One box for every chunk, scaled to its size.
      const mesh = new THREE.Mesh(this.#debrisBox, material);
      mesh.scale.set(
        width * (0.25 + Math.random() * 0.2),
        height * (0.3 + Math.random() * 0.2),
        depth * (0.3 + Math.random() * 0.2),
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
    const { dustShare, maxPuffs } = this.#look;
    const puffs = Math.round(count * dustShare);
    for (let index = 0; index < puffs && this.#puffs.length < maxPuffs; index++) {
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
    const frameDt = this.#timer.getDelta();
    const realDt = Math.min(frameDt, 0.05);
    // How smoothly it draws: overall, and while the camera watches a collapse (the heaviest).
    const perf = this.#perf;
    perf.frames++;
    perf.seconds += frameDt;
    perf.worst = Math.max(perf.worst, frameDt);
    if (this.#element.dataset.camera === 'collapse') {
      perf.collapseFrames++;
      perf.collapseSeconds += frameDt;
    }
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
    const physicsFrom = performance.now();
    round?.advance(dt);
    perf.physicsMs.push(performance.now() - physicsFrom);
    // Calm frames (aiming down the sights, no camera work, nothing slowed) tell the graphics tier
    // how this phone copes.
    if (
      round?.phase === 'aim' &&
      !this.#cine &&
      !this.#fly &&
      !this.#scout.on &&
      !frozen &&
      scale === 1
    ) {
      this.#deps.graphics.sample(realDt * 1000);
    }
    const finished = this.#finished;
    if (finished && this.#now >= finished.at) {
      this.#finished = undefined;
      this.#showCard(finished.result);
    }
    this.#drawBodies();
    this.#animateGuards(dt);
    this.#drawBallista(realDt);
    this.#drawBlobs();
    this.#drawAim();
    // The ghost keeps its width on screen as the camera moves.
    if (this.#ghost.visible && this.#trailPoints.length > 1) this.#drawGhost();
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
    perf.calls = Math.max(perf.calls, this.#renderer.info.render.calls);
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
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.#blocks.forEach((look, index) => {
      if (look.gone) return;
      round.blockPose(index, pose);
      const state = round.blocks[index];
      const share = state ? state.hp / state.maxHp : 1;
      const stage = share > 0.66 ? 0 : share > 0.33 ? 1 : 2;
      // Crumbling: a touch smaller, as if chips have come off.
      const shrink = stage === 2 ? 0.94 : 1;
      if (look.batch) {
        at.set(pose.position.x, pose.position.y, pose.position.z);
        turn.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
        look.batch.mesh.setMatrixAt(
          look.batch.slot,
          matrix.compose(at, turn, scale.setScalar(shrink)),
        );
        if (stage !== look.stage) {
          look.stage = stage;
          look.batch.mesh.setColorAt(look.batch.slot, stageTint(COLORS[look.kind], stage));
          if (look.batch.mesh.instanceColor) look.batch.mesh.instanceColor.needsUpdate = true;
        }
        return;
      }
      if (!look.object) return;
      place(look.object);
      if (
        stage !== look.stage &&
        index !== round.bannerIndex &&
        look.object instanceof THREE.Mesh
      ) {
        look.stage = stage;
        const material = this.#materials[look.kind][stage];
        if (material) look.object.material = material;
        look.object.scale.setScalar(shrink);
      }
    });
    for (const mesh of this.#batches) mesh.instanceMatrix.needsUpdate = true;
    const feel = this.#deps.feel.values;
    const [, tall] = this.#deps.game.data.siege.guard.size;
    this.#guards.forEach((look, index) => {
      round.guardPose(index, pose);
      place(look.root);
      const state = round.guards[index];
      const mark = this.#marks[index];
      if (!state || !mark) return;
      this.#poseGuard(look, state);
      const head = new THREE.Vector3(pose.position.x, pose.position.y + tall / 2, pose.position.z);
      const asleep = state.walker.mode === 'sleep' && !state.down;
      mark.zs.forEach((z, order) => {
        // Each Z rises from his head, drifting and growing, fading in and out; then the next.
        const share = (this.#now / Math.max(feel.zzzSeconds, 0.1) + order / mark.zs.length) % 1;
        z.sprite.visible = asleep;
        z.sprite.position
          .copy(head)
          .add(
            new THREE.Vector3(
              0.1 + Math.sin(share * Math.PI * 2 + order) * feel.zzzDrift,
              0.15 + share * feel.zzzRise,
              0,
            ),
          );
        const grow = feel.zzzSize * (0.6 + share * 0.7);
        // The letter sits in a canvas twice as wide as it is tall.
        z.sprite.scale.set(grow * 2, grow, 1);
        z.material.opacity = Math.sin(share * Math.PI);
      });
      // Red through walls while a Sense potion lasts, or scouting.
      const sensing = this.#now < this.#senseUntil || this.#scout.blend > 0.3;
      mark.sense.visible = sensing && !state.down;
      mark.sense.position.set(pose.position.x, pose.position.y, pose.position.z);
      mark.sense.quaternion.copy(look.root.quaternion);
      mark.bang.visible = !state.down && this.#now - mark.alertedAt < feel.markSeconds;
      mark.bang.position.copy(head).add(new THREE.Vector3(0, feel.markSize * 0.8, 0));
      mark.bang.scale.set(feel.markSize, feel.markSize, 1);
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

  /**
   * The blob shadows (low tier): under every block and guard, where the rules have it, and under
   * the ballista. Each is its thing's footprint on the ground, shrinking away as it rises.
   */
  #drawBlobs(): void {
    const blobs = this.#blobs;
    const round = this.#round;
    if (!blobs?.mesh.visible || !round) return;
    const rules = this.#deps.game.data.siege;
    const { spread, lift, fadeHeight } = rules.looks.blobShadows;
    const pose = this.#pose;
    const { turn, axes } = this.#footprint;
    let index = 0;
    const under = (size: readonly [number, number, number]) => {
      turn.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      const [across, up, along] = axes as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      across.set(size[0], 0, 0).applyQuaternion(turn);
      up.set(0, size[1], 0).applyQuaternion(turn);
      along.set(0, 0, size[2]).applyQuaternion(turn);
      // Lined up with its width as it lies (or its depth, if the width points up).
      const lying = Math.hypot(across.x, across.z) > 0.1 * size[0] ? across : along;
      const length = Math.max(Math.hypot(lying.x, lying.z), 1e-6);
      const ux = lying.x / length;
      const uz = lying.z / length;
      // Its extent along that way and across it, and how high its lowest corner is.
      const extent = (x: number, z: number) =>
        axes.reduce((sum, axis) => sum + Math.abs(axis.x * x + axis.z * z), 0);
      const bottom = pose.position.y - axes.reduce((sum, axis) => sum + Math.abs(axis.y), 0) / 2;
      const left = Math.min(Math.max(1 - bottom / fadeHeight, 0), 1) * spread;
      blobs.place(
        index++,
        pose.position.x,
        pose.position.z,
        extent(ux, uz) * left,
        extent(-uz, ux) * left,
        Math.atan2(-uz, ux),
        lift,
      );
    };
    this.#blocks.forEach((look, block) => {
      const state = round.blocks[block];
      if (look.gone || !state) {
        blobs.place(index++, 0, 0, 0);
        return;
      }
      round.blockPose(block, pose);
      under(state.block.size);
    });
    round.guards.forEach((_, guard) => {
      round.guardPose(guard, pose);
      under(rules.guard.size);
    });
    const at = this.#lastBallista;
    const [width, , depth] = round.weapon.size;
    blobs.place(index++, at.x, at.z, width * spread, depth * spread, -this.#aim.yaw, lift);
    blobs.commit();
  }

  /**
   * A guard's clip for what he's about, and which way he faces: at the ballista, or the way he's
   * walking. Down, he's drawn lying where his body lies (his die clip does the falling).
   */
  #poseGuard(look: GuardLook, state: SiegeRound['guards'][number]): void {
    const skin = this.#deps.game.data.siege.skins.guard;
    const { walker } = state;
    const [width, height, depth] = this.#deps.game.data.siege.guard.size;
    let clip: keyof typeof skin.clips = 'stand';
    let facing = 0;
    if (state.down) clip = 'down';
    else if (walker.mode === 'sleep') clip = 'sleep';
    else if (walker.mode === 'waking') clip = 'waking';
    else if (walker.mode === 'patrol' && walker.timer <= 0 && state.guard.walk) {
      clip = 'patrol';
      facing = walker.heading * 90;
    } else if (walker.mode === 'alert' && state.guard.walk) {
      if (walker.step === 'dash') {
        clip = 'dash';
        facing = Math.sign(walker.to - walker.x) * 90;
      } else clip = walker.step === 'duck' ? 'duck' : 'lean';
    }
    this.#playClip(look, skin.clips[clip]);
    look.model.rotation.y = (skin.turn + facing) * DEG;
    if (state.down && !look.down) {
      look.down = true;
      look.downAt = this.#now;
    }
    if (state.down) {
      // Lying: upright as drawn (the clip lies him down), his feet on what's under the body.
      look.root.quaternion.identity();
      look.model.position.y = -Math.min(width, depth) / 2;
    } else {
      look.model.position.y = -height / 2;
    }
  }

  /** The guards' animations, on time's own clock (slowed with it); not the far off or long down. */
  #animateGuards(dt: number): void {
    const eye = this.#camera.position;
    for (const look of this.#guards) {
      if (look.down && this.#now - look.downAt > DIE_SECONDS) continue;
      if (look.root.position.distanceTo(eye) > ANIMATE_WITHIN) continue;
      look.mixer.update(dt);
    }
  }

  /** The solid line along the last shot's path, `ghostWidth` thick. */
  #drawGhost(): void {
    const feel = this.#deps.feel.values;
    // Metres a pixel spans at a metre off, so each segment can be made wide enough to see.
    const perPixel =
      (2 * Math.tan((this.#camera.fov * DEG) / 2)) / Math.max(this.#element.clientHeight, 1);
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
      const middle = from.clone().lerp(to, 0.5);
      const far = middle.distanceTo(this.#camera.position);
      const width = Math.max(feel.ghostWidth, far * perPixel * feel.ghostPx);
      matrix.compose(middle, turn, new THREE.Vector3(width, width, length));
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
   * points, `reticleSize` across, or as wide as a barrage's spread if that's wider. The last
   * shot's path shows if it's turned on.
   */
  #drawAim(): void {
    const round = this.#round;
    const ui = this.#ui;
    const feel = this.#deps.feel.values;
    // Not while riding the spear that's drawing it: from just behind, it'd fill the screen.
    this.#ghost.visible = this.#deps.ghost.value === 'on' && this.#cine?.kind !== 'bolt';
    const sighting = Math.max(this.#cineBlend, this.#scout.blend) < SIGHT_SHOWS_UNDER;
    const showing =
      round !== undefined && round.phase === 'aim' && ui.card.hidden && !this.#scout.on && sighting;
    ui.crosshair.hidden = !showing;
    if (!showing) return;
    const half = Math.tan((this.#camera.fov * DEG) / 2);
    const spread =
      this.#mode === 'barrage'
        ? (Math.tan(feel.barrageSpread * DEG) / half) * (this.#element.clientHeight / 2)
        : 0;
    const radius = Math.max(spread, feel.reticleSize / 2, CROSSHAIR_PX / 2);
    ui.crosshair.style.width = ui.crosshair.style.height = `${String(radius * 2)}px`;
    ui.crosshair.dataset.mode = this.#mode;
  }

  /**
   * The raycaster's nearest hit on a block of the fort that's still standing (broken blocks only
   * hide), within `far`: what a camera mustn't end up inside. Guards don't count.
   */
  #wallHit(far = Infinity): THREE.Intersection | undefined {
    this.#raycaster.far = far;
    const standing: THREE.Object3D[] = this.#blocks.flatMap((look) =>
      !look.gone && look.object ? [look.object] : [],
    );
    const [hit] = this.#raycaster.intersectObjects([...standing, ...this.#batches], true);
    this.#raycaster.far = Infinity;
    return hit;
  }

  #updateEffects(dt: number): void {
    const gravity = this.#deps.game.data.siege.physics.gravity;
    const { debrisSeconds } = this.#look;
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
      if (piece.age >= debrisSeconds) {
        // The box is shared: only its own look goes.
        piece.mesh.removeFromParent();
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
      piece.material.opacity = Math.min(1, (debrisSeconds - piece.age) / 0.5);
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
    this.#updateFlyover();
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
    // A shot's kick: the view jolts back and up, and settles.
    this.#kick = Math.max(0, this.#kick - dt / Math.max(feel.kickSeconds, 0.01));
    const kick = this.#kick * this.#kick;
    this.#camera.position.addScaledVector(forward, -feel.kickBack * kick);
    this.#camera.lookAt(look);
    this.#camera.rotateX(feel.kickTilt * DEG * kick);
    if (this.#camera.fov !== feel.sightFov || this.#camera.near !== feel.sightNear) {
      this.#camera.fov = feel.sightFov;
      this.#camera.near = feel.sightNear;
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
    // The flyover has the camera.
    if (this.#fly) return;
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

  /**
   * The flyover: a way over the fort built from its own data, so any fort gets one. From high
   * behind the weapon, over each position's guards in turn (its name shown as it passes), to the
   * keep with the banner, and back down to the sights.
   */
  #startFlyover(round: SiegeRound): void {
    const feel = this.#deps.feel.values;
    const fort = round.fort;
    const above = (at: THREE.Vector3) =>
      at.clone().add(new THREE.Vector3(0, feel.flyoverHeight, feel.flyoverBack));
    const middle = (points: THREE.Vector3[]) =>
      points
        .reduce((sum, point) => sum.add(point), new THREE.Vector3())
        .divideScalar(points.length);
    const stops = fort.positions.map((position, index) => {
      const guards = position.guards.map(({ at }) => new THREE.Vector3(at[0], at[1] + 1, at[2]));
      if (guards.length > 0) return middle(guards);
      // No guards (the keep): what holds the banner up.
      if (index === fort.positions.length - 1 && round.bannerIndex >= 0) {
        const keep = this.#pieceMiddle(round.bannerIndex);
        return new THREE.Vector3(keep.x, keep.y, keep.z);
      }
      const [x, z] = position.spots[0] ?? [0, 0];
      return new THREE.Vector3(x, 1, z - 20);
    });
    const start = this.#lastBallista;
    const from = new THREE.Vector3(start.x, feel.flyoverHeight * 1.5, start.z + feel.flyoverBack);
    const first = stops[0] ?? new THREE.Vector3();
    this.#fly = {
      at: this.#now,
      path: new THREE.CatmullRomCurve3([from, ...stops.map(above)]),
      looks: new THREE.CatmullRomCurve3([first.clone(), ...stops]),
      names: fort.positions.map((position) => position.name),
      shown: -1,
    };
    this.#cine = undefined;
    this.#cineBlend = 0;
  }

  /** The flyover's camera, while it lasts; then back down to the sights, as camera work eases. */
  #updateFlyover(): void {
    const fly = this.#fly;
    if (!fly) return;
    const feel = this.#deps.feel.values;
    const share = Math.min((this.#now - fly.at) / Math.max(feel.flyoverSeconds, 0.1), 1);
    const eased = share * share * (3 - 2 * share);
    fly.path.getPoint(eased, this.#cinePose.position);
    fly.looks.getPoint(eased, this.#cinePose.look);
    this.#cineBlend = 1;
    // Each position's name as the camera comes over it.
    const passing = Math.min(Math.floor(eased * fly.names.length), fly.names.length - 1);
    if (passing !== fly.shown) {
      fly.shown = passing;
      const name = fly.names[passing];
      if (name) this.#title = { text: name, at: this.#now };
    }
    if (share >= 1) this.#endFlyover(false);
  }

  /** The flyover's over (or skipped): the camera eases back down to the sights. */
  #endFlyover(skipped: boolean): void {
    const fly = this.#fly;
    const round = this.#round;
    if (!fly || !round) return;
    this.#fly = undefined;
    this.#cine = {
      kind: 'kill',
      target: {
        point: { x: this.#cinePose.look.x, y: this.#cinePose.look.y, z: this.#cinePose.look.z },
      },
      at: this.#now,
      seconds: 0,
    };
    this.#cineOut = true;
    this.#deps.logger.log('siege.flyover', {
      fort: round.fort.id,
      skipped,
      seconds: Math.round((this.#now - fly.at) * 10) / 10,
      of: this.#deps.feel.values.flyoverSeconds,
    });
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
      if (!capturePointer(canvas, event.pointerId)) return;
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
      if (!touch.dragging) {
        if (this.#fly) this.#endFlyover(true);
        else this.#skipCine();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', (event) => {
      if (this.#touch?.id === event.pointerId) this.#touch = undefined;
    });
  }

  /** Fire: the weapon shoots at the crosshair, if it can. */
  #fire(): void {
    const round = this.#round;
    if (this.#scout.on || this.#fly || !round) return;
    this.#skipCine();
    const rules = this.#deps.game.data.siege;
    const aim = solveAim(
      round.ballista(),
      this.#sightTarget(),
      siegeWeapon(rules),
      rules.physics.gravity,
    );
    if (round.throw(this.#mode, aim)) this.#ui.picker.hidden = true;
  }

  /**
   * What the sight is on: the first block, guard or patch of ground along the view down the
   * sights, or `aimFallback` metres out along it if there's nothing.
   */
  #sightTarget(): Vec3 {
    const feel = this.#deps.feel.values;
    const weapon = siegeWeapon(this.#deps.game.data.siege);
    const at = this.#lastBallista;
    const way = aimDirection(this.#aim);
    const forward = new THREE.Vector3(way.x, way.y, way.z);
    const eye = new THREE.Vector3(at.x, weapon.pivotHeight, at.z).addScaledVector(
      forward,
      -feel.sightBack,
    );
    this.#raycaster.set(eye, forward);
    this.#raycaster.far = feel.aimFallback;
    const hits = this.#raycaster.intersectObjects(this.#fortGroup.children, true);
    this.#raycaster.far = Infinity;
    const hit = hits.find((entry) => {
      for (let node: THREE.Object3D | null = entry.object; node; node = node.parent) {
        if (!node.visible) return false;
      }
      return true;
    });
    const ground = this.#raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
    const point =
      hit?.point ??
      (ground && ground.distanceTo(eye) < feel.aimFallback
        ? ground
        : eye.clone().addScaledVector(forward, feel.aimFallback));
    return { x: point.x, y: point.y, z: point.z };
  }

  /** A Sense potion: one from the warchest, and every guard shows in red through walls a while. */
  #drinkPotion(): void {
    const { game } = this.#deps;
    const rules = game.data.siege;
    const round = this.#round;
    if (!round || this.#now < this.#senseUntil || game.inventory.count(rules.potion) < 1) return;
    game.removeItems(rules.potion, 1);
    const seconds = this.#deps.feel.values.senseSeconds;
    this.#senseUntil = this.#now + seconds;
    this.#play('creak', 0.4, 1200);
    this.#deps.logger.log('siege.potion', {
      fort: round.fort.id,
      position: round.position,
      throws: round.throws,
      seconds,
      left: game.inventory.count(rules.potion),
    });
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
    // A Sense potion: every guard in red through walls for a while (shown when there's one).
    const potion = button('Sense', 'sg-potion', () => {
      this.#drinkPotion();
    });
    spots.append(potion);
    const shoot = el('div', 'sg-shoot');
    shoot.append(scout, modes, fire);
    controls.replaceChildren(spots, shoot);
    // The crosshair, over the scene where the weapon's aimed.
    const crosshair = el('div', 'sg-crosshair');
    crosshair.innerHTML =
      '<svg viewBox="0 0 100 100"><circle class="sg-ring" cx="50" cy="50" r="46"/>' +
      '<path class="sg-ticks" d="M50 4V36M50 64V96M4 50H36M64 50H96M50 14h-6M50 14h6M50 86h-6M50 86h6M14 50v-6M14 50v6M86 50v-6M86 50v6"/>' +
      '<circle class="sg-dot" cx="50" cy="50" r="2.2"/></svg>';
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
      potion,
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
          this.#flyNext = true;
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
    if (this.#fly) this.#element.dataset.camera = 'flyover';
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
    const aiming = phase === 'aim' && ui.card.hidden && !this.#fly;
    ui.controls.hidden = !aiming;
    ui.fire.disabled = !round.canThrow || this.#scout.on;
    ui.scout.setAttribute('aria-pressed', String(this.#scout.on));
    ui.scout.textContent = this.#scout.on ? 'Back' : 'Scout';
    ui.ghost.setAttribute('aria-pressed', String(this.#deps.ghost.value === 'on'));
    const potions = this.#deps.game.inventory.count(rules.potion);
    const senseLeft = this.#senseUntil - this.#now;
    ui.potion.hidden = potions < 1 && senseLeft <= 0;
    ui.potion.disabled = senseLeft > 0;
    ui.potion.setAttribute('aria-pressed', String(senseLeft > 0));
    ui.potion.textContent =
      senseLeft > 0 ? `Sense ${String(Math.ceil(senseLeft))}s` : `Sense ×${String(potions)}`;
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

/** A word drawn on a canvas, outlined so it reads against sky and stone, for a sprite. */
function textSprite(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.font = '900 92px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 12;
    context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    context.strokeText(text, 128, 66);
    context.fillStyle = color;
    context.fillText(text, 128, 66);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Loads the models the siege's things wear (each once, shared). */
async function loadSkins(skins: Siege['skins']): Promise<Skins> {
  const [gate, tower, banner, ballista, spearModel, guard] = await Promise.all([
    loadModel(skins.gate.model),
    loadModel(skins.tower.model),
    loadModel(skins.banner.model),
    loadModel(skins.ballista.model),
    loadModel(skins.bolt.model),
    loadAnimatedModel(skins.guard.model),
  ]);
  // The spear is one part of its model (the ballista's bolt), by name.
  const part = skins.bolt.node ? spearModel.getObjectByName(skins.bolt.node) : undefined;
  const spear = (part ?? spearModel).clone(true);
  spear.position.set(0, 0, 0);
  spear.rotation.set(0, 0, 0);
  return { gate, tower, banner, ballista, spear, guard };
}

/**
 * A model as the skin of a box `size` (width, height, depth) with its middle at the origin:
 * turned `turn` degrees, then stretched to the box on every axis (`box`) or scaled evenly to its
 * height (`height`), and centred on it.
 */
function fitted(
  model: THREE.Object3D,
  size: readonly [number, number, number],
  skin: { fit: 'box' | 'height'; turn: number },
): THREE.Group {
  const turned = new THREE.Group();
  const copy = model.clone(true);
  copy.rotation.y = skin.turn * DEG;
  turned.add(copy);
  turned.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(turned);
  const native = bounds.getSize(new THREE.Vector3());
  const middle = bounds.getCenter(new THREE.Vector3());
  const scale =
    skin.fit === 'box'
      ? new THREE.Vector3(
          size[0] / Math.max(native.x, 0.001),
          size[1] / Math.max(native.y, 0.001),
          size[2] / Math.max(native.z, 0.001),
        )
      : new THREE.Vector3().setScalar(size[1] / Math.max(native.y, 0.001));
  const holder = new THREE.Group();
  holder.scale.copy(scale);
  holder.add(turned);
  const outer = new THREE.Group();
  // Centred: the shift is inside the scaling, so it's the unscaled middle.
  turned.position.copy(middle).negate();
  outer.add(holder);
  outer.traverse((child) => {
    child.castShadow = child.receiveShadow = true;
  });
  return outer;
}

/** A round's frame record, empty. */
function newPerf() {
  return {
    frames: 0,
    seconds: 0,
    worst: 0,
    collapseFrames: 0,
    collapseSeconds: 0,
    calls: 0,
    physicsMs: [] as number[],
  };
}

/** The value `share` of the way up `values` once sorted (0 if there are none). */
function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
