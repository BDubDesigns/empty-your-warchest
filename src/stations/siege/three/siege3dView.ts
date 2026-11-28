import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BlobShadows, blobTexture } from '../../../app/blobShadows';
import { gpuOf } from '../../../app/deviceHints';
import type { Haptics } from '../../../app/haptics';
import { loadAnimatedModel, loadModel, type AnimatedModel } from '../../../app/models';
import { capturePointer } from '../../../app/pointer';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import {
  buildCastleScene,
  type CastleScene,
  type CastlePartLook,
} from '../../../castle/view/castleScene';
import type {
  EventLogger,
  Game,
  GraphicsSettings,
  GraphicsTier,
  LiveChoice,
  LiveTuning,
} from '../../../core';
import type { Castle, Siege, SiegeFeel } from '../../../data';
import type { GhostLine } from '../feel';
import type { BodyShape } from '../logic/castleBodies';
import { objectiveText } from '../logic/objectives';
import { loadPhysics, type Physics } from '../logic/physics';
import {
  SiegeRound,
  type MaterialKind,
  type PartMode,
  type Pose,
  type SiegeEvent,
  type SiegeResult,
} from '../logic/round';
import {
  aimedVolley,
  siegeWeapon,
  solveAim,
  spearsShot,
  volleySize,
  type ThrowMode,
  type Vec3,
} from '../logic/throw';
import { puffTexture, stageTint, whooshUrl } from './looks';

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
/** The last shot's line, and the spears, show from this far from the camera on (m). */
const GHOST_NEAR = 8;
/** A touch that moves less than this (px) is a tap (it skips the kill look), not an aim. */
const TAP_PX = 10;
/** The crosshair's ring: its least size on screen (px). */
const CROSSHAIR_PX = 30;
/** Real seconds a title (an objective done) shows. */
const TITLE_SECONDS = 2.4;
/** How often the targets on screen are noted for the e2e tests and screenshots (s). */
const TARGETS_SECONDS = 0.25;
/** Least gap between two hit-stops (s), so a volley doesn't stutter. */
const STOP_GAP = 0.25;
/** Beyond this far from the camera (m) a guard's animation isn't played on. */
const ANIMATE_WITHIN = 140;
/** How long a fallen guard's animation runs before it's left on its last frame (s). */
const DIE_SECONDS = 2.5;
/** Frames drawn (textures uploaded) before what it costs to draw is measured. */
const MEASURE_FRAMES = 4;
/** How far out in front of the captain his gold mark hangs (m). */
const MARK_OUT = 0.8;
const COLORS = {
  sense: 0xff2a2a,
  stone: 0x9b978d,
  wood: 0xc39a66,
  dust: 0xcdbb9c,
  ghost: 0x7fe8ff,
};

/**
 * How sharp the castle's textures are at a slant (three.js keeps it to what the GPU can do).
 */
const ANISOTROPY = 4;

/**
 * The castle built ahead of time (at the camp, by `preload`), and the tier it's built for: the
 * siege takes it when it opens, so the War tent opens without building it then.
 */
let early: { tier: GraphicsTier; scene: Promise<CastleScene> } | undefined;

/** The castle at `tier`: the one built ahead of time if it's for that tier, or built now. */
function castleFor(castle: Castle, tier: GraphicsTier): Promise<CastleScene> {
  const ready = early;
  early = undefined;
  if (ready?.tier === tier) return ready.scene;
  if (ready) {
    void ready.scene.then(
      (scene) => {
        scene.dispose();
      },
      () => undefined,
    );
  }
  return buildCastleScene(castle, tier, ANISOTROPY);
}

/** The models the siege's things wear (`skins` in the data), loaded. */
interface Skins {
  spear: THREE.Object3D;
  guard: AnimatedModel;
}

/** A guard (or the captain) as drawn: Kenney's soldier, playing what he's about. */
interface GuardLook {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  clip: string;
  down: boolean;
  downAt: number;
  /** His own outline in red, drawn through walls while a Sense potion lasts. */
  sense: THREE.Object3D[];
  /** The captain's gold mark over his head. */
  mark: THREE.Sprite | undefined;
  /** His own materials (the captain's gold), freed with him. */
  owned: THREE.Material[];
}

/**
 * A castle part as the siege draws it: the castle's look of it (or the spear rack's group), where
 * that look was as built (an instance's matrix), and the rules' frame for it as built, inverted:
 * so drawn now it's the rules' frame now, times the two.
 */
interface PartLook {
  look: CastlePartLook | { kind: 'rack'; object: THREE.Object3D } | undefined;
  built: THREE.Matrix4;
  unframe: THREE.Matrix4;
  /** What's fixed to it (slits, doorways, ivy), as built. */
  fixed: { look: CastlePartLook; built: THREE.Matrix4 }[];
  mode: PartMode;
  stage: number;
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

/** What the kill look turns to: a guard, or a point (a collapse). */
type KillTarget = { guard: number } | { point: Vec3 };

/**
 * The kill look: from where the camera stands, it turns to `target` and zooms in, for `seconds`
 * (real), then eases back (`out`). `blend` is how far it's turned there (0 to 1).
 */
interface Look {
  target: KillTarget;
  at: number;
  seconds: number;
  out: boolean;
}

/** A finger on the scene: where it went down, where it was last, and whether it's dragging. */
interface Touch {
  id: number;
  x: number;
  y: number;
  last: { x: number; y: number };
  dragging: boolean;
}

/**
 * The siege in 3D, at the castle: the camera is fixed at one of its vantage points (Hill, Low
 * ground, Siege tower; switch between them any time), and a drag moves the crosshair over the view.
 * Fire shoots at what's under it, Aimed or Barrage (allowing for the drop), with a kick. A kill (or a
 * collapse) gets a freeze and a slow-motion look, the camera turning to it from where it stands. The
 * last shot's real path can stay as a solid line, so you learn the drop. The rules (SiegeRound, a
 * Rapier physics world) decide everything; this draws the castle's parts, the guards and the spears
 * where it says and adds the juice: hit-stop, shake, dust, debris, sounds and buzzes.
 */
export class Siege3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Siege3DDeps;
  readonly #physics: Physics;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #camera = new THREE.PerspectiveCamera(50, 1, 0.5, 700);
  /** The vantage point's own camera, never kicked, shaken or turned: what Fire aims along. */
  readonly #aimCamera = new THREE.PerspectiveCamera(50, 1, 0.5, 700);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #ui: ReturnType<Siege3DView['buildUi']>;
  readonly #figures = new THREE.Group();
  readonly #spearGroup = new THREE.Group();
  readonly #effects = new THREE.Group();
  readonly #ghost: THREE.InstancedMesh;
  readonly #skins: Skins;
  #castle: CastleScene;
  /** The tier the castle was built for (its textures and trees); its shadows follow the tier's. */
  #castleTier: GraphicsTier;
  #sun: THREE.DirectionalLight | undefined;
  /** The castle's parts' matrices as built, by id: each round starts from them. */
  #built = new Map<string, THREE.Matrix4>();
  /** Materials the siege made for the castle's parts (their damage tint), freed with it. */
  #partMaterials: THREE.Material[] = [];
  #rebuilding = false;
  /**
   * Frames drawn this round, to log how smoothly: all, and while looking at a collapse; and the
   * rules' physics time each frame (ms), to tell physics from drawing.
   */
  #perf = newPerf();
  /** The graphics tier drawn at, and its looks (shadows, debris, dust). */
  #tier: GraphicsTier;
  #look: Siege['looks']['tiers']['high'];
  /** Blob shadows (low tier): one per guard and part. */
  #blobs: BlobShadows | undefined;
  readonly #blobTexture = blobTexture();
  readonly #debrisBox = new THREE.BoxGeometry(1, 1, 1);
  readonly #debrisMaterials: Record<MaterialKind, THREE.MeshLambertMaterial> = {
    stone: new THREE.MeshLambertMaterial({ color: COLORS.stone }),
    wood: new THREE.MeshLambertMaterial({ color: COLORS.wood }),
  };
  readonly #senseMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.sense,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
    depthWrite: false,
  });
  readonly #markTexture = textSprite('▼', '#ffc64a');
  readonly #puffTexture: THREE.Texture;
  readonly #pose: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  readonly #matrix = new THREE.Matrix4();
  readonly #frame = new THREE.Matrix4();
  readonly #at = new THREE.Vector3();
  readonly #turn = new THREE.Quaternion();
  readonly #one = new THREE.Vector3(1, 1, 1);
  readonly #hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  readonly #raycaster = new THREE.Raycaster();
  #round: SiegeRound | undefined;
  #mode: ThrowMode = 'aimed';
  #vantage = 0;
  /** The crosshair (px in the view), and where it was left at each vantage point this round. */
  #cross = { x: 0, y: 0 };
  #crossAt = new Map<number, { x: number; y: number }>();
  #parts: PartLook[] = [];
  /** Instanced meshes with an instance moved this frame: their bounds need working out again. */
  #moved = new Set<THREE.InstancedMesh>();
  #guards: GuardLook[] = [];
  #spears: THREE.Group[] = [];
  #puffs: Puff[] = [];
  #debris: Debris[] = [];
  #touch: Touch | undefined;
  /** A Sense potion's red lasts until then (real seconds). */
  #senseUntil = 0;
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
  /** The kick of the last shot, from 1 (just shot) down to 0 (settled). */
  #kick = 0;
  #gaze: Look | undefined;
  #lookBlend = 0;
  readonly #lookPoint = new THREE.Vector3();
  /** Whether this shot has had its kill look (only the first kill of a shot gets one). */
  #killShown = false;
  /** Parts broken lately (real seconds, and where), to tell a big collapse. */
  #breaks: { at: number; point: Vec3 }[] = [];
  #title: { text: string; at: number } | undefined;
  #bankedXp: XpDeposit | undefined;
  #finished: { result: SiegeResult; at: number } | undefined;
  #lastPhase = '';
  #targetsAt = -Infinity;
  /** Frames until what it costs to draw is measured (none: measured). */
  #measureIn = MEASURE_FRAMES;

  private constructor(
    element: HTMLElement,
    deps: Siege3DDeps,
    physics: Physics,
    hud: WarchestHud,
    skins: Skins,
    castle: CastleScene,
    renderer: THREE.WebGLRenderer,
    tier: GraphicsTier,
  ) {
    this.#element = element;
    this.#deps = deps;
    this.#skins = skins;
    this.#physics = physics;
    this.#hud = hud;
    this.#renderer = renderer;
    this.#castle = castle;
    this.#castleTier = tier;
    const rules = deps.game.data.siege;
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'siege');
    this.#skill = station?.skill ?? siegeWeapon(rules).skill;
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#tier = deps.graphics.tier;
    this.#look = rules.looks.tiers[this.#tier];
    renderer.shadowMap.enabled = this.#look.shadows === 'map';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'sg-canvas';
    element.dataset.graphics = this.#tier;
    element.append(renderer.domElement);
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
    this.#useCastle(castle);
    this.#ui = this.buildUi();
    this.#sfx.load({ ...SOUNDS, whoosh: whooshUrl() });
    this.#listen();
    deps.graphics.onTier(({ tier: next }) => {
      this.#applyTier(next);
    });
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Siege3DDeps): Promise<Siege3DView> {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    deps.graphics.noteGpu(gpuOf(renderer.getContext()).gpu);
    const tier = deps.graphics.tier;
    const [physics, hud, skins, castle] = await Promise.all([
      loadPhysics(),
      WarchestHud.create(element, {
        game: deps.game,
        item: deps.game.data.siege.item,
        haptics: deps.haptics,
        logger: deps.logger,
      }),
      loadSkins(deps.game.data.siege.skins),
      castleFor(deps.game.data.castle, tier),
    ]);
    return new Siege3DView(element, deps, physics, hud, skins, castle, renderer, tier);
  }

  /**
   * Loads the physics engine (and starts its wasm) and the models, and builds the castle at
   * `tier`, ahead of time.
   */
  static async preload(
    skins?: Siege['skins'],
    castle?: { castle: Castle; tier: GraphicsTier },
  ): Promise<void> {
    if (castle && !early) {
      const scene = buildCastleScene(castle.castle, castle.tier, ANISOTROPY);
      early = { tier: castle.tier, scene };
      // A failed build only costs the head start: the siege builds it again when it opens.
      scene.catch(() => {
        if (early?.scene === scene) early = undefined;
      });
    }
    await Promise.all([
      loadPhysics(),
      WarchestHud.preload(),
      ...(skins ? [loadSkins(skins)] : []),
      ...(early ? [early.scene] : []),
    ]);
  }

  // ScreenView

  start(): void {
    restoreContext(this.#renderer);
    this.#hud.wake();
    this.#resize();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
    // Built for another tier (the phone was moved to Low as it played): build it again first.
    if (this.#deps.graphics.tier !== this.#castleTier) void this.#rebuild(this.#deps.graphics.tier);
    else this.#startRound();
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

  // The castle

  /** Draws the siege in `castle`'s scene: its parts ready to move, tint and hide. */
  #useCastle(castle: CastleScene): void {
    this.#castle = castle;
    castle.scene.add(this.#figures, this.#spearGroup, this.#effects, this.#ghost);
    const lights: THREE.DirectionalLight[] = [];
    castle.scene.traverse((child) => {
      if (child instanceof THREE.DirectionalLight) lights.push(child);
    });
    this.#sun = lights[0];
    if (this.#sun) this.#sun.castShadow = this.#look.shadows === 'map';
    this.#built = new Map();
    const each = new THREE.Matrix4();
    for (const [id, look] of castle.parts) {
      if ('instances' in look) {
        const [first] = look.instances;
        if (first) this.#built.set(id, first.getMatrixAt(look.index, each).clone());
        // Room for each part's damage tint.
        for (const mesh of look.instances) {
          if (!mesh.instanceColor) {
            for (let index = 0; index < mesh.count; index++) {
              mesh.setColorAt(index, new THREE.Color(1, 1, 1));
            }
          }
        }
      } else {
        look.object.matrixAutoUpdate = false;
        this.#built.set(id, new THREE.Matrix4());
        this.#ownMaterials(look.object);
      }
    }
    for (const rack of castle.racks.values()) {
      rack.matrixAutoUpdate = false;
      this.#ownMaterials(rack);
    }
    this.#measureIn = MEASURE_FRAMES;
  }

  /** Gives a part's meshes their own materials, so tinting it tints only it. */
  #ownMaterials(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const own = (child.material as THREE.Material).clone();
      child.material = own;
      this.#partMaterials.push(own);
    });
  }

  /** Builds the castle again at `tier` (its textures and trees), then starts a round. */
  async #rebuild(tier: GraphicsTier): Promise<void> {
    if (this.#rebuilding) return;
    this.#rebuilding = true;
    this.#endRound();
    this.#ui.hint.textContent = 'Building the castle…';
    try {
      const castle = await buildCastleScene(this.#deps.game.data.castle, tier, ANISOTROPY);
      this.#castle.scene.remove(this.#figures, this.#spearGroup, this.#effects, this.#ghost);
      this.#castle.dispose();
      for (const material of this.#partMaterials) material.dispose();
      this.#partMaterials = [];
      this.#castleTier = tier;
      this.#useCastle(castle);
      this.#deps.logger.log('siege.castleBuilt', { tier });
    } finally {
      this.#rebuilding = false;
    }
    this.#startRound();
  }

  // Rounds

  #startRound(): void {
    const { game } = this.#deps;
    const rules = game.data.siege;
    this.#endRound();
    this.#ui.card.hidden = true;
    this.#finished = undefined;
    const weapon = siegeWeapon(rules);
    const aimed = aimedVolley(weapon, game.level(weapon.skill));
    const round = new SiegeRound(
      this.#physics,
      game.data,
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
      { aimed, seed: Date.now() >>> 0, vantage: this.#vantage },
    );
    this.#round = round;
    this.#vantage = round.vantage;
    this.#crossAt = new Map();
    this.#centreCross();
    this.#buildRound(round);
    this.#showVantages();
    this.#slow.until = this.#frozenUntil = 0;
    this.#gaze = undefined;
    this.#lookBlend = 0;
    this.#breaks = [];
    this.#title = undefined;
    this.#perf = newPerf();
    if (game.inventory.count(rules.item) < 1) this.#showNoSpears();
  }

  /** Throws the round away (leaving, or starting another): its spears are spent. */
  #endRound(): void {
    const round = this.#round;
    if (!round) return;
    round.quit();
    round.dispose();
    this.#round = undefined;
    this.#blobs?.dispose(true);
    this.#blobs = undefined;
    for (const look of this.#guards) {
      look.mixer.stopAllAction();
      look.mixer.uncacheRoot(look.model);
      look.root.removeFromParent();
      for (const material of look.owned) material.dispose();
      look.mark?.material.dispose();
    }
    this.#guards = [];
    // The spears share their model's geometry and materials: only out of the scene.
    for (const spear of this.#spears) spear.removeFromParent();
    this.#spears = [];
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
    this.#parts = [];
    this.#touch = undefined;
    this.#trailSpear = undefined;
    this.#trailPoints = [];
    this.#ghost.count = 0;
  }

  /**
   * The round's castle as built (every part back where it was, whole), the spear rack it keeps,
   * and its guards and captain.
   */
  #buildRound(round: SiegeRound): void {
    const castle = this.#castle;
    // Everything back as built.
    for (const [id, look] of castle.parts) {
      const built = this.#built.get(id);
      if (!built) continue;
      if ('instances' in look) {
        for (const mesh of look.instances) {
          mesh.setMatrixAt(look.index, built);
          mesh.setColorAt(look.index, stageTint(0xffffff, 0));
          this.#moved.add(mesh);
        }
      } else {
        look.object.matrix.copy(built);
        look.object.visible = true;
        tintObject(look.object, 0);
      }
    }
    for (const [id, rack] of castle.racks) {
      rack.visible = id === round.plan.rack;
      rack.matrix.identity();
      tintObject(rack, 0);
    }
    // What's fixed to each part, by the part.
    const fixedTo = new Map<string, { look: CastlePartLook; built: THREE.Matrix4 }[]>();
    for (const part of castle.layout.parts) {
      if (!part.of) continue;
      const look = castle.parts.get(part.id);
      const built = this.#built.get(part.id);
      if (!look || !built) continue;
      fixedTo.set(part.of, [...(fixedTo.get(part.of) ?? []), { look, built }]);
    }
    this.#parts = round.parts.map((state) => {
      const look =
        state.kind === 'rack'
          ? (() => {
              const object = castle.racks.get(state.body.id);
              return object ? { kind: 'rack' as const, object } : undefined;
            })()
          : castle.parts.get(state.body.id);
      const { position, rotation } = state.start;
      const unframe = new THREE.Matrix4()
        .compose(
          new THREE.Vector3(position.x, position.y, position.z),
          new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
          this.#one,
        )
        .invert();
      return {
        look,
        built: this.#built.get(state.body.id)?.clone() ?? new THREE.Matrix4(),
        unframe,
        fixed: fixedTo.get(state.body.id) ?? [],
        mode: 'fixed',
        stage: 0,
      };
    });
    this.#commitMoved();

    const rules = this.#deps.game.data.siege;
    this.#guards = round.guards.map((guard) => {
      const look = this.#guardLook(guard.height, guard.role === 'captain');
      this.#figures.add(look.root);
      return look;
    });
    // A blob under each guard and each part (shown on the low tier, for what's come loose).
    this.#blobs = new BlobShadows(
      round.guards.length + round.parts.length,
      rules.looks.blobShadows.opacity,
      this.#blobTexture,
    );
    this.#blobs.mesh.visible = this.#look.shadows === 'blob';
    this.#effects.add(this.#blobs.mesh);
    this.#drawBodies();
  }

  /** The round is over: pay its Command XP and the spears it got back. */
  #pay(result: SiegeResult): void {
    const perf = this.#perf;
    this.#deps.logger.log('siege.perf', {
      fps: Math.round(perf.frames / Math.max(perf.seconds, 0.001)),
      worstMs: Math.round(perf.worst * 1000),
      collapseFps:
        perf.collapseFrames > 0
          ? Math.round(perf.collapseFrames / Math.max(perf.collapseSeconds, 0.001))
          : undefined,
      drawCalls: perf.calls,
      triangles: perf.triangles,
      tier: this.#tier,
      physicsP95Ms: round1(quantile(perf.physicsMs, 0.95)),
      physicsWorstMs: round1(perf.physicsMs.reduce((most, ms) => Math.max(most, ms), 0)),
    });
    const { game } = this.#deps;
    const before = game.xp(this.#skill);
    if (result.xp > 0) game.addXp(this.#skill, result.xp);
    this.#bankedXp = this.#skillBar.hold(game.xp(this.#skill) - before);
    if (result.recovered > 0) game.addItems(game.data.siege.item, result.recovered);
    // The card waits a moment, so the last of it is seen to come down.
    this.#finished = { result, at: this.#now + (result.won ? 0.6 : 0.2) };
  }

  /**
   * Draws at `tier` from now on: the sun's shadow map or blob shadows, and the debris and dust
   * from here on (the castle's textures and trees change the next time the siege opens). Only
   * looks; the round goes on as it was.
   */
  #applyTier(tier: GraphicsTier): void {
    if (tier === this.#tier) return;
    this.#tier = tier;
    this.#look = this.#deps.game.data.siege.looks.tiers[tier];
    this.#element.dataset.graphics = tier;
    const map = this.#look.shadows === 'map';
    this.#renderer.shadowMap.enabled = map;
    if (this.#sun) this.#sun.castShadow = map;
    if (this.#blobs) this.#blobs.mesh.visible = !map;
    // Every look is built again, with or without the shadows.
    this.#castle.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const material of [child.material as THREE.Material | THREE.Material[]].flat()) {
        material.needsUpdate = true;
      }
    });
    this.#measureIn = MEASURE_FRAMES;
    this.#deps.logger.log('siege.graphics', { tier });
  }

  /**
   * A guard: Kenney's soldier (cloned with his skeleton), scaled evenly to `height`, his feet at
   * his root, with his own mixer for his clips, and his red outline for Sense. The captain wears
   * gold, and a gold mark over him.
   */
  #guardLook(height: number, captain: boolean): GuardLook {
    const rules = this.#deps.game.data.siege;
    const skin = rules.skins.guard;
    const model = SkeletonUtils.clone(this.#skins.guard.scene);
    const bounds = new THREE.Box3().setFromObject(model);
    const tall = Math.max(bounds.max.y - bounds.min.y, 0.001);
    model.scale.setScalar(height / tall);
    model.rotation.y = skin.turn * DEG;
    const owned: THREE.Material[] = [];
    const meshes: THREE.Mesh[] = [];
    model.traverse((child) => {
      child.castShadow = true;
      if (child instanceof THREE.Mesh) meshes.push(child as THREE.Mesh);
    });
    if (captain) {
      const tint = new THREE.Color(rules.captain.tint);
      for (const mesh of meshes) {
        const gold = (mesh.material as THREE.MeshLambertMaterial).clone();
        gold.color.multiply(tint);
        // A glow of gold too, so he reads as the captain far off, through a window.
        gold.emissive.copy(tint).multiplyScalar(rules.captain.glow);
        mesh.material = gold;
        owned.push(gold);
      }
    }
    // His outline: his own meshes again (on his skeleton, so it moves as he does), flat red and
    // drawn over everything.
    const sense = meshes.map((mesh) => {
      const overlay =
        mesh instanceof THREE.SkinnedMesh
          ? (() => {
              const skinned = new THREE.SkinnedMesh(mesh.geometry, this.#senseMaterial);
              skinned.bind(mesh.skeleton, mesh.bindMatrix);
              skinned.bindMode = mesh.bindMode;
              return skinned;
            })()
          : new THREE.Mesh(mesh.geometry, this.#senseMaterial);
      overlay.position.copy(mesh.position);
      overlay.quaternion.copy(mesh.quaternion);
      overlay.scale.copy(mesh.scale);
      overlay.renderOrder = 20;
      overlay.frustumCulled = false;
      overlay.castShadow = false;
      overlay.visible = false;
      mesh.parent?.add(overlay);
      return overlay;
    });
    const root = new THREE.Group();
    root.add(model);
    let mark: THREE.Sprite | undefined;
    if (captain) {
      mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#markTexture }));
      mark.renderOrder = 5;
      root.add(mark);
    }
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.#skins.guard.animations) actions.set(clip.name, mixer.clipAction(clip));
    return { root, model, mixer, actions, clip: '', down: false, downAt: 0, sense, mark, owned };
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
        // The trail follows this shot's middle spear (of its first volley) as it flies.
        const first = this.#spears.length;
        this.#trailSpear = first + Math.floor((Math.min(event.spears, round.aimed) - 1) / 2);
        this.#trailPoints = [];
        this.#ghost.count = 0;
        this.#endSlow();
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
        this.#dust(event.at, Math.round(feel.dust * strength * 0.6), 0.8 + strength * 0.3);
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
      case 'loose':
        this.#play('creak', 0.3, -600 + Math.random() * 300);
        break;
      case 'break': {
        this.#breakPart(event.part, event.kind, event.at);
        // Many parts at once is a collapse worth watching.
        this.#breaks = this.#breaks.filter(
          (entry) => this.#now - entry.at <= feel.collapseWindowSeconds,
        );
        this.#breaks.push({ at: this.#now, point: event.at });
        if (!this.#killShown && this.#breaks.length >= feel.collapseParts) {
          const count = this.#breaks.length;
          const middle = this.#breaks.reduce(
            (sum, entry) => ({
              x: sum.x + entry.point.x / count,
              y: sum.y + entry.point.y / count,
              z: sum.z + entry.point.z / count,
            }),
            { x: 0, y: 0, z: 0 },
          );
          this.#killLook({ point: middle }, feel.killCamSeconds, feel.killCamSlowMo);
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
          this.#killLook({ guard: event.guard }, feel.killCamSeconds, feel.killCamSlowMo);
        } else {
          this.#play('thud-2', 0.45, -200);
          this.#deps.haptics.pulse(feel.buzzGuardMs);
        }
        break;
      }
      case 'objective': {
        const objective = round.plan.objectives[event.objective];
        if (!objective) break;
        if (event.complete) {
          this.#play('star', 0.55, -200);
          this.#deps.haptics.pulse(feel.buzzObjectiveMs);
        }
        const names = {
          captain: 'The captain is down!',
          rack: 'The spear rack is broken!',
          guards: `${String(event.done)} of ${String(event.needed)} down`,
        };
        this.#title = {
          text:
            event.complete && objective.kind === 'guards'
              ? 'The battlement is taken!'
              : names[objective.kind],
          at: this.#now,
        };
        break;
      }
      case 'vantage':
        this.#play('wind', 0.35, -400);
        break;
      case 'won':
        this.#play('rumble', 0.5);
        this.#deps.haptics.rumble(feel.buzzWinMs, 3);
        this.#slow = {
          until: this.#now + feel.slowMoSeconds,
          seconds: feel.slowMoSeconds,
          factor: feel.slowMo,
        };
        this.#title = { text: 'Every objective done!', at: this.#now + 0.4 };
        break;
      default:
        break;
    }
  }

  /** A part bursts: a few chunks fly off and fade, in a cloud of dust. */
  #breakPart(index: number, kind: MaterialKind, at: Vec3): void {
    const feel = this.#deps.feel.values;
    const state = this.#round?.parts[index];
    if (!state) return;
    this.#play(kind === 'stone' ? 'break-stone' : 'break-wood', 0.55, kind === 'stone' ? -900 : 0);
    this.#stop(feel.heavyHitStopMs);
    this.#deps.haptics.pulse(feel.buzzBreakMs);
    this.#shake = Math.max(this.#shake, 0.06 * feel.shakeStrength);
    const [width, height, depth] = footprintOf(state.body.shapes);
    this.#dust(at, Math.round(feel.dust * 1.6), Math.max(width, height) * 0.8);
    const base = this.#debrisMaterials[kind];
    const { debrisPieces, maxDebris } = this.#look;
    for (let piece = 0; piece < debrisPieces && this.#debris.length < maxDebris; piece++) {
      const material = base.clone();
      material.transparent = true;
      // One box for every chunk, scaled to its size.
      const mesh = new THREE.Mesh(this.#debrisBox, material);
      mesh.scale.set(
        width * (0.2 + Math.random() * 0.15),
        height * (0.2 + Math.random() * 0.15),
        depth * (0.25 + Math.random() * 0.2),
      );
      mesh.position.set(
        at.x + (Math.random() - 0.5) * width * 0.6,
        at.y + (Math.random() - 0.5) * height * 0.6,
        at.z + (Math.random() - 0.5) * depth * 0.6,
      );
      mesh.castShadow = this.#look.shadows === 'map';
      this.#effects.add(mesh);
      this.#debris.push({
        mesh,
        material,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          1.5 + Math.random() * 3,
          (Math.random() - 0.5) * 5,
        ),
        spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
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

  /** A kill look: a freeze, then slow motion for `seconds` while the camera turns to `target`. */
  #killLook(target: KillTarget, seconds: number, slowMo: number): void {
    const feel = this.#deps.feel.values;
    this.#killShown = true;
    this.#gaze = { target, at: this.#now, seconds, out: false };
    this.#frozenUntil = Math.max(this.#frozenUntil, this.#now + feel.killCamStopMs / 1000);
    this.#lastStop = this.#now;
    this.#slow = { until: this.#now + seconds, seconds, factor: slowMo };
  }

  /** Back to full speed at once (a skip, or the next shot). */
  #endSlow(): void {
    this.#slow.until = this.#now;
    this.#frozenUntil = Math.min(this.#frozenUntil, this.#now);
    if (this.#gaze) this.#gaze.out = true;
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
    // How smoothly it draws: overall, and while looking at a collapse (the heaviest).
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
    // Slow motion (a kill, a collapse, the last objective), easing back over its last third.
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
    // Calm frames (aiming, no kill look, nothing slowed) tell the graphics tier how this phone
    // copes.
    if (round?.phase === 'aim' && !this.#gaze && !frozen && scale === 1) {
      this.#deps.graphics.sample(realDt * 1000);
    }
    const finished = this.#finished;
    if (finished && this.#now >= finished.at) {
      this.#finished = undefined;
      this.#showCard(finished.result);
    }
    this.#drawBodies();
    this.#animateGuards(dt);
    this.#drawBlobs();
    this.#drawAim();
    // The ghost keeps its width on screen.
    if (this.#ghost.visible && this.#trailPoints.length > 1) this.#drawGhost();
    this.#updateEffects(dt);
    this.#updateUi();
    this.#updateCamera(realDt);
    this.#renderer.render(this.#castle.scene, this.#camera);
    const info = this.#renderer.info.render;
    perf.calls = Math.max(perf.calls, info.calls);
    perf.triangles = Math.max(perf.triangles, info.triangles);
    if (this.#measureIn > 0 && --this.#measureIn === 0) this.#measure();
  }

  /** What it costs to draw (for the logs, and the preview's screenshots), once it's all loaded. */
  #measure(): void {
    const info = this.#renderer.info.render;
    const memory = this.#castle.measure();
    Object.assign(this.#element.dataset, {
      drawCalls: String(info.calls),
      triangles: String(info.triangles),
      textureMb: String(memory.textureMB),
    });
    this.#deps.logger.log('siege.cost', {
      tier: this.#tier,
      castleTier: this.#castleTier,
      drawCalls: info.calls,
      triangles: info.triangles,
      ...memory,
    });
  }

  /** Every part, guard and spear where the rules have them, and parts' damage showing. */
  #drawBodies(): void {
    const round = this.#round;
    if (!round) return;
    const pose = this.#pose;
    round.parts.forEach((state, index) => {
      const look = this.#parts[index];
      if (!look) return;
      const stage = state.hp / state.maxHp > 0.66 ? 0 : state.hp / state.maxHp > 0.33 ? 1 : 2;
      const changed = state.mode !== look.mode;
      if (stage !== look.stage) {
        look.stage = stage;
        this.#tintPart(look, stage);
      }
      if (state.mode === 'fixed' || (state.mode === 'frozen' && !changed)) return;
      look.mode = state.mode;
      if (state.mode === 'broken') {
        this.#placePart(look, undefined);
        return;
      }
      round.partPose(index, pose);
      this.#frame.compose(
        this.#at.set(pose.position.x, pose.position.y, pose.position.z),
        this.#turn.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w),
        this.#one,
      );
      this.#placePart(look, this.#frame.multiply(look.unframe));
    });
    this.#commitMoved();

    const sensing = this.#now < this.#senseUntil;
    const feel = this.#deps.feel.values;
    const clips = this.#deps.game.data.siege.skins.guard.clips;
    this.#guards.forEach((look, index) => {
      const state = round.guards[index];
      if (!state) return;
      round.guardPose(index, pose);
      const { x, y, z } = pose.position;
      if (state.down && state.role === 'guard') {
        // Lying: where his body lies (his die clip does the falling), his feet on what's under it.
        look.root.position.set(x, y - Math.min(state.size[0], state.size[2]) / 2, z);
      } else {
        look.root.position.set(x, y - state.feet, z);
        look.root.rotation.y = state.facing;
      }
      this.#playClip(look, state.down ? clips.down : state.walking ? clips.patrol : clips.stand);
      for (const overlay of look.sense) overlay.visible = sensing && !state.down;
      if (look.mark) {
        look.mark.visible = !state.down;
        // Out in front of him (his window's wall would hide it over his head).
        look.mark.position.set(0, state.height + feel.markSize * 0.5, MARK_OUT);
        look.mark.scale.set(feel.markSize * 2, feel.markSize, 1);
      }
    });
    this.#spears.forEach((spear, index) => {
      const state = round.spears[index];
      spear.visible = state?.gone !== true;
      if (!spear.visible) return;
      round.spearPose(index, pose);
      spear.position.set(pose.position.x, pose.position.y, pose.position.z);
      spear.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      // Just out of the ballista, under the camera, it'd fill the screen: it shows from a few
      // metres on.
      if (spear.position.distanceTo(this.#camera.position) < GHOST_NEAR) spear.visible = false;
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

  /** A part drawn at `matrix` times where it was built (hidden, if none), and what's fixed to it. */
  #placePart(look: PartLook, frame: THREE.Matrix4 | undefined): void {
    const put = (target: PartLook['look'], built: THREE.Matrix4) => {
      if (!target) return;
      if ('instances' in target) {
        const matrix = frame ? this.#matrix.multiplyMatrices(frame, built) : this.#hidden;
        for (const mesh of target.instances) {
          mesh.setMatrixAt(target.index, matrix);
          this.#moved.add(mesh);
        }
      } else {
        target.object.visible = frame !== undefined;
        if (frame) target.object.matrix.multiplyMatrices(frame, built);
      }
    };
    put(look.look, look.built);
    for (const fixed of look.fixed) put(fixed.look, fixed.built);
  }

  /** A part's damage: darker as it's hurt. */
  #tintPart(look: PartLook, stage: number): void {
    const target = look.look;
    if (!target) return;
    if ('instances' in target) {
      const color = stageTint(0xffffff, stage);
      for (const mesh of target.instances) {
        mesh.setColorAt(target.index, color);
        this.#moved.add(mesh);
      }
    } else tintObject(target.object, stage);
  }

  /** Sends moved instances to the graphics card, and works out their bounds again. */
  #commitMoved(): void {
    for (const mesh of this.#moved) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    this.#moved.clear();
  }

  /**
   * The blob shadows (low tier): under every guard, and under every part that's come loose,
   * where the rules have it. Each is its thing's footprint, shrinking away as it rises.
   */
  #drawBlobs(): void {
    const blobs = this.#blobs;
    const round = this.#round;
    if (!blobs?.mesh.visible || !round) return;
    const { spread, lift, fadeHeight } = this.#deps.game.data.siege.looks.blobShadows;
    const pose = this.#pose;
    let index = 0;
    const under = (width: number, depth: number, bottom: number, turn: number) => {
      const left = Math.min(Math.max(1 - bottom / fadeHeight, 0), 1) * spread;
      blobs.place(
        index++,
        pose.position.x,
        pose.position.z,
        width * left,
        depth * left,
        turn,
        lift,
      );
    };
    round.guards.forEach((guard, at) => {
      round.guardPose(at, pose);
      under(guard.size[0], guard.size[2], pose.position.y - guard.feet, 0);
    });
    round.parts.forEach((part, at) => {
      if (part.mode !== 'loose' && part.mode !== 'frozen') {
        blobs.place(index++, 0, 0, 0);
        return;
      }
      round.partPose(at, pose);
      const [width, , depth] = footprintOf(part.body.shapes);
      const yaw = 2 * Math.atan2(pose.rotation.y, pose.rotation.w);
      under(width, depth, pose.position.y, -yaw);
    });
    blobs.commit();
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
      // Not where it leaves the ballista, just under the camera: there it'd fill the screen.
      if (far < GHOST_NEAR) continue;
      const width = Math.max(feel.ghostWidth, far * perPixel * feel.ghostPx);
      matrix.compose(middle, turn, new THREE.Vector3(width, width, length));
      this.#ghost.setMatrixAt(count++, matrix);
    }
    this.#ghost.count = count;
    this.#ghost.instanceMatrix.needsUpdate = true;
  }

  /**
   * The crosshair where it's been dragged, `reticleSize` across, or as wide as a barrage's spread
   * if that's wider. The last shot's path shows if it's turned on.
   */
  #drawAim(): void {
    const round = this.#round;
    const ui = this.#ui;
    const feel = this.#deps.feel.values;
    this.#ghost.visible = this.#deps.ghost.value === 'on';
    const showing = round !== undefined && round.phase === 'aim' && ui.card.hidden;
    ui.crosshair.hidden = !showing;
    if (!showing) return;
    const half = Math.tan((this.#aimCamera.fov * DEG) / 2);
    const spread =
      this.#mode === 'barrage'
        ? (Math.tan(feel.barrageSpread * DEG) / half) * (this.#element.clientHeight / 2)
        : 0;
    const radius = Math.max(spread, feel.reticleSize / 2, CROSSHAIR_PX / 2);
    ui.crosshair.style.width = ui.crosshair.style.height = `${String(radius * 2)}px`;
    ui.crosshair.style.left = `${String(this.#cross.x)}px`;
    ui.crosshair.style.top = `${String(this.#cross.y)}px`;
    ui.crosshair.dataset.mode = this.#mode;
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
      // Debris only bounces off the ground: it never touches the castle, and the rules never see it.
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

  // Camera

  /**
   * Fixed at the vantage point: where it stands, what it looks at, its field of view. A shot
   * kicks it back and up a moment, hits shake it, and a kill look turns it (from where it stands)
   * to what came down, zoomed in, and eases back.
   */
  #updateCamera(dt: number): void {
    const feel = this.#deps.feel.values;
    const vantage = this.#deps.game.data.castle.vantages[this.#vantage];
    if (!vantage) return;
    const at = new THREE.Vector3(...vantage.at);
    const ahead = new THREE.Vector3(...vantage.look);
    this.#aimCamera.position.copy(at);
    this.#aimCamera.lookAt(ahead);
    if (this.#aimCamera.fov !== vantage.fov) {
      this.#aimCamera.fov = vantage.fov;
      this.#aimCamera.updateProjectionMatrix();
    }
    this.#aimCamera.updateMatrixWorld();
    // The kill look.
    const look = this.#gaze;
    if (look) {
      const age = this.#now - look.at;
      if (!look.out && age >= look.seconds) look.out = true;
      if (!look.out) {
        this.#lookPoint.copy(this.#killPoint(look.target));
        this.#lookBlend = Math.min(1, this.#lookBlend + dt / Math.max(feel.killCamInSeconds, 0.01));
      } else {
        this.#lookBlend -= dt / Math.max(feel.killCamOutSeconds, 0.01);
        if (this.#lookBlend <= 0) {
          this.#lookBlend = 0;
          this.#gaze = undefined;
        }
      }
    }
    const share = this.#lookBlend * this.#lookBlend * (3 - 2 * this.#lookBlend);
    const target = ahead.clone().lerp(this.#lookPoint, share);
    const fov = vantage.fov * (1 - (1 - feel.killCamZoom) * share);
    this.#shake *= Math.exp(-9 * dt);
    this.#camera.position.copy(at);
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
    const forward = target.clone().sub(at).normalize();
    this.#camera.position.addScaledVector(forward, -feel.kickBack * kick);
    this.#camera.lookAt(target);
    this.#camera.rotateX(feel.kickTilt * DEG * kick);
    if (Math.abs(this.#camera.fov - fov) > 1e-4) {
      this.#camera.fov = fov;
      this.#camera.updateProjectionMatrix();
    }
  }

  /** Where a kill look's target is now: a guard's chest, or a point. */
  #killPoint(target: KillTarget): THREE.Vector3 {
    const round = this.#round;
    if ('point' in target) return new THREE.Vector3(target.point.x, target.point.y, target.point.z);
    if (!round) return new THREE.Vector3();
    round.guardPose(target.guard, this.#pose);
    const { x, y, z } = this.#pose.position;
    return new THREE.Vector3(x, y, z);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    for (const camera of [this.#camera, this.#aimCamera]) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    this.#keepCross();
  }

  #play(name: string, volume: number, detune = 0): void {
    this.#sfx.play(name, volume, detune + (Math.random() - 0.5) * 120);
  }

  // Aim

  /** The crosshair in the middle of the view: on what the vantage point looks at. */
  #centreCross(): void {
    this.#cross = { x: this.#element.clientWidth / 2, y: this.#element.clientHeight / 2 };
  }

  /** The crosshair kept `aimEdge` px inside the view. */
  #keepCross(): void {
    const edge = this.#deps.feel.values.aimEdge;
    const { clientWidth: width, clientHeight: height } = this.#element;
    this.#cross.x = Math.min(Math.max(this.#cross.x, edge), Math.max(width - edge, edge));
    this.#cross.y = Math.min(Math.max(this.#cross.y, edge), Math.max(height - edge, edge));
  }

  /** Moves the camera (and the ballista) to vantage point `index`, its crosshair as you left it. */
  #goTo(index: number): void {
    const round = this.#round;
    if (!round || !round.setVantage(index)) return;
    this.#crossAt.set(this.#vantage, { ...this.#cross });
    this.#vantage = index;
    const kept = this.#crossAt.get(index);
    if (kept) this.#cross = { ...kept };
    else this.#centreCross();
    this.#endSlow();
    this.#showVantages();
    // What it costs to draw from here.
    this.#measureIn = MEASURE_FRAMES;
  }

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      if (this.#touch || !this.#round) return;
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
        // Aiming again ends any kill look.
        this.#endSlow();
      }
      if (!touch.dragging) return;
      // A drag moves the crosshair over the view (the camera stays where it is).
      const per = this.#deps.feel.values.aimPerPx;
      this.#cross.x += (event.clientX - touch.last.x) * per;
      this.#cross.y += (event.clientY - touch.last.y) * per;
      this.#keepCross();
      touch.last = { x: event.clientX, y: event.clientY };
    });
    const end = (event: PointerEvent) => {
      const touch = this.#touch;
      if (!touch || touch.id !== event.pointerId) return;
      this.#touch = undefined;
      // A tap: the kill look ends early.
      if (!touch.dragging) this.#endSlow();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', (event) => {
      if (this.#touch?.id === event.pointerId) this.#touch = undefined;
    });
  }

  /** Fire: the ballista shoots at what's under the crosshair, if it can. */
  #fire(): void {
    const round = this.#round;
    if (!round) return;
    this.#endSlow();
    const rules = this.#deps.game.data.siege;
    const target = this.#crossTarget();
    const aim = solveAim(round.mount(), target, siegeWeapon(rules), rules.physics.gravity);
    round.throw(this.#mode, aim, target);
  }

  /**
   * What the crosshair is on: the first part, guard, stonework or patch of field the rules have
   * along the view through it, or `aimFallback` metres out if there's nothing.
   */
  #crossTarget(): Vec3 {
    const feel = this.#deps.feel.values;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const ndc = new THREE.Vector2(
      (this.#cross.x / Math.max(width, 1)) * 2 - 1,
      1 - (this.#cross.y / Math.max(height, 1)) * 2,
    );
    this.#raycaster.setFromCamera(ndc, this.#aimCamera);
    const { origin, direction } = this.#raycaster.ray;
    const from = { x: origin.x, y: origin.y, z: origin.z };
    const way = { x: direction.x, y: direction.y, z: direction.z };
    return (
      this.#round?.rayHit(from, way, feel.aimFallback) ?? {
        x: origin.x + direction.x * feel.aimFallback,
        y: origin.y + direction.y * feel.aimFallback,
        z: origin.z + direction.z * feel.aimFallback,
      }
    );
  }

  /** A Sense potion: one from the warchest, and every guard's outline in red through walls a while. */
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
      vantage: round.vantages[round.vantage]?.id,
      throws: round.throws,
      seconds,
      left: game.inventory.count(rules.potion),
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
    // The vantage points: tap one to shoot from there.
    const vantages = el('div', 'sg-vantages');
    vantages.setAttribute('role', 'radiogroup');
    vantages.setAttribute('aria-label', 'Vantage point');
    const vantageButtons = this.#deps.game.data.castle.vantages.map((vantage, index) => {
      const element = button(vantage.name, 'sg-vantage', () => {
        this.#goTo(index);
      });
      element.setAttribute('role', 'radio');
      element.dataset.vantage = vantage.id;
      vantages.append(element);
      return element;
    });
    const status = el('div', 'sg-status');
    // The round's objectives, each ticked off as it's done.
    const objectives = el('ul', 'sg-objectives');
    objectives.setAttribute('aria-label', 'Objectives');
    const title = el('div', 'sg-title');
    title.hidden = true;
    const hint = el('div', 'sg-hint');
    const controls = el('div', 'sg-controls');
    const extras = el('div', 'sg-extras');
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
    // A Sense potion: every guard's outline in red through walls for a while (shown when there's one).
    const potion = button('Sense', 'sg-potion', () => {
      this.#drinkPotion();
    });
    // Ends the siege now, with what's done (a star for some).
    const withdraw = button('Withdraw', 'sg-withdraw', () => {
      this.#round?.withdraw();
    });
    extras.append(ghost, potion, withdraw);
    const fire = button('Fire', 'sg-fire', () => {
      this.#fire();
    });
    const shoot = el('div', 'sg-shoot');
    shoot.append(modes, fire);
    controls.append(extras, shoot);
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
    root.append(crosshair, vantages, status, objectives, title, hint, controls, card);
    this.#element.append(root);
    return {
      root,
      vantages,
      vantageButtons,
      status,
      objectives,
      title,
      hint,
      controls,
      modeButtons,
      fire,
      ghost,
      potion,
      withdraw,
      crosshair,
      card,
      cardStars,
      cardTitle,
      cardText,
      again,
    };
  }

  /** The vantage buttons, the one you're at lit. */
  #showVantages(): void {
    this.#ui.vantageButtons.forEach((element, index) => {
      element.setAttribute('aria-checked', String(index === this.#vantage));
    });
    this.#element.dataset.vantage = this.#deps.game.data.castle.vantages[this.#vantage]?.id ?? '';
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
    this.#element.dataset.done = String(round?.done ?? 0);
    this.#element.dataset.aim = `${this.#cross.x.toFixed(1)} ${this.#cross.y.toFixed(1)}`;
    const look = this.#gaze;
    this.#element.dataset.camera = !look ? 'vantage' : 'guard' in look.target ? 'kill' : 'collapse';
    if (round && this.#now - this.#targetsAt > TARGETS_SECONDS) {
      this.#targetsAt = this.#now;
      this.#element.dataset.targets = JSON.stringify(this.#targetsOnScreen(round));
    }
    if (!round) return;
    const title = this.#title;
    const showing =
      title !== undefined && this.#now >= title.at && this.#now - title.at < TITLE_SECONDS;
    ui.title.hidden = !showing;
    if (title && ui.title.textContent !== title.text) ui.title.textContent = title.text;
    const aiming = phase === 'aim' && ui.card.hidden;
    ui.controls.hidden = !aiming;
    ui.vantages.hidden = !ui.card.hidden;
    ui.fire.disabled = !round.canThrow;
    ui.ghost.setAttribute('aria-pressed', String(this.#deps.ghost.value === 'on'));
    ui.withdraw.hidden = round.throws === 0;
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
    ui.status.textContent = `Throws ${String(round.throws)} / par ${String(rules.par)} · ${String(round.used)} spears`;
    ui.objectives.hidden = !ui.card.hidden;
    const items = round.plan.objectives.map((objective, index) => {
      const progress = round.progress[index] ?? { done: 0, needed: 1 };
      const done = progress.done >= progress.needed;
      const count =
        progress.needed > 1 ? ` (${String(progress.done)}/${String(progress.needed)})` : '';
      return { text: `${done ? '✓' : '○'} ${objectiveText(objective)}${count}`, done };
    });
    const key = items.map((item) => item.text).join('|');
    if (ui.objectives.dataset.key !== key) {
      ui.objectives.dataset.key = key;
      ui.objectives.replaceChildren(
        ...items.map((item) => {
          const line = document.createElement('li');
          line.textContent = item.text;
          if (item.done) line.className = 'sg-done';
          return line;
        }),
      );
    }
    const hint = this.#rebuilding
      ? 'Building the castle…'
      : phase === 'aim' && left < 1 && !round.reloading
        ? 'Out of spears…'
        : phase === 'aim' && round.throws === 0
          ? 'Drag to aim, then Fire'
          : '';
    if (ui.hint.textContent !== hint) ui.hint.textContent = hint;
    ui.hint.hidden = !ui.card.hidden;
  }

  /**
   * Where the round's targets are on screen (px in the view, off its edges too, `on` if they're
   * in it): its guards' and the captain's chests and the spear rack. For the e2e tests and
   * screenshots to aim at, as a player would by eye.
   */
  #targetsOnScreen(round: SiegeRound): { kind: string; x: number; y: number; on: boolean }[] {
    const { clientWidth: width, clientHeight: height } = this.#element;
    const onScreen = (kind: string, at: THREE.Vector3) => {
      const point = at.project(this.#aimCamera);
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
      if (guard.down) return [];
      round.guardPose(index, this.#pose);
      const { x, y, z } = this.#pose.position;
      return onScreen(guard.role, new THREE.Vector3(x, y, z));
    });
    const rack = round.parts.flatMap((part) => {
      if (part.kind !== 'rack' || part.mode === 'broken') return [];
      const [x, y, z] = part.body.foot;
      return onScreen('rack', new THREE.Vector3(x, y + 0.6, z));
    });
    return [...guards, ...rack];
  }

  /** The end card: how it ended, the objectives, throws against par, stars, XP and spears back. */
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
    const titles = {
      all: 'Every objective done!',
      withdrew: result.won ? 'Withdrawn' : 'Withdrawn empty-handed',
      spears: result.won ? 'Out of spears' : 'The castle holds',
    };
    ui.cardTitle.textContent = titles[result.ending];
    const lines = [
      `Objectives: ${String(result.done)} of ${String(result.total)}`,
      `Throws: ${String(result.throws)} / par ${String(result.par)}`,
      `Spears shot: ${String(result.used)}`,
      `Guards down: ${String(result.guardsDown)} · parts down: ${String(result.partsDown)}`,
      `+${String(result.xp)} Command XP${result.starXp > 0 ? ` (★ bonus +${String(result.starXp)})` : ''}`,
    ];
    if (result.won) {
      lines.push(
        `${String(result.recovered)} spear${result.recovered === 1 ? '' : 's'} recovered${result.starSpears > 0 ? ` (★ bonus +${String(result.starSpears)})` : ''}`,
      );
    } else {
      lines.push('Nothing done: no spears recovered');
    }
    ui.cardText.textContent = lines.join('\n');
    ui.again.hidden = false;
    ui.card.hidden = false;
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
      .filter((spear) => spear.visible)
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
  }
}

/** Darkens a part drawn on its own (its own materials) for its damage. */
function tintObject(object: THREE.Object3D, stage: number): void {
  const tint = stageTint(0xffffff, stage);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.MeshLambertMaterial;
    if ('color' in material) material.color.copy(tint);
  });
}

/** A part's size, roughly: across (x), up (y) and deep (z), from its shapes. */
function footprintOf(shapes: readonly BodyShape[]): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, z: number) => {
    const point = [x, y, z];
    point.forEach((value, axis) => {
      min[axis] = Math.min(min[axis] ?? value, value);
      max[axis] = Math.max(max[axis] ?? value, value);
    });
  };
  for (const shape of shapes) {
    if (shape.kind === 'box') {
      const [hx, hy, hz] = shape.half;
      const reach = Math.hypot(hx, hz);
      grow(shape.at[0] - reach, shape.at[1] - hy, shape.at[2] - reach);
      grow(shape.at[0] + reach, shape.at[1] + hy, shape.at[2] + reach);
    } else if (shape.kind === 'cone') {
      grow(shape.at[0] - shape.radius, shape.at[1], shape.at[2] - shape.radius);
      grow(shape.at[0] + shape.radius, shape.at[1] + shape.height, shape.at[2] + shape.radius);
    } else {
      for (const [x, y, z] of shape.points) grow(x, y, z);
    }
  }
  return [0, 1, 2].map((axis) => Math.max((max[axis] ?? 0) - (min[axis] ?? 0), 0.1)) as [
    number,
    number,
    number,
  ];
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
  const [spearModel, guard] = await Promise.all([
    loadModel(skins.bolt.model),
    loadAnimatedModel(skins.guard.model),
  ]);
  // The spear is one part of its model (the ballista's bolt), by name.
  const part = skins.bolt.node ? spearModel.getObjectByName(skins.bolt.node) : undefined;
  const spear = (part ?? spearModel).clone(true);
  spear.position.set(0, 0, 0);
  spear.rotation.set(0, 0, 0);
  return { spear, guard };
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
    triangles: 0,
    physicsMs: [] as number[],
  };
}

/** The value `share` of the way up `values` once sorted (0 if there are none). */
function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
