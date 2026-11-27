import * as THREE from 'three';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { Birds } from './birds';
import { CabinModel } from './cabin';
import { TrunkCarver } from './carve';
import { Scenery } from './scenery';
import { Wreck } from './wreck';
import type { ScreenView } from '../../../app/screen';
import type { BackButton } from '../../../app/backButton';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import { loadModel } from '../../../app/models';
import { windTime } from '../../../app/scatter';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type Deposit, type ScreenPoint } from '../../../app/warchestHud';
import { Rng, type EventLogger, type Game, type LiveChoice, type LiveTuning } from '../../../core';
import type { Clearing, ClearingTree, SceneryPlantKind, WoodcuttingFeel } from '../../../data';
import {
  cabinSagTilt,
  fallTip,
  previewFelling,
  type BoulderRoll,
  type FallStep,
  type Point,
} from '../logic/chain';
import { fallTilt, rollDistance } from '../logic/fall';
import type { ChainForage, Forage } from '../logic/forage';
import { WoodcuttingRound, type RoundEvent, type RoundRoller } from '../logic/round';
import { chainLogs } from '../logic/score';
import type { ClearingPicker } from '../clearingPicker';
import type { FastFall } from '../fastFall';
import { fastFallUnlocked, unlocksBetween, woodcuttingSkill } from '../logic/unlocks';
import type { ClearingPlan } from '../logic/generate';
import type { SceneryDetail, TreeStyle } from '../treeStyle';

export interface Woodcutting3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<WoodcuttingFeel>;
  /** Which trees to draw; picked in the debug menu. */
  treeStyle: LiveChoice<TreeStyle>;
  /** Whether to draw the grass, plants and forest outside the fence. */
  scenery: LiveChoice<SceneryDetail>;
  haptics: Haptics;
  /** Picks each round's clearing: the tutorial first, then random ones. */
  clearings: ClearingPicker;
  /** The fast-fall switch, shown once its woodcutting level is reached. */
  fastFall: LiveChoice<FastFall>;
  /** Leaves the station (the round summary's Back to camp). */
  onLeave: () => void;
  /** The shell's top-left button, which becomes End round during a round. */
  backButton: BackButton;
}

interface Models {
  kenney: THREE.Object3D[];
  quaternius: THREE.Object3D[];
  stump: THREE.Object3D;
  axe: THREE.Object3D;
  plants: Record<SceneryPlantKind, THREE.Object3D>;
}

/** World units per clearing unit: the 360×640 clearing becomes 12×21 units. */
const SCALE = 1 / 30;
/** Frames (while aiming) to judge the detailed trees by, and the median frame time that's too slow. */
const FALLBACK_FRAMES = 90;
const FALLBACK_MS = 25;
/** When the summary's first star pops in, and the gap before each of the others (ms). */
const STAR_DELAY_MS = 450;
const STAR_STAGGER_MS = 380;
/** How long the summary stays after a star bonus has poured in, before leaving (ms). */
const BONUS_LINGER_MS = 350;
const MODELS = {
  kenney: ['tree_default', 'tree_oak', 'tree_detailed'].map((name) => `models/kenney/${name}.glb`),
  quaternius: ['CommonTree_1', 'CommonTree_3', 'Pine_1'].map(
    (name) => `models/quaternius/${name}.gltf`,
  ),
  stump: 'models/kenney/stump_round.glb',
  axe: 'models/kenney/tool-axe.glb',
  plants: {
    grassTall: 'Grass_Common_Tall',
    grassShort: 'Grass_Common_Short',
    fern: 'Fern_1',
    plant: 'Plant_1_Big',
    bush: 'Bush_Common',
    flowers: 'Flower_3_Group',
    rock: 'Rock_Medium_1',
    mushroom: 'Mushroom_Common',
  } satisfies Record<SceneryPlantKind, string>,
};
const SOUNDS: Record<string, string> = Object.fromEntries(
  [
    'chop-1',
    'chop-2',
    'chop-3',
    'chop-perfect',
    'creak-1',
    'creak-2',
    'creak-3',
    'land-1',
    'land-2',
    'land-3',
    'star',
    'rock-1',
    'rock-2',
    'crash-wood',
    'crash-glass',
    'crash-rumble',
  ].map((name) => [name, `audio/woodcutting/${name}.mp3`]),
);
/** The chain counter's colour by length: 2 trees, 3, 4, 5, 6, 7+. */
const COMBO_COLORS = ['#ffffff', '#fbe7a6', '#f6cf5a', '#f4a63a', '#f07f2c', '#ee5b2a'];
const COLORS = {
  sky: 0xa9cfe0,
  accent: 0xc8873a,
  guide: 0xf2ead3,
  gold: 0xe8c04f,
  wood: 0xe0c089,
  danger: 0xe0503c,
  roof: 0x6b3a2c,
  door: 0x4a2f1f,
  window: 0xf3e2a0,
  chimney: 0x8a8378,
  fence: 0x8b6a45,
  boulder: 0x9a968c,
  moss: 0x6f9a2a,
  patch: 0x4e3a28,
  redCap: 0xd8301e,
  stalk: 0xf1e8d6,
};
/** The fence: how tall, and posts about this far apart (clearing units). */
const FENCE_HEIGHT = 0.42;
const FENCE_POST_SPACING = 60;
/** Boulders are drawn a little less tall than wide. */
const BOULDER_SQUAT = 0.8;
/** Real seconds the camera's punch in toward a cabin crash lasts, and the share spent going in. */
const PUNCH_SECONDS = 0.7;
const PUNCH_IN = 0.12;
/** Quietest wreck knock that makes a sound or a puff (world units a second), and their spacing (ms). */
const KNOCK_SPEED = 1.2;
const KNOCK_GAP_MS = 55;
/** The trunk's box in the wreck's physics: this thick (world units). */
const PUSHER_THICKNESS = 0.3;
/** One-time hint the first time a clearing has a cabin. */
const HAZARD_HINT = 'hint.woodcutting.hazards';
/** Screen space the overlay uses: buttons and logs above, the chop panel below. */
const UI_TOP = 96;
const UI_BOTTOM = 236;
/** Pull-back aiming ignores the finger until it's this far (clearing units) from the tree. */
const AIM_DEAD_ZONE = 14;
/** Screen pixels of drag that pull the axe all the way back. */
const FULL_PULL = 120;
/** Seconds for the camera to move between the overview and the chop close-up. */
const CAMERA_MOVE = 0.6;
/** How much of a model's outermost leaf spread counts as its canopy when sizing it to the rules. */
const CANOPY_FILL = 0.9;
/** Chase camera while a chain falls: how high it looks down, how quickly it follows (per second), the
 * closest it comes, how early it starts framing a tree that's about to be hit, and how long it holds
 * on the result before going back to the overview. */
const CHASE_ELEVATION = 60 * (Math.PI / 180);
/** The chase looks at the fall a little from the side (toward the overview), so the arc shows. */
const CHASE_TURN = 35 * (Math.PI / 180);
/** Seconds the close-up holds after the felling chop, to watch the tree start to go. */
const CHASE_DELAY = 0.35;
const CHASE_FOLLOW = 5;
const CHASE_MIN_DISTANCE = 6;
const CHASE_LOOKAHEAD = 0.3;
const CHASE_HOLD = 0.9;
/** Room (world units) the camera leaves round a crashing cabin for its flying parts. */
const CRASH_VIEW_MARGIN = 1.6;
/** How far ahead (seconds) the chase frames a rolling boulder: where it's about to be. */
const CHASE_ROLL_AHEAD = 0.6;
/** Seconds a banked tree takes to sink away (hauled off). */
const HAUL_SECONDS = 0.6;
/** Rough trunk radius of the tree models after scaling, for where the axe bites. */
const TRUNK_RADIUS = 0.16;
/** Height of the cut and of the flat swing, in tree-model units. */
const CUT_HEIGHT = 0.7;
/** How far the axe head swings back toward the camera, around the hands, at full pull. */
const WIND_ARC = (100 * Math.PI) / 180;
/** The swing plane tips this far from level, so the blade comes down into the cut a little. */
const SWING_TILT = (15 * Math.PI) / 180;
/** Between chops the axe rests this far back out of the notch (share of the full wind), so the cut shows. */
const AXE_REST = 0.35;
/** Seconds the axe takes to come back out of the notch after a hit. */
const AXE_RECOVER = 0.3;
/** Level reach from the head back to the hands, and how much higher the hands are. */
const HANDLE_REACH = 0.9;
/** The struck face turns this far from facing the camera, so the notch shows beside the resting axe. */
const STRIKE_TURN = (50 * Math.PI) / 180;
const HANDS_ABOVE = 0.2;
const DEG = Math.PI / 180;

interface TreeVisual {
  tree: ClearingTree;
  root: THREE.Group;
  /** One pivot per trunk, at the base; each tips over toward its own direction. */
  trunks: THREE.Group[];
  stump: THREE.Object3D;
  /**
   * Trunk directions once it has fallen, how far each tipped (less than flat if it's leaning on
   * the cabin), and when it started sinking away.
   */
  fallen?: { trunks: number[]; tilts: number[]; sinkAt?: number };
  /** Once it has crashed into the cabin: when the cabin caved in, and how far each trunk sinks. */
  sag?: { at: number; tilts: (number | undefined)[] };
  /** Set once the chopped tree has broken at its notch: the trunks tip from this height. */
  brokenAt?: number;
}

/** Why the summary is up: every tree down, End round (can keep chopping), or the cabin hit. */
type SummaryKind = 'cleared' | 'paused' | 'crashed';

interface CloseUpFrame {
  base: THREE.Vector3;
  back: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
}

interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Screen-space shift (pixels) that keeps the subject clear of the overlay. */
  offsetY: number;
}

interface Particle {
  object: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  life: number;
  age: number;
  kind: ParticleKind;
}

/** Wood chips, a puff of dust, the cabin's billowing cloud of dust, its window's glass. */
type ParticleKind = 'chip' | 'dust' | 'cloud' | 'glass' | 'moss';

/**
 * How each kind of particle looks and moves: colour, opacity (below 1 fades and grows by `grow`
 * a second), launch speed (plus up to `speedRange`), seconds it lasts, gravity and air drag.
 */
const PARTICLES: Record<
  ParticleKind,
  {
    color: number;
    opacity: number;
    grow: number;
    speed: number;
    speedRange: number;
    life: number;
    gravity: number;
    drag: number;
  }
> = {
  chip: {
    color: 0xd8b483,
    opacity: 1,
    grow: 0,
    speed: 2.4,
    speedRange: 2,
    life: 0.6,
    gravity: 9,
    drag: 0,
  },
  dust: {
    color: 0xcbbd9a,
    opacity: 0.6,
    grow: 2.5,
    speed: 0.6,
    speedRange: 0.8,
    life: 0.9,
    gravity: 0,
    drag: 0,
  },
  cloud: {
    color: 0xc4b596,
    opacity: 0.55,
    grow: 1.6,
    speed: 1.6,
    speedRange: 1.4,
    life: 2.6,
    gravity: -0.25,
    drag: 1.4,
  },
  moss: {
    color: 0x7f9e2c,
    opacity: 1,
    grow: 0,
    speed: 1.8,
    speedRange: 1.4,
    life: 0.8,
    gravity: 9,
    drag: 0,
  },
  glass: {
    color: 0xdfeef2,
    opacity: 1,
    grow: 0,
    speed: 2,
    speedRange: 2.2,
    life: 1.4,
    gravity: 9,
    drag: 0,
  },
};

/** Every model the view draws (both tree styles, so switching style needs no loading). */
async function loadModels(): Promise<Models> {
  const plantKinds = Object.keys(MODELS.plants) as SceneryPlantKind[];
  const [kenney, quaternius, stump, axe, plantModels] = await Promise.all([
    Promise.all(MODELS.kenney.map(loadModel)),
    Promise.all(MODELS.quaternius.map(loadModel)),
    loadModel(MODELS.stump),
    loadModel(MODELS.axe),
    Promise.all(
      plantKinds.map((kind) => loadModel(`models/quaternius/${MODELS.plants[kind]}.gltf`)),
    ),
  ]);
  const plants = Object.fromEntries(
    plantKinds.map((kind, index) => [kind, plantModels[index]]),
  ) as Record<SceneryPlantKind, THREE.Object3D>;
  return { kenney, quaternius, stump, axe, plants };
}

function treeSeed(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/**
 * The woodcutting mini game in 3D: the rules (WoodcuttingRound) drawn with three.js and
 * low-poly CC0 models. An angled overview of the clearing for aiming and
 * watching chains; a close-up facing the trunk for chopping.
 */
export class Woodcutting3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Woodcutting3DDeps;
  /** This round's clearing; every generated one shares the tutorial clearing's size. */
  #clearing: Clearing;
  #plan: ClearingPlan | undefined;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  readonly #models: Models;
  readonly #sfx = new Sfx();
  /** The warchest in the HUD, which banked logs pour into. */
  readonly #hud: WarchestHud;
  /** The woodcutting level bar, top centre, which ticks up as banked logs land in the chest. */
  readonly #skillBar: SkillBar;
  /** XP from the last bank, held back until its logs pour in. */
  #bankedXp: XpDeposit | undefined;
  /** A banked chain waiting for the camera to settle on the overview before its logs pour. */
  #pendingPour:
    | {
        deposit: Deposit;
        trees: string[];
        /** What the chain foraged: each item poured from where it came from. */
        drops: Deposit[];
        forage: ChainForage;
      }
    | undefined;
  /**
   * Forage you can see, by what it is ('tree:id' mushrooms at a tree's foot, 'patch:id', and
   * 'boulder:id' the moss on a boulder): hidden once foraged.
   */
  #forageLooks = new Map<string, THREE.Object3D>();
  /**
   * The summary to show once the last logs are in the chest: the clearing is cleared, or the
   * player tapped End round (and can still keep chopping).
   */
  #summaryPending: SummaryKind | undefined;
  #summaryTimers: number[] = [];
  /** The longest chain banked this round, for the summary. */
  #bestChain = 0;
  /** The skill woodcutting trains, and its XP when this round started (for the summary). */
  readonly #skill: string;
  #xpAtStart = 0;
  /** Levels gained by a chain whose logs haven't poured in yet: the callout waits for them. */
  #levelUpPending: { from: number; to: number } | undefined;
  readonly #timer = new THREE.Timer();
  readonly #raycaster = new THREE.Raycaster();
  readonly #groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  #round!: WoodcuttingRound;
  #style: TreeStyle;
  #trees = new Map<string, TreeVisual>();
  #particles: Particle[] = [];
  #ui!: ReturnType<Woodcutting3DView['buildUi']>;
  #guides!: ReturnType<Woodcutting3DView['buildGuides']>;
  #axe!: { rig: THREE.Group; model: THREE.Group };
  /** The real notch in each tree chopped this round. */
  #carvers = new Map<string, TrunkCarver>();
  #overview!: CameraPose;
  #cameraFrom: CameraPose | undefined;
  #cameraTo: CameraPose | undefined;
  #cameraAt = 0;
  #cameraPose: CameraPose | undefined;
  #shake = 0;
  #frozenUntil = 0;
  #frameTimes: number[] = [];
  /** Frame times while aiming, for the older-phone fallback. */
  #aimFrames: number[] = [];
  /** The player picked a tree style (or the fallback already decided), so leave it alone. */
  #styleChosen = false;
  #pointer: { id: number; startX: number; startY: number } | undefined;
  #tether: THREE.Vector3 | undefined;
  #lastPhase = '';
  #cameraPhase = '';
  /** The pose drawn last frame, which the chase camera eases on from. */
  #shownPose: CameraPose | undefined;
  /** While a chain falls: the side it's watched from (level, toward the camera), and when to stop. */
  #chase: { side: THREE.Vector3; startAt: number; last?: CameraPose; endAt?: number } | undefined;
  /** A scratch camera for working out framings, so the real one is never disturbed. */
  readonly #framer = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  #frame = 0;
  /** This round's boulders, cabin and the fence. */
  readonly #hazards = new THREE.Group();
  /** This round's cabin, and once it's hit, its wreck and the trunk that hit it. */
  #cabin: { model: CabinModel; wreck?: Wreck; tree?: string; trunk?: number } | undefined;
  /** Grass, undergrowth, forest and props outside the fence, and the birds in that forest. */
  #scenery!: Scenery;
  readonly #birds: Birds;
  /** Random for the looks only (wreck, birds), seeded by the round so a crash replays alike. */
  #fxRng = new Rng(0);
  /** Slow motion until this time (performance.now ms), and the camera's punch in toward a crash. */
  #slowUntil = 0;
  #punch: { at: THREE.Vector3; start: number } | undefined;
  /** When the wreck last made a knock sound and a dust puff (performance.now ms). */
  #knockAt = 0;
  /**
   * This round's boulders: where each sits (`holder`), its tumble (`spinner`, `turned` once it's
   * stopped), and an outline shown while aiming.
   */
  #boulders = new Map<
    string,
    { holder: THREE.Group; spinner: THREE.Group; turned: THREE.Quaternion; ring: THREE.Mesh }
  >();
  /** Boulders rolling right now. */
  #rolling: RoundRoller[] = [];
  /** The cabin hint is up this round (the first clearing with one). */
  #hazardHint = false;
  /** Round time before which the summary waits (after a cabin crash, so its callout shows). */
  #summaryNotBefore = 0;
  /** Logs landed in the chest this round, for the live stars, and the most stars shown so far. */
  #starLogs = 0;
  #starsShown = 0;

  private constructor(
    element: HTMLElement,
    deps: Woodcutting3DDeps,
    models: Models,
    hud: WarchestHud,
  ) {
    this.#hud = hud;
    this.#birds = new Birds(deps.game.data.woodcutting.scenery.birds.seconds);
    this.#skill = woodcuttingSkill(deps.game.data);
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#element = element;
    this.#deps = deps;
    this.#models = models;
    const { woodcutting } = deps.game.data;
    const clearing = woodcutting.clearings.find(
      (entry) => entry.id === woodcutting.tutorialClearing,
    );
    if (!clearing) throw new Error('No woodcutting tutorial clearing in data');
    this.#clearing = clearing;
    this.#style = deps.treeStyle.value;
    this.#styleChosen = deps.treeStyle.picked;

    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'w3d-canvas';
    element.append(this.#renderer.domElement);

    this.#buildWorld();
    this.#ui = this.buildUi();
    this.#guides = this.buildGuides();
    this.#axe = this.#buildAxe();
    this.#buildTrees({ keepFallen: false });
    this.#sfx.load(SOUNDS);
    this.#listen();
    deps.treeStyle.onChange((style) => {
      this.#styleChosen = true;
      this.#applyStyle(style);
    });
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  /** Loads the models, then builds the view. */
  static async create(element: HTMLElement, deps: Woodcutting3DDeps): Promise<Woodcutting3DView> {
    const { game } = deps;
    const recipe = game.data.recipes.find((entry) => entry.id === game.data.woodcutting.recipe);
    const item = recipe?.outputs[0]?.item;
    if (!item) throw new Error('The woodcutting recipe makes nothing');
    const [models, hud] = await Promise.all([
      loadModels(),
      WarchestHud.create(element, { game, item, haptics: deps.haptics, logger: deps.logger }),
    ]);
    return new Woodcutting3DView(element, deps, models, hud);
  }

  /** Loads the models ahead of time (e.g. at the camp), so `create` doesn't wait for them. */
  static async preload(): Promise<void> {
    await Promise.all([loadModels(), WarchestHud.preload()]);
  }

  // ScreenView

  start(): void {
    restoreContext(this.#renderer);
    this.#hud.wake();
    const { game } = this.#deps;
    const plan = this.#deps.clearings.next();
    this.#plan = plan;
    this.#clearing = plan.clearing;
    this.#resize();
    this.#round = new WoodcuttingRound(
      this.#clearing,
      {
        logger: this.#deps.logger,
        feel: () => this.#feel(),
        chainExponent: this.#deps.game.data.woodcutting.chainExponent,
        forage: game.data.woodcutting.forage,
        ...(plan.seed !== undefined && { forageSeed: plan.seed }),
        bankDrops: (drops) => {
          for (const stack of drops) game.addItems(stack.item, stack.count);
        },
        bank: (batches) => {
          const before = game.level(this.#skill);
          const xpBefore = game.xp(this.#skill);
          const result = game.craft(game.data.woodcutting.recipe, { batches });
          const after = game.level(this.#skill);
          this.#bankedXp = this.#skillBar.hold(game.xp(this.#skill) - xpBefore);
          if (after > before) {
            this.#levelUpPending = { from: this.#levelUpPending?.from ?? before, to: after };
          }
          return result.produced.reduce((sum, stack) => sum + stack.count, 0);
        },
        onEvent: (event) => {
          this.#onEvent(event);
        },
        view: '3d',
        stars: {
          par: plan.par,
          ...game.data.woodcutting.stars,
          bonus: game.data.woodcutting.starBonus,
        },
      },
      Date.now() >>> 0,
    );
    this.#fxRng = new Rng(plan.seed ?? 0);
    this.#slowUntil = 0;
    this.#punch = undefined;
    this.#birds.clear();
    this.#buildTrees({ keepFallen: false });
    this.#buildHazards();
    this.#hazardHint = this.#clearing.cabin !== undefined && !game.hasDone(HAZARD_HINT);
    this.#lastPhase = '';
    this.#bestChain = 0;
    this.#xpAtStart = game.xp(this.#skill);
    this.#levelUpPending = undefined;
    this.#summaryPending = undefined;
    this.#summaryNotBefore = 0;
    this.#starLogs = 0;
    this.#starsShown = 0;
    this.#showLiveStars();
    this.#showEndRound();
    this.#frameTimes = [];
    this.#cameraPose = this.#overview;
    this.#cameraFrom = this.#cameraTo = undefined;
    this.#cameraPhase = '';
    this.#ui.summary.hidden = true;
    delete this.#ui.summaryButtons.dataset.busy;
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#pendingPour = undefined;
    this.#summaryPending = undefined;
    this.#clearSummaryTimers();
    this.#deps.backButton.set(undefined);
    this.#hud.sleep();
    this.#skillBar.settle();
    this.#bankedXp = undefined;
    this.#round.exit();
    this.#deps.clearings.finished();
    this.#logPerformance();
    delete document.body.dataset.woodcutting;
    this.#lastPhase = '';
    releaseContext(this.#renderer, this.#deps.logger, 'wood3d');
  }

  // World

  #world(point: Point, y = 0): THREE.Vector3 {
    return new THREE.Vector3(
      (point.x - this.#clearing.width / 2) * SCALE,
      y,
      (point.y - this.#clearing.height / 2) * SCALE,
    );
  }

  #toClearing(point: THREE.Vector3): Point {
    return {
      x: point.x / SCALE + this.#clearing.width / 2,
      y: point.z / SCALE + this.#clearing.height / 2,
    };
  }

  #buildWorld(): void {
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.fog = new THREE.Fog(COLORS.sky, 30, 70);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.6));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(6, 14, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const shadow = sun.shadow.camera;
    shadow.left = -9;
    shadow.right = 9;
    shadow.top = 13;
    shadow.bottom = -13;
    this.#scene.add(sun);

    // Thick grass all round; inside the fence it's worn to bare earth in places.
    this.#scene.add(groundMesh('meadowGrass', 80, 80));
    this.#scene.add(
      wornGround('troddenDirt', this.#clearing.width * SCALE, this.#clearing.height * SCALE, {
        cover: this.#deps.game.data.woodcutting.scenery.clearingWear,
        round: false,
        seed: 3,
      }),
    );
    this.#scene.add(this.#hazards);
    const { scenery } = this.#deps.game.data.woodcutting;
    this.#scenery = new Scenery(
      scenery,
      { width: this.#clearing.width, height: this.#clearing.height, scale: SCALE },
      this.#models.plants,
      this.#models.axe,
    );
    this.#scenery.setForest(this.#models[this.#style]);
    this.#scenery.group.visible = this.#deps.scenery.value === 'full';
    this.#deps.scenery.onChange((detail) => {
      this.#scenery.group.visible = detail === 'full';
    });
    this.#scene.add(this.#scenery.group);
    this.#scene.add(this.#birds.group);
    this.#deps.logger.log('woodcutting3d.scenery', {
      triangles: this.#scenery.triangles,
      forestTrees: this.#scenery.treetops.length,
    });
  }

  /**
   * This round's boulders and cabin, sized to the rules: each boulder fills its radius, and the
   * cabin its footprint and height, so what a falling tree touches is what counts.
   */
  #buildHazards(): void {
    this.#hazards.clear();
    for (const key of [...this.#forageLooks.keys()]) {
      if (!key.startsWith('tree:')) this.#forageLooks.delete(key);
    }
    this.#boulders.clear();
    this.#rolling = [];
    this.#cabin = undefined;
    this.#buildFence();
    this.#clearing.boulders.forEach((boulder, index) => {
      const model = this.#boulderModel(boulder.radius * SCALE, treeSeed(boulder.id) + index);
      const diameter = boulder.radius * 2 * SCALE;
      const spinner = new THREE.Group();
      spinner.add(model);
      spinner.position.y = (diameter * BOULDER_SQUAT) / 2;
      const turned = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        treeSeed(boulder.id + String(this.#plan?.seed ?? 0)) % 6,
      );
      spinner.quaternion.copy(turned);
      // A mossy boulder: a green cap on top, until it's first hit.
      const moss = this.#roundForage().boulders.get(boulder.id);
      if (moss !== undefined && !this.#hasForaged(`boulder:${boulder.id}`)) {
        const radius = boulder.radius * SCALE;
        const cap = this.#mossLumps(
          10 + moss * 4,
          radius * 0.7,
          radius * 0.3,
          radius * 0.8,
          index,
          1.6,
        );
        model.add(cap);
        this.#forageLooks.set(`boulder:${boulder.id}`, cap);
      }
      const holder = new THREE.Group();
      holder.add(spinner);
      holder.position.copy(this.#world(boulder));
      this.#hazards.add(holder);
      // While aiming, an outline drawn over the trees, so a boulder behind a canopy still shows.
      const radius = boulder.radius * SCALE;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.95, radius * 1.15, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: COLORS.guide,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          depthTest: false,
        }),
      );
      ring.renderOrder = 9;
      ring.position.copy(this.#world(boulder, 0.03));
      ring.visible = false;
      this.#hazards.add(ring);
      this.#boulders.set(boulder.id, { holder, spinner, turned, ring });
    });
    // Mushroom patches: a darker patch of earth thick with red caps.
    for (const patch of this.#roundForage().patches) {
      if (this.#hasForaged(`patch:${patch.id}`)) continue;
      const radius = patch.radius * SCALE;
      const group = new THREE.Group();
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 20).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: COLORS.patch }),
      );
      ground.position.y = 0.012;
      ground.receiveShadow = true;
      group.add(ground);
      group.add(this.#mushrooms(8, radius * 0.75, 0.2, treeSeed(patch.id), true));
      group.position.copy(this.#world(patch));
      this.#hazards.add(group);
      this.#forageLooks.set(`patch:${patch.id}`, group);
    }
    const cabin = this.#clearing.cabin;
    if (cabin) {
      const model = this.#buildCabin(cabin);
      model.group.position.copy(this.#world(cabin));
      this.#hazards.add(model.group);
      this.#cabin = { model };
    }
  }

  /** This round's forage: none until the first round starts (the scene is built before it). */
  #roundForage(): Forage {
    const round = this.#round as WoodcuttingRound | undefined;
    return round?.forage ?? { trees: new Map(), boulders: new Map(), patches: [] };
  }

  #hasForaged(key: string): boolean {
    const round = this.#round as WoodcuttingRound | undefined;
    return round?.hasForaged(key) ?? false;
  }

  /**
   * Moss: `count` soft green lumps (`scale` times the usual size) round something `radius` wide,
   * from `low` to `high` up it (seeded, so it looks the same each rebuild).
   */
  #mossLumps(
    count: number,
    radius: number,
    low: number,
    high: number,
    seed: number,
    scale = 1,
  ): THREE.Group {
    const rng = new Rng(seed + 7919);
    const group = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color: COLORS.moss, flatShading: true });
    for (let index = 0; index < count; index++) {
      const around = rng.range(0, Math.PI * 2);
      const size = rng.range(0.07, 0.12) * scale;
      const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), material);
      lump.position.set(Math.cos(around) * radius, rng.range(low, high), Math.sin(around) * radius);
      lump.scale.set(1, 0.7, 1);
      lump.castShadow = true;
      group.add(lump);
    }
    return group;
  }

  /**
   * A cluster of `count` red cap mushrooms round a spot, `spread` out (from a trunk, or all over a
   * patch when `inside`), each about `size` tall.
   */
  #mushrooms(
    count: number,
    spread: number,
    size: number,
    seed: number,
    inside = false,
  ): THREE.Group {
    const rng = new Rng(seed + 104729);
    const group = new THREE.Group();
    const stalk = new THREE.MeshLambertMaterial({ color: COLORS.stalk });
    const cap = new THREE.MeshLambertMaterial({ color: COLORS.redCap });
    for (let index = 0; index < count; index++) {
      const around = rng.range(0, Math.PI * 2);
      const out = inside ? Math.sqrt(rng.next()) * spread : spread + rng.range(0, 0.08);
      const tall = size * rng.range(0.75, 1.25);
      const mushroom = new THREE.Group();
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(tall * 0.18, tall * 0.24, tall, 6),
        stalk,
      );
      stem.position.y = tall / 2;
      const top = new THREE.Mesh(
        new THREE.SphereGeometry(tall * 0.55, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
        cap,
      );
      top.position.y = tall * 0.85;
      top.scale.y = 0.8;
      top.castShadow = true;
      mushroom.add(stem, top);
      mushroom.position.set(Math.cos(around) * out, 0, Math.sin(around) * out);
      mushroom.rotation.z = rng.range(-0.2, 0.2);
      group.add(mushroom);
    }
    return group;
  }

  /**
   * A boulder: a chunky low-poly stone, centred on its middle so it can tumble as it rolls, a
   * little lumpy (seeded, so each one keeps its shape) and a little squat.
   */
  #boulderModel(radius: number, seed: number): THREE.Mesh {
    const geometry = new THREE.IcosahedronGeometry(radius, 1);
    const position = geometry.getAttribute('position');
    const rng = new Rng(seed);
    // Shared corners move together, so the faces stay closed.
    const bumps = new Map<string, number>();
    for (let index = 0; index < position.count; index++) {
      const key = [position.getX(index), position.getY(index), position.getZ(index)]
        .map((value) => value.toFixed(3))
        .join(',');
      let bump = bumps.get(key);
      if (bump === undefined) {
        bump = 0.85 + rng.range(0, 0.25);
        bumps.set(key, bump);
      }
      position.setXYZ(
        index,
        position.getX(index) * bump,
        position.getY(index) * bump * BOULDER_SQUAT,
        position.getZ(index) * bump,
      );
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: COLORS.boulder, flatShading: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * A split-rail fence around the clearing, the cushion boulders bounce off. Built from boxes:
   * posts, and two rails between each pair.
   */
  #buildFence(): void {
    const { width, height } = this.#clearing;
    const material = new THREE.MeshLambertMaterial({ color: COLORS.fence });
    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
    corners.forEach((from, index) => {
      const to = corners[(index + 1) % corners.length] ?? from;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const posts = Math.max(Math.round(length / FENCE_POST_SPACING), 1);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      for (let post = 0; post < posts; post++) {
        const at = this.#world({
          x: from.x + ((to.x - from.x) * post) / posts,
          y: from.y + ((to.y - from.y) * post) / posts,
        });
        const upright = new THREE.Mesh(new THREE.BoxGeometry(0.09, FENCE_HEIGHT, 0.09), material);
        upright.position.set(at.x, FENCE_HEIGHT / 2, at.z);
        upright.castShadow = true;
        this.#hazards.add(upright);
      }
      const middle = this.#world({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
      for (const rail of [0.45, 0.85]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(length * SCALE, 0.05, 0.05), material);
        bar.position.set(middle.x, FENCE_HEIGHT * rail, middle.z);
        bar.rotation.y = -angle;
        bar.castShadow = true;
        this.#hazards.add(bar);
      }
    });
  }

  /**
   * The cabin, built from parts that can come apart (see CabinModel), its long side along the
   * longer of its footprint's sides and its door and window facing into the clearing.
   */
  #buildCabin(cabin: NonNullable<Clearing['cabin']>): CabinModel {
    const long = Math.max(cabin.width, cabin.depth) * SCALE;
    const short = Math.min(cabin.width, cabin.depth) * SCALE;
    const model = new CabinModel(
      long,
      short,
      cabin.height * SCALE,
      { roof: COLORS.roof, door: COLORS.door, window: COLORS.window, chimney: COLORS.chimney },
      new Rng(treeSeed(`${cabin.x},${cabin.y}`)),
    );
    // Face the clearing's middle from whichever edge it's on.
    const toMiddle = Math.atan2(
      this.#clearing.width / 2 - cabin.x,
      this.#clearing.height / 2 - cabin.y,
    );
    model.body.rotation.y =
      cabin.width >= cabin.depth
        ? Math.round(toMiddle / Math.PI) * Math.PI
        : Math.sign(toMiddle) * (Math.PI / 2);
    return model;
  }

  /**
   * A tree model sized to match the rules: its top reaches `reach` (the tree's height to its
   * canopy's centre, plus the canopy radius, so where it lands is where the rules say it reaches)
   * and its canopy is `radius` wide each way (the rules' canopy). Stretched up or slimmed as
   * needed, so what you see touch is what the chain counts.
   */
  #treeModel(source: THREE.Object3D, reach: number, radius: number): THREE.Group {
    const model = source.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const leaves = new THREE.Box3();
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = [child.material as THREE.Material | THREE.Material[]].flat();
      if (!materials.some((material) => /bark/i.test(material.name))) leaves.expandByObject(child);
    });
    const leafSize = (leaves.isEmpty() ? box : leaves).getSize(new THREE.Vector3());
    // Leaf edges are ragged, so the canopy reads a little narrower than its outermost leaves.
    const canopy = ((leafSize.x + leafSize.z) / 4) * CANOPY_FILL;
    const tall = reach / Math.max(size.y, 0.001);
    const wide = radius / Math.max(canopy, 0.001);
    model.scale.set(wide, tall, wide);
    model.position.set(-center.x * wide, -box.min.y * tall, -center.z * wide);
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    const holder = new THREE.Group();
    holder.add(model);
    return holder;
  }

  /** A copy of `source`, scaled to `height` tall, standing on y = 0 and centered on its trunk. */
  #modelOfHeight(source: THREE.Object3D, height: number): THREE.Group {
    const model = source.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = height / Math.max(size.y, 0.001);
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    const holder = new THREE.Group();
    holder.add(model);
    return holder;
  }

  /** Builds this round's trees. `keepFallen` for a style switch mid-round; a new round starts fresh. */
  #buildTrees({ keepFallen }: { keepFallen: boolean }): void {
    // Switching tree style mid-round rebuilds every tree: keep which ones are already down (and
    // being hauled off), or they'd pop back up looking standing when they aren't.
    const fallen = new Map(
      [...this.#trees.values()].flatMap((visual) =>
        !keepFallen ? [] : visual.fallen ? [[visual.tree.id, { ...visual.fallen }] as const] : [],
      ),
    );
    for (const carver of this.#carvers.values()) carver.dispose();
    this.#carvers.clear();
    for (const visual of this.#trees.values()) this.#scene.remove(visual.root);
    this.#trees.clear();
    for (const key of [...this.#forageLooks.keys()]) {
      if (key.startsWith('tree:')) this.#forageLooks.delete(key);
    }
    const sources = this.#models[this.#style];
    for (const tree of this.#clearing.trees) {
      const root = new THREE.Group();
      root.position.copy(this.#world(tree));
      const seed = treeSeed(tree.id);
      const forks = tree.forks?.length ?? 1;
      const trunks: THREE.Group[] = [];
      for (let i = 0; i < forks; i++) {
        const pivot = new THREE.Group();
        if (forks > 1) {
          const around = (i / forks) * Math.PI * 2 + seed;
          pivot.position.set(Math.cos(around) * 0.2, 0, Math.sin(around) * 0.2);
        }
        const source = sources[(seed + i) % sources.length] ?? sources[0];
        if (!source) throw new Error('No tree models loaded');
        const canopy = this.#clearing.canopyRadius;
        const model = this.#treeModel(source, (tree.height + canopy) * SCALE, canopy * SCALE);
        model.rotation.y = ((seed % 360) + i * 137) * DEG;
        pivot.add(model);
        root.add(pivot);
        trunks.push(pivot);
      }
      const stump = this.#modelOfHeight(this.#models.stump, 0.22);
      stump.visible = false;
      root.add(stump);
      // What it drops, shown from the start: moss up its trunk, mushrooms at its foot.
      const drop = this.#roundForage().trees.get(tree.id);
      if (drop && drop.moss > 0) {
        trunks.forEach((trunk, index) => {
          trunk.add(this.#mossLumps(6 + drop.moss * 3, TRUNK_RADIUS, 0.75, 1.6, seed + index, 1.4));
        });
        // A mossy skirt round its foot too, so it reads from above, under the canopy.
        if (!this.#hasForaged(`tree:${tree.id}`)) {
          const skirt = new THREE.Mesh(
            new THREE.CircleGeometry(TRUNK_RADIUS + 0.32, 14).rotateX(-Math.PI / 2),
            new THREE.MeshLambertMaterial({ color: COLORS.moss }),
          );
          skirt.position.y = 0.014;
          skirt.receiveShadow = true;
          skirt.add(this.#mossLumps(7, TRUNK_RADIUS + 0.16, 0, 0.04, seed, 1.3));
          root.add(skirt);
          this.#forageLooks.set(`tree:${tree.id}:moss`, skirt);
        }
      }
      if (drop && drop.mushrooms > 0 && !this.#hasForaged(`tree:${tree.id}`)) {
        const caps = this.#mushrooms(2 + drop.mushrooms, TRUNK_RADIUS + 0.14, 0.2, seed);
        root.add(caps);
        this.#forageLooks.set(`tree:${tree.id}`, caps);
      }
      this.#scene.add(root);
      const down = fallen.get(tree.id);
      this.#trees.set(tree.id, { tree, root, trunks, stump, ...(down ? { fallen: down } : {}) });
    }
  }

  /**
   * The felling chop: finish the notch, break the trunk there, and make each trunk tip over from
   * the break, leaving the notched stump standing.
   */
  #breakAtNotch(visual: TreeVisual, carver: TrunkCarver): void {
    carver.carve(1);
    const top = visual.trunks[0];
    if (top) carver.split(top);
    visual.brokenAt = CUT_HEIGHT;
    for (const trunk of visual.trunks) {
      trunk.position.y = CUT_HEIGHT;
      for (const child of trunk.children) child.position.y -= CUT_HEIGHT;
    }
  }

  /** Tips a trunk over toward `angle` (clearing radians) by `tilt` radians from upright. */
  #tip(trunk: THREE.Group, angle: number, tilt: number): void {
    const axis = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)).normalize();
    trunk.quaternion.setFromAxisAngle(axis, tilt);
  }

  // Guides (all on the ground)

  buildGuides() {
    const flat = (geometry: THREE.BufferGeometry, color: number, opacity: number) => {
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(
        geometry,
        // Drawn over everything, so trunks and canopies never hide where a tree will go.
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          depthTest: false,
        }),
      );
      mesh.renderOrder = 10;
      mesh.visible = false;
      this.#scene.add(mesh);
      return mesh;
    };
    const strip = (color: number, opacity: number) => {
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.translate(0.5, 0, 0);
      return flat(geometry, color, opacity);
    };
    const canopy = this.#clearing.canopyRadius * SCALE;
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0.28, 0);
    arrowShape.lineTo(-0.05, 0.16);
    arrowShape.lineTo(-0.05, -0.16);
    arrowShape.closePath();
    const sets = Array.from({ length: 3 }, () => ({
      line: strip(COLORS.guide, 0.7),
      ghost: flat(new THREE.RingGeometry(canopy - 0.05, canopy + 0.03, 40), COLORS.guide, 0.85),
      hitLine: strip(COLORS.gold, 0.85),
      hitHead: flat(new THREE.ShapeGeometry(arrowShape), COLORS.gold, 0.95),
      /** Where the knocked tree's canopy will land. */
      hitLand: flat(new THREE.RingGeometry(canopy - 0.05, canopy + 0.03, 40), COLORS.gold, 0.9),
      /** A boulder it sets rolling: one line per leg between fence bounces. */
      rollLegs: Array.from({ length: 6 }, () => strip(COLORS.gold, 0.85)),
    }));
    return {
      selection: flat(new THREE.RingGeometry(canopy + 0.12, canopy + 0.24, 40), COLORS.accent, 1),
      tether: strip(COLORS.accent, 0.6),
      sets,
    };
  }

  #placeStrip(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, width: number): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    mesh.position.set(from.x, 0.04, from.z);
    mesh.rotation.set(0, -Math.atan2(dz, dx), 0);
    mesh.scale.set(Math.max(Math.hypot(dx, dz), 0.001), 1, width);
    mesh.visible = true;
  }

  #updateGuides(): void {
    const { selection, tether, sets } = this.#guides;
    selection.visible = tether.visible = false;
    for (const set of sets)
      set.line.visible =
        set.ghost.visible =
        set.hitLine.visible =
        set.hitHead.visible =
        set.hitLand.visible =
          false;
    for (const set of sets) for (const leg of set.rollLegs) leg.visible = false;
    const phase = this.#round.phase;
    for (const boulder of this.#boulders.values()) boulder.ring.visible = phase.kind === 'aim';
    // What the guide shows, for the e2e test: the cabin, or a boulder set rolling.
    delete this.#element.dataset.guide;
    // The ground guides are for the overview; the chop close-up stays clean.
    if (phase.kind !== 'aim') return;
    const tree = this.#trees.get(phase.tree)?.tree;
    if (!tree) return;
    const base = this.#world(tree);
    selection.position.set(base.x, 0.03, base.z);
    selection.visible = true;
    if (phase.dragging && this.#tether) {
      this.#placeStrip(tether, base, this.#tether, 0.1);
    }
    if (phase.angle === undefined) return;
    const round = this.#round;
    const previews = previewFelling(
      round.clearing,
      round.standing,
      tree,
      phase.angle,
      round.boulderRules,
    );
    previews.forEach((preview, index) => {
      const set = sets[index];
      if (!set) return;
      // Red: what the guide shows reaches the cabin.
      const tint = (mesh: THREE.Mesh, color: number) => {
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(
          preview.danger ? COLORS.danger : color,
        );
      };
      for (const mesh of [set.line, set.ghost]) tint(mesh, COLORS.guide);
      for (const mesh of [set.hitLine, set.hitHead, set.hitLand, ...set.rollLegs])
        tint(mesh, COLORS.gold);
      this.#element.dataset.guide = preview.danger
        ? 'cabin'
        : preview.roll
          ? 'roll'
          : (this.#element.dataset.guide ?? 'clear');
      const ghost = this.#world(preview.ghost);
      this.#placeStrip(set.line, base, ghost, 0.06);
      set.ghost.position.set(ghost.x, 0.05, ghost.z);
      set.ghost.visible = true;
      const canopy = this.#clearing.canopyRadius * SCALE;
      if (preview.roll) {
        // The boulder's roll, bounce by bounce, an arrow where it stops and its outline there.
        const points = preview.roll.path.map((point) => this.#world(point));
        const legs = points.slice(1).map((to, index) => ({ from: points[index] ?? to, to }));
        legs.forEach(({ from, to }, index) => {
          const mesh = set.rollLegs[index];
          if (mesh) this.#placeStrip(mesh, from, to, 0.08);
        });
        const last = legs[legs.length - 1];
        if (last) {
          const angle = Math.atan2(last.to.z - last.from.z, last.to.x - last.from.x);
          set.hitHead.position.set(last.to.x, 0.05, last.to.z);
          set.hitHead.rotation.set(0, -angle, 0);
          set.hitHead.visible = true;
          set.hitLand.position.set(last.to.x, 0.05, last.to.z);
          set.hitLand.scale.setScalar((preview.roll.radius * SCALE) / canopy);
          set.hitLand.visible = true;
        }
        return;
      }
      set.hitLand.scale.setScalar(1);
      if (preview.hit) {
        const hitTree = this.#trees.get(preview.hit.tree)?.tree;
        if (!hitTree) return;
        const from = this.#world(hitTree);
        // The knocked tree's whole fall: a line to where its top lands (or it meets the cabin),
        // and its landing ring.
        const hitPath = preview.hit.path;
        const angle = hitPath.angle;
        const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const land = hitPath.cabin
          ? from.clone().addScaledVector(direction, hitPath.cabin.at * SCALE)
          : this.#world(fallTip(hitTree, angle));
        const lineEnd = land.clone().addScaledVector(direction, -canopy - 0.25);
        this.#placeStrip(set.hitLine, from, lineEnd, 0.08);
        set.hitHead.position.set(lineEnd.x, 0.05, lineEnd.z);
        set.hitHead.rotation.set(0, -angle, 0);
        set.hitHead.visible = true;
        set.hitLand.position.set(land.x, 0.05, land.z);
        set.hitLand.visible = true;
      }
    });
  }

  // Axe and bite (close-up)

  #buildAxe() {
    const rig = new THREE.Group();
    // The model stands with its handle up the Y axis, head at the top, blade toward −X.
    const model = this.#modelOfHeight(this.#models.axe, 1);
    const holder = new THREE.Group();
    holder.add(model);
    rig.add(holder);
    rig.visible = false;
    this.#scene.add(rig);
    return { rig, model: holder };
  }

  /** Frame for the close-up around the chosen tree: toward the camera, to its right, up. */
  #closeUpFrame(treeId: string, angle: number): CloseUpFrame | undefined {
    const tree = this.#trees.get(treeId)?.tree;
    if (!tree) return undefined;
    const base = this.#world(tree);
    const back = new THREE.Vector3(-Math.cos(angle), 0, -Math.sin(angle));
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, back).normalize().negate();
    return { base, back, up, right };
  }

  /**
   * Which side of the trunk the axe strikes (`cut`, level, out of the trunk) and which way the
   * handle runs from the head back to the hands (`toHands`, level): the hands stand left of the
   * trunk and toward the camera, with the handle square to `cut` so the blade faces straight in.
   */
  #strikeSide(frame: CloseUpFrame) {
    const { back, right } = frame;
    const turn = STRIKE_TURN;
    // `right` points to the screen's left in the close-up; the struck face turns to screen right.
    const cut = back.clone().multiplyScalar(Math.cos(turn)).addScaledVector(right, -Math.sin(turn));
    const toHands = right
      .clone()
      .multiplyScalar(Math.cos(turn))
      .addScaledVector(back, Math.sin(turn));
    return { cut, toHands };
  }

  /**
   * The axe at the moment of impact: the head in the notch (deeper as the notch deepens), the
   * hands back along the handle and a little higher, for a slightly downward strike.
   */
  #grip(treeId: string, frame: CloseUpFrame) {
    const { base, up } = frame;
    const { cut, toHands } = this.#strikeSide(frame);
    const carver = this.#carvers.get(treeId);
    const surface = carver?.surface ?? TRUNK_RADIUS;
    const depth = carver?.depth ?? 0;
    const head = base
      .clone()
      .addScaledVector(cut, surface + 0.03 - depth * 0.7)
      .addScaledVector(up, CUT_HEIGHT);
    const hands = head
      .clone()
      .addScaledVector(toHands, HANDLE_REACH)
      .addScaledVector(up, HANDS_ABOVE);
    const handle = head.clone().sub(hands);
    return { hands, head, along: handle.clone().normalize(), cut, length: handle.length() };
  }

  /**
   * How far the axe is wound back (share of the full arc). It rests a little out of the notch,
   * swings all the way in on a hit, then eases back out to rest.
   */
  #axeOut(): number {
    const phase = this.#round.phase;
    if (phase.kind !== 'chop') return 0;
    const wound = (pull: number) => AXE_REST + (1 - AXE_REST) * pull;
    if (phase.hold) return wound(phase.hold.pull);
    const swing = phase.swing;
    if (!swing) return AXE_REST;
    const since = this.#round.now - swing.at;
    const swingSeconds = this.#round.feel.swingSeconds;
    if (since < swingSeconds) {
      const t = since / swingSeconds;
      return wound(swing.pull) * (1 - t * t);
    }
    const back = Math.min((since - swingSeconds) / AXE_RECOVER, 1);
    return AXE_REST * back * back * (3 - 2 * back);
  }

  /** The chopped tree's notch, measured the first time it is needed. */
  #carverFor(treeId: string, frame: CloseUpFrame): TrunkCarver | undefined {
    const existing = this.#carvers.get(treeId);
    if (existing) return existing;
    const visual = this.#trees.get(treeId);
    if (!visual) return undefined;
    const carver = new TrunkCarver(
      visual.root,
      frame.base,
      this.#strikeSide(frame).cut,
      CUT_HEIGHT,
      TRUNK_RADIUS,
    );
    this.#carvers.set(treeId, carver);
    return carver;
  }

  /**
   * Poses the axe at the cut. Pulling back swings the head around the hands, back toward the
   * camera and a little up; letting go swings it into the notch on a slightly downward path.
   */
  #updateAxe(): void {
    const phase = this.#round.phase;
    const { rig, model } = this.#axe;
    if (phase.kind !== 'chop') {
      rig.visible = false;
      return;
    }
    const frame = this.#closeUpFrame(phase.tree, phase.angle);
    if (!frame) return;
    this.#carverFor(phase.tree, frame);
    const { hands, along, cut, length } = this.#grip(phase.tree, frame);
    // Model axes: +Y along the handle, −X toward the blade (into the trunk), Z square to both.
    const side = new THREE.Vector3().crossVectors(cut, along).normalize();
    model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(cut, along, side));
    model.scale.setScalar(length);
    rig.position.copy(hands);
    // Turn around the hands so the head heads out of the cut and slightly up: a swing plane tipped
    // a little from level, so the blade comes back down into the notch.
    const outward = cut.clone().addScaledVector(frame.up, Math.tan(SWING_TILT)).normalize();
    const axis = new THREE.Vector3().crossVectors(along, outward).normalize();
    rig.quaternion.setFromAxisAngle(axis, WIND_ARC * this.#axeOut());
    rig.visible = true;
  }

  // Camera

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#overview = this.#fitOverview(width, height);
    if (!this.#cameraTo) this.#cameraPose = this.#overview;
  }

  /** The angled overview that fits the whole clearing between the overlay's top and bottom. */
  #fitOverview(width: number, height: number): CameraPose {
    const target = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(0, Math.sin(55 * DEG), Math.cos(55 * DEG));
    const corners = [
      { x: 0, y: 0 },
      { x: this.#clearing.width, y: 0 },
      { x: 0, y: this.#clearing.height },
      { x: this.#clearing.width, y: this.#clearing.height },
    ].flatMap((corner) => [this.#world(corner), this.#world(corner, 3.2)]);
    const band = { top: UI_TOP, bottom: height - UI_BOTTOM };
    let pose: CameraPose = { position: direction.clone().multiplyScalar(40), target, offsetY: 0 };
    for (let distance = 8; distance <= 60; distance += 0.5) {
      const position = direction.clone().multiplyScalar(distance);
      this.#camera.position.copy(position);
      this.#camera.lookAt(target);
      this.#camera.clearViewOffset();
      this.#camera.updateMatrixWorld();
      const screen = corners.map((corner) => {
        const projected = corner.clone().project(this.#camera);
        return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
      });
      const xs = screen.map((point) => point.x);
      const ys = screen.map((point) => point.y);
      const contentHeight = Math.max(...ys) - Math.min(...ys);
      const fits =
        Math.min(...xs) >= 8 &&
        Math.max(...xs) <= width - 8 &&
        contentHeight <= band.bottom - band.top;
      if (fits) {
        const contentCenter = (Math.max(...ys) + Math.min(...ys)) / 2;
        pose = { position, target, offsetY: contentCenter - (band.top + band.bottom) / 2 };
        break;
      }
    }
    return pose;
  }

  #closeUpPose(treeId: string, angle: number): CameraPose | undefined {
    const frame = this.#closeUpFrame(treeId, angle);
    if (!frame) return undefined;
    const { base, back, up } = frame;
    // Behind the feller and high, looking down on the level swing so its whole arc (head swung
    // back toward the camera) fits in a narrow portrait view, and out from under the canopy.
    return {
      position: base.clone().addScaledVector(back, 3.6).addScaledVector(up, 3.2),
      target: base.clone().addScaledVector(up, 0.55).addScaledVector(back, 0.3),
      offsetY: this.#element.clientHeight * 0.14,
    };
  }

  // Chase camera

  /** The cabin has been hit this round: from then on the camera and the juice are on it alone. */
  get #crashed(): boolean {
    return this.#cabin?.wreck !== undefined;
  }

  /**
   * The camera on the cabin coming down: its footprint and height, plus room round it for flying
   * parts, seen from the side the camera is already on.
   */
  #crashPose(shape: NonNullable<Clearing['cabin']>): CameraPose {
    const from = this.#shownPose ?? this.#overview;
    const direction = from.position.clone().sub(from.target).normalize();
    const reach = (Math.max(shape.width, shape.depth) / 2) * SCALE + CRASH_VIEW_MARGIN;
    const middle = this.#world(shape);
    const points = [0, 1].flatMap((up) =>
      [-1, 1].flatMap((x) =>
        [-1, 1].map((z) =>
          middle
            .clone()
            .add(new THREE.Vector3(x * reach, up * shape.height * SCALE * 1.4, z * reach)),
        ),
      ),
    );
    return this.#framing(points, direction, CHASE_MIN_DISTANCE);
  }

  /** The felling chop: watch the chain from behind the chopped tree instead of cutting away. */
  #startChase(first: FallStep | undefined): void {
    const frame = first && this.#closeUpFrame(first.tree, first.angle);
    if (!frame) {
      this.#moveCamera(this.#overview);
      return;
    }
    this.#cameraFrom = this.#cameraTo = undefined;
    this.#cameraPose = this.#shownPose ?? this.#cameraPose;
    // From behind the tree, turned a little toward the overview's side of the clearing.
    const turned = (sign: number) => frame.back.clone().applyAxisAngle(frame.up, sign * CHASE_TURN);
    const left = turned(1);
    const right = turned(-1);
    const side = left.z >= right.z ? left : right;
    this.#chase = { side, startAt: this.#round.now + CHASE_DELAY };
  }

  /**
   * Eases toward a framing of the trees falling right now. Once the last one has landed, holds a
   * moment on it, then heads back to the overview.
   */
  #followChase(dt: number): CameraPose | undefined {
    const chase = this.#chase;
    if (!chase) return undefined;
    const goal = this.#chaseGoal(chase.side) ?? chase.last;
    if (goal) chase.last = goal;
    if (this.#round.fallers.length === 0) chase.endAt ??= this.#round.now + CHASE_HOLD;
    if (chase.endAt !== undefined && this.#round.now >= chase.endAt) {
      this.#chase = undefined;
      this.#moveCamera(this.#overview);
      return this.#cameraPose;
    }
    const from = this.#shownPose ?? this.#overview;
    if (!goal || this.#round.now < chase.startAt) return from;
    // Orbit rather than slide: ease the look-at point, the viewing direction and the distance
    // separately, so the camera swings out around the action instead of cutting through canopies.
    const k = 1 - Math.exp(-CHASE_FOLLOW * dt);
    const target = from.target.clone().lerp(goal.target, k);
    const fromOffset = from.position.clone().sub(from.target);
    const goalOffset = goal.position.clone().sub(goal.target);
    const distance = fromOffset.length() + (goalOffset.length() - fromOffset.length()) * k;
    const direction = fromOffset.normalize().lerp(goalOffset.normalize(), k).normalize();
    const pose: CameraPose = {
      position: target.clone().addScaledVector(direction, distance),
      target,
      offsetY: from.offsetY + (goal.offsetY - from.offsetY) * k,
    };
    this.#cameraPose = pose;
    return pose;
  }

  /**
   * Where the chase camera wants to be: framing the trees falling right now (base, top and where
   * each lands) and boulders rolling. When the chain splits it widens to keep both paths; as trees land it closes in
   * on whatever is still going.
   */
  #chaseGoal(side: THREE.Vector3): CameraPose | undefined {
    const round = this.#round;
    const feel = round.feel;
    const points: THREE.Vector3[] = [];
    const canopy = this.#clearing.canopyRadius * SCALE * 1.3;
    for (const faller of round.fallers) {
      // Only trees falling right now (and one about to be hit), not ones already down.
      if (faller.landed || round.now < faller.start - CHASE_LOOKAHEAD) continue;
      const visual = this.#trees.get(faller.step.tree);
      if (!visual) continue;
      const { tree } = visual;
      const height = (tree.height + this.#clearing.canopyRadius) * SCALE;
      const tilt = fallTilt(
        Math.max(round.now - faller.start, 0) / feel.fallSeconds,
        feel.fallEase,
      );
      const base = this.#world(tree);
      // Room around the stump too, so it never sits right at the edge.
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        points.push(base.clone().add(new THREE.Vector3(dx, 0, dz).multiplyScalar(canopy * 0.6)));
      }
      for (const angle of faller.step.trunks) {
        const along = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const across = new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(canopy);
        const top = base
          .clone()
          .addScaledVector(along, height * Math.sin(tilt))
          .setY(height * Math.cos(tilt));
        const tip = this.#world(fallTip(tree, angle));
        // The canopy's width either side of the top now and where it lands, so it stays in frame.
        for (const point of [top, tip]) {
          points.push(point.clone().add(across), point.clone().sub(across));
        }
      }
    }
    // Boulders rolling now (or about to be): where each is and where it'll be a moment later, not
    // its whole roll, which can cross the clearing and bounce back.
    const speed = feel.boulderSpeed;
    for (const roller of round.rollers) {
      if (round.now < roller.start - CHASE_LOOKAHEAD || round.now > roller.end) continue;
      const { roll } = roller;
      const radius =
        (round.clearing.boulders.find((boulder) => boulder.id === roll.boulder)?.radius ?? 0) *
        SCALE;
      for (const ahead of [0, CHASE_ROLL_AHEAD]) {
        const elapsed = Math.max(round.now + ahead - roller.start, 0);
        const at = this.#world(
          rollPoint(roll, rollDistance(elapsed, roll.natural, speed, roll.distance)),
        );
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          points.push(at.clone().add(new THREE.Vector3(dx, 0, dz).multiplyScalar(radius * 2)));
        }
      }
    }
    if (points.length === 0) return undefined;
    const direction = side
      .clone()
      .multiplyScalar(Math.cos(CHASE_ELEVATION))
      .setY(Math.sin(CHASE_ELEVATION))
      .normalize();
    const pose = this.#framing(points, direction, CHASE_MIN_DISTANCE);
    // Spread wider than the overview shows: the overview is the better view of it all.
    const overview = this.#overview;
    if (pose.position.distanceTo(pose.target) > overview.position.distanceTo(overview.target)) {
      return overview;
    }
    return pose;
  }

  /**
   * The closest camera looking along -`direction` that fits all `points` between the overlay's
   * top and bottom bands, centred on them.
   */
  #framing(points: THREE.Vector3[], direction: THREE.Vector3, minDistance: number): CameraPose {
    const { clientWidth: width, clientHeight: height } = this.#element;
    const box = new THREE.Box3().setFromPoints(points);
    const target = box.getCenter(new THREE.Vector3());
    const band = { top: UI_TOP + 16, bottom: height - UI_BOTTOM - 16 };
    const camera = this.#framer;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    const screen = (distance: number) => {
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      return points.map((point) => {
        const projected = point.clone().project(camera);
        return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
      });
    };
    const fits = (distance: number) => {
      const spots = screen(distance);
      const xs = spots.map((spot) => spot.x);
      const ys = spots.map((spot) => spot.y);
      return (
        Math.min(...xs) >= 36 &&
        Math.max(...xs) <= width - 36 &&
        Math.max(...ys) - Math.min(...ys) <= band.bottom - band.top
      );
    };
    let near = minDistance;
    let far = 80;
    if (!fits(near)) {
      for (let i = 0; i < 18; i++) {
        const middle = (near + far) / 2;
        if (fits(middle)) far = middle;
        else near = middle;
      }
      near = far;
    }
    const ys = screen(near).map((spot) => spot.y);
    const middle = (Math.max(...ys) + Math.min(...ys)) / 2;
    return {
      position: target.clone().addScaledVector(direction, near),
      target,
      offsetY: middle - (band.top + band.bottom) / 2,
    };
  }

  #moveCamera(to: CameraPose): void {
    this.#cameraFrom = this.#cameraPose ?? this.#overview;
    this.#cameraTo = to;
    this.#cameraAt = this.#round.now;
  }

  #updateCamera(dt: number): void {
    let pose = this.#cameraPose ?? this.#overview;
    if (this.#chase) {
      pose = this.#followChase(dt) ?? pose;
    } else if (this.#cameraFrom && this.#cameraTo) {
      const t = Math.min((this.#round.now - this.#cameraAt) / CAMERA_MOVE, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      pose = {
        position: this.#cameraFrom.position.clone().lerp(this.#cameraTo.position, eased),
        target: this.#cameraFrom.target.clone().lerp(this.#cameraTo.target, eased),
        offsetY:
          this.#cameraFrom.offsetY + (this.#cameraTo.offsetY - this.#cameraFrom.offsetY) * eased,
      };
      if (t >= 1) {
        this.#cameraPose = this.#cameraTo;
        this.#cameraFrom = this.#cameraTo = undefined;
      }
    }
    this.#shownPose = pose;
    const shake = this.#shake;
    this.#camera.position.copy(pose.position);
    // A crash punches the camera in toward it, fast, then eases back.
    const punch = this.#punch;
    if (punch) {
      const t = (performance.now() - punch.start) / (PUNCH_SECONDS * 1000);
      if (t >= 1) {
        this.#punch = undefined;
      } else {
        const amount = t < PUNCH_IN ? t / PUNCH_IN : (1 - (t - PUNCH_IN) / (1 - PUNCH_IN)) ** 2;
        this.#camera.position.lerp(punch.at, amount * this.#round.feel.crashPunch);
      }
    }
    if (shake > 0.0005) {
      this.#camera.position.x += (Math.random() - 0.5) * shake;
      this.#camera.position.y += (Math.random() - 0.5) * shake;
      this.#shake *= 0.85;
    }
    this.#camera.lookAt(pose.target);
    const { clientWidth: width, clientHeight: height } = this.#element;
    this.#camera.setViewOffset(width, height, 0, pose.offsetY, width, height);
  }

  // Input

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      // The round waits while its summary is up (or about to be).
      if (!this.#ui.summary.hidden || this.#summaryPending) return;
      canvas.setPointerCapture(event.pointerId);
      this.#pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY };
      const phase = this.#round.phase;
      if (phase.kind === 'pick' || phase.kind === 'aim') {
        const point = this.#groundAt(event.clientX, event.clientY);
        const tree = point && this.#treeNear(this.#toClearing(point));
        if (tree) {
          this.#round.touchTree(tree.id);
          this.#tether = point;
        }
      } else if (phase.kind === 'chop') {
        this.#round.grab();
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.#pointer?.id !== event.pointerId) return;
      const phase = this.#round.phase;
      if (phase.kind === 'aim' && phase.dragging) {
        const point = this.#groundAt(event.clientX, event.clientY);
        const tree = this.#trees.get(phase.tree)?.tree;
        if (!point || !tree) return;
        this.#tether = point;
        const finger = this.#toClearing(point);
        const distance = Math.hypot(finger.x - tree.x, finger.y - tree.y);
        this.#round.aimTo(
          distance < AIM_DEAD_ZONE ? undefined : Math.atan2(tree.y - finger.y, tree.x - finger.x),
        );
      } else if (phase.kind === 'chop') {
        const moved = Math.hypot(
          event.clientX - this.#pointer.startX,
          event.clientY - this.#pointer.startY,
        );
        this.#round.setPull((moved - 12) / FULL_PULL);
      }
    });
    const release = (event: PointerEvent) => {
      if (this.#pointer?.id !== event.pointerId) return;
      this.#pointer = undefined;
      this.#tether = undefined;
      const phase = this.#round.phase;
      if (phase.kind === 'aim') this.#round.releaseAim();
      else if (phase.kind === 'chop') this.#round.releaseAxe();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  #groundAt(clientX: number, clientY: number): THREE.Vector3 | undefined {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.#camera);
    return this.#raycaster.ray.intersectPlane(this.#groundPlane, new THREE.Vector3()) ?? undefined;
  }

  #treeNear(point: Point): ClearingTree | undefined {
    const reach = Math.max(25, this.#clearing.canopyRadius * 1.8);
    let best: { tree: ClearingTree; distance: number } | undefined;
    for (const id of this.#round.standing) {
      const tree = this.#trees.get(id)?.tree;
      if (!tree) continue;
      const distance = Math.hypot(tree.x - point.x, tree.y - point.y);
      if (distance <= reach && (!best || distance < best.distance)) best = { tree, distance };
    }
    return best?.tree;
  }

  // Round events → effects

  #onEvent(event: RoundEvent): void {
    const feel = this.#round.feel;
    if (event.type === 'impact') {
      const { swing } = event;
      const phase = this.#round.phase;
      const frame = phase.kind === 'chop' ? this.#closeUpFrame(phase.tree, phase.angle) : undefined;
      const carver = frame && this.#carverFor(event.tree, frame);
      if (frame && carver) {
        carver.carve(event.points / feel.chopPoints);
        const { cut } = this.#strikeSide(frame);
        const at = frame.base
          .clone()
          .addScaledVector(cut, carver.surface)
          .addScaledVector(frame.up, CUT_HEIGHT);
        this.#burst('chip', at, 6 + swing.points * 5, cut);
      }
      this.#shake =
        (swing.result === 'perfect' ? 0.12 : 0.06) * feel.shakeStrength * (0.6 + swing.pull * 0.6);
      const drift = Math.round(Math.abs(swing.drift / DEG));
      const drifted = drift >= 1 ? ` · aim off ${drift}°` : '';
      this.#deps.haptics.pulse(swing.result === 'perfect' ? feel.buzzPerfectMs : feel.buzzChopMs);
      if (swing.result === 'perfect') {
        this.#play('chop-perfect', 0.9);
        this.#frozenUntil = performance.now() + feel.hitStopMs;
        this.#flash(`Perfect! +${swing.points}`, 'perfect');
      } else {
        this.#play(
          `chop-${1 + Math.floor(Math.random() * 3)}`,
          swing.result === 'good' ? 0.6 + swing.pull * 0.3 : 0.5,
        );
        this.#flash(
          `${swing.result === 'good' ? 'Good' : 'Glancing'} +${swing.points}${drifted}`,
          swing.result,
        );
      }
    } else if (event.type === 'fell') {
      for (const step of event.steps) {
        const visual = this.#trees.get(step.tree);
        if (visual) {
          visual.fallen = {
            trunks: step.trunks,
            tilts: step.paths.map((path) => path.cabin?.tilt ?? Math.PI / 2),
          };
        }
        const carver = this.#carvers.get(step.tree);
        if (visual && carver && visual.brokenAt === undefined) this.#breakAtNotch(visual, carver);
      }
      this.#startChase(event.steps[0]);
      if (this.#hazardHint) {
        // The cabin hint has done its job once the first tree goes down.
        this.#hazardHint = false;
        this.#lastPhase = '';
        this.#deps.game.markDone(HAZARD_HINT);
      }
      this.#play(`creak-${1 + Math.floor(Math.random() * 3)}`, 0.7);
    } else if (event.type === 'hit') {
      // The falling canopy knocks into the next trunk: a light knock and tick before the thud.
      this.#play(`chop-${2 + Math.floor(Math.random() * 2)}`, 0.35, 250);
      if (!this.#crashed) this.#deps.haptics.pulse(feel.buzzHitMs);
    } else if (event.type === 'landed') {
      const visual = this.#trees.get(event.step.tree);
      if (visual) {
        event.step.paths.forEach((path) => {
          if (!path.cabin) {
            this.#burst('dust', this.#world(fallTip(visual.tree, path.angle), 0.2), 10);
          }
        });
      }
      // A tree landing on the cabin, and the rest of the chain after it, count for nothing: a
      // quiet thud, no combo.
      if (this.#crashed || event.step.paths.some((path) => path.cabin)) {
        this.#play(`land-${1 + Math.floor(Math.random() * 3)}`, 0.4);
        return;
      }
      // Now and then the thud startles birds out of the forest.
      if (visual && this.#fxRng.chance(this.#deps.game.data.woodcutting.scenery.birds.chance)) {
        this.#startleBirds(this.#world(fallTip(visual.tree, event.step.angle)), 1);
      }
      // Every tree a chain adds lands heavier: a deeper thud and more shake.
      const combo = event.count;
      this.#play(
        `land-${1 + Math.floor(Math.random() * 3)}`,
        Math.min(0.85 + combo * 0.05, 1),
        -Math.min((combo - 1) * 90, 450),
      );
      this.#shake = Math.min(0.05 + combo * 0.025, 0.22) * feel.shakeStrength;
      this.#deps.haptics.pulse(
        Math.min(feel.buzzLandMs + (combo - 1) * feel.buzzLandPerTreeMs, feel.buzzLandMaxMs),
      );
      if (combo > 1) this.#showCounter(combo);
    } else if (event.type === 'roll') {
      // Knocked rolling: a heavy stone knock, a puff of dust, and a buzz.
      const roller = this.#round.rollers.find((entry) => entry.roll === event.roll);
      if (roller) this.#rolling.push(roller);
      // A mossy boulder's moss falls off as it's first hit (it's banked with the chain).
      const moss = this.#forageLooks.get(`boulder:${event.roll.boulder}`);
      if (moss) {
        moss.removeFromParent();
        this.#forageLooks.delete(`boulder:${event.roll.boulder}`);
        this.#burst('moss', this.#world(event.roll.from, 0.5), 14);
      }
      this.#burst('dust', this.#world(event.roll.from, 0.2), 10);
      this.#play(`rock-${1 + Math.floor(Math.random() * 2)}`, 0.85, -150);
      this.#deps.haptics.pulse(feel.buzzLandMs);
    } else if (event.type === 'bounce') {
      // Off the fence: a wooden knock.
      this.#burst('chip', this.#world(event.at, 0.3), 6);
      this.#play(`chop-${2 + Math.floor(Math.random() * 2)}`, 0.6, -300);
      this.#deps.haptics.pulse(feel.buzzHitMs);
    } else if (event.type === 'crash') {
      if (event.boulder) this.#settleBoulder(event.boulder);
      this.#crash(event.step, event.boulder);
    } else if (event.type === 'lost') {
      this.#flash(
        `Cabin hit! −${String(event.logs)} log${event.logs === 1 ? '' : 's'}`,
        'danger',
        30,
      );
      this.#summaryNotBefore = this.#round.now + feel.crashSettleSeconds;
      this.#showLiveStars();
      this.#deps.clearings.finished();
      this.#summaryPending = 'crashed';
    } else if (event.type === 'banked') {
      // The logs are in the warchest; the chest shows them arriving once the camera is back on
      // the whole clearing, pouring out of each stump as the felled trunks are hauled off.
      const trees = [...this.#trees.values()]
        .filter((visual) => visual.fallen && visual.fallen.sinkAt === undefined)
        .map((visual) => visual.tree.id);
      this.#pendingPour = {
        deposit: this.#hud.hold(event.logs, this.#landChain(event.logs)),
        trees,
        drops: event.forage.drops.map((stack) =>
          this.#hud.hold(stack.count, undefined, stack.item),
        ),
        forage: event.forage,
      };
      this.#bestChain = Math.max(this.#bestChain, event.trees);
    } else {
      this.#deps.clearings.finished();
      this.#summaryPending = 'cleared';
    }
  }

  /** The XP the last bank earned, ticked in as its logs land in the chest. */
  #takeBankedXp(): (share: number) => void {
    const xp = this.#bankedXp;
    this.#bankedXp = undefined;
    return (share) => xp?.arrive(share);
  }

  /**
   * A banked chain's logs landing in the chest: the XP ticks in, and so do the live stars (star
   * bonus logs don't count toward stars, so they don't come through here).
   */
  #landChain(logs: number): (share: number) => void {
    const xp = this.#takeBankedXp();
    return (share) => {
      xp(share);
      this.#starLogs = Math.min(this.#starLogs + logs * share, this.#round.logs);
      this.#showLiveStars();
    };
  }

  /**
   * The live stars: lit for each star the logs landed so far have earned, and a bar filling toward
   * the next. A star popping in rings and buzzes like the summary's. After a cabin hit they drop to
   * the cap.
   */
  #showLiveStars(): void {
    const round = this.#round;
    const { liveStars, liveStarIcons, liveStarFill, liveStarText } = this.#ui;
    const par = round.par;
    liveStars.hidden = par === undefined;
    if (par === undefined) return;
    const { stars } = this.#deps.game.data.woodcutting;
    const logs = this.#starLogs;
    const steps = [Number.MIN_VALUE, stars.two * par, stars.three * par];
    let earned = steps.filter((needed) => logs >= needed).length;
    if (round.crashed) earned = Math.min(earned, stars.cabinCap);
    liveStars.classList.toggle('w3d-live-crashed', round.crashed);
    liveStarIcons.forEach((icon, index) => {
      const on = index < earned;
      if (on && !icon.classList.contains('w3d-live-star-on')) {
        icon.classList.add('w3d-live-star-on', 'w3d-live-star-pop');
        window.setTimeout(() => {
          icon.classList.remove('w3d-live-star-pop');
        }, 600);
        if (this.#starsShown <= index) {
          this.#sfx.play('star', 0.5, index * 300);
          this.#deps.haptics.pulse(round.feel.buzzChopMs + index * 6);
        }
      }
      if (!on) icon.classList.remove('w3d-live-star-on');
    });
    this.#starsShown = Math.max(this.#starsShown, earned);
    const from = earned === 0 ? 0 : (steps[earned - 1] ?? 0);
    const to = steps[earned];
    const share =
      to === undefined || round.crashed ? 1 : Math.min(Math.max((logs - from) / (to - from), 0), 1);
    liveStarFill.style.width = `${String(Math.round(share * 1000) / 10)}%`;
    // Logs so far, and what the next star needs (whole logs).
    const shown = Math.round(logs);
    liveStarText.textContent =
      to === undefined || round.crashed
        ? `${String(shown)} logs`
        : `${String(shown)} / ${String(Math.max(Math.ceil(to), 1))} logs`;
  }

  /** The feel numbers (with live tuning), at fast-fall speeds when that switch is on. */
  #feel(): WoodcuttingFeel {
    const { game, feel, fastFall } = this.#deps;
    const values = feel.values;
    if (
      fastFall.value !== 'on' ||
      !fastFallUnlocked(game.data.woodcutting, game.level(this.#skill))
    )
      return values;
    return { ...values, ...game.data.woodcutting.fastFall };
  }

  /** A woodcutting level-up: a callout with what it unlocks, a two-note ding and a buzz. */
  #levelUp(from: number, to: number): void {
    const { levelUp, levelUpTitle, levelUpText } = this.#ui;
    const skillName =
      this.#deps.game.data.skills.find((skill) => skill.id === this.#skill)?.name ?? this.#skill;
    levelUpTitle.textContent = `${skillName} level ${String(to)}!`;
    levelUpText.textContent = unlocksBetween(this.#deps.game.data.woodcutting, from, to)
      .map((unlock) => unlock.text)
      .join(' · ');
    levelUp.classList.remove('w3d-levelup-show');
    levelUp.getBoundingClientRect();
    levelUp.classList.add('w3d-levelup-show');
    this.#sfx.play('star', 0.7, 500);
    this.#summaryTimers.push(
      window.setTimeout(() => {
        this.#sfx.play('star', 0.7, 900);
      }, 160),
    );
    this.#deps.haptics.pulse(30);
  }

  /** The summary's XP: gained this round, and the level bar filling up to where it is now. */
  #showXp(): void {
    const { game } = this.#deps;
    const { summaryXpLabel, summaryXpFill } = this.#ui;
    const xp = game.xp(this.#skill);
    const level = game.level(this.#skill);
    const curve = game.xpCurve;
    const gained = xp - this.#xpAtStart;
    const levelsGained = level - curve.levelForXp(this.#xpAtStart);
    const skillName = game.data.skills.find((skill) => skill.id === this.#skill)?.name ?? '';
    summaryXpLabel.textContent = `${skillName} level ${String(level)}${
      levelsGained > 0 ? ` (+${String(levelsGained)})` : ''
    } · +${gained.toLocaleString()} XP`;
    summaryXpLabel.classList.toggle('w3d-xp-up', levelsGained > 0);
    this.#ui.summaryUnlocks.textContent = unlocksBetween(
      game.data.woodcutting,
      level - levelsGained,
      level,
    )
      .map((unlock) => `Unlocked: ${unlock.text}`)
      .join('\n');
    const floor = curve.xpForLevel(level);
    const share =
      level >= curve.maxLevel ? 1 : (xp - floor) / (curve.xpForLevel(level + 1) - floor);
    summaryXpFill.style.width = `${String(Math.round(share * 1000) / 10)}%`;
  }

  /** During a round the top-left button ends it, showing the summary first. */
  #showEndRound(): void {
    this.#deps.backButton.set({
      label: 'End round',
      onTap: () => {
        this.#endRound();
      },
    });
  }

  /** End round: once anything still falling has landed and poured in, show the summary. */
  #endRound(): void {
    if (this.#summaryPending || !this.#ui.summary.hidden) return;
    this.#deps.logger.log('woodcutting3d.endRound', {
      phase: this.#round.phase.kind,
      logs: this.#round.logs,
      standing: this.#round.standing.size,
    });
    this.#deps.backButton.set('hidden');
    this.#summaryPending = 'paused';
  }

  /** Keep chopping: back to the round from the summary. */
  #resume(): void {
    this.#clearSummaryTimers();
    this.#ui.summary.hidden = true;
    this.#deps.logger.log('woodcutting3d.resume', { logs: this.#round.logs });
    this.#showEndRound();
  }

  #clearSummaryTimers(): void {
    for (const timer of this.#summaryTimers) window.clearTimeout(timer);
    this.#summaryTimers = [];
  }

  /** The round's result: logs against par, then the stars pop in one by one. */
  #showSummary(kind: SummaryKind): void {
    const ui = this.#ui;
    const round = this.#round;
    const plan = this.#plan;
    const earned = round.stars;
    // Ended early with trees still standing: the round so far, and the choice to keep going.
    const paused = kind === 'paused' && round.standing.size > 0;
    ui.summaryTitle.textContent = paused
      ? 'Round so far'
      : kind === 'crashed'
        ? 'Cabin hit!'
        : 'Clearing cleared!';
    ui.summary.dataset.kind = kind;
    ui.keepChopping.hidden = !paused;
    this.#deps.backButton.set('hidden');
    this.#clearSummaryTimers();
    const par = `par ${String(round.par ?? '?')}`;
    const lost = round.lostLogs > 0 ? ` · lost ${String(round.lostLogs)} to the cabin` : '';
    const items = this.#deps.game.data.items;
    const foraged = round.drops
      .map((stack) => {
        const name = items.find((item) => item.id === stack.item)?.name ?? stack.item;
        return `${String(stack.count)} ${name.toLowerCase()}`;
      })
      .join(', ');
    ui.summaryText.textContent =
      (round.logs === 0
        ? `No logs yet · ${par}${lost}`
        : `${String(round.logs)} logs · ${par} · best chain ${String(this.#bestChain)}${lost}`) +
      (foraged ? `\nForaged: ${foraged}` : '');
    ui.summarySeed.textContent =
      plan?.seed === undefined ? 'Tutorial clearing' : `Clearing #${String(plan.seed)}`;
    ui.summary.dataset.stars = String(earned);
    // The level bar fills from empty each time the summary opens.
    ui.summaryXpFill.style.width = '0%';
    this.#summaryTimers.push(
      window.setTimeout(() => {
        this.#showXp();
      }, STAR_DELAY_MS),
    );
    const bonus = round.starBonus;
    // Cleared: the bonus is earned now. Ended early: it lands if they leave, not if they keep going.
    ui.summaryBonus.textContent =
      kind === 'crashed'
        ? round.stars > 0
          ? `Hitting the cabin makes it a ${String(round.stars)}-star round: no star bonus`
          : 'Hitting the cabin ends the round: no star bonus'
        : bonus <= 0
          ? ''
          : paused
            ? `End the round for a star bonus: +${String(bonus)} logs`
            : '';
    ui.summaryBonus.className = 'w3d-summary-bonus';
    ui.summary.hidden = false;
    const feel = round.feel;
    if (!paused && bonus > 0) {
      this.#summaryTimers.push(
        window.setTimeout(
          () => {
            this.#pourStarBonus();
          },
          STAR_DELAY_MS + 3 * STAR_STAGGER_MS + 150,
        ),
      );
    }
    ui.stars.forEach((star, index) => {
      star.className = 'w3d-star';
      this.#summaryTimers.push(
        window.setTimeout(
          () => {
            const on = index < earned;
            star.classList.add(on ? 'w3d-star-on' : 'w3d-star-off');
            if (!on) return;
            // Each star rings a little higher and buzzes a little longer.
            this.#sfx.play('star', 0.6, index * 300);
            this.#deps.haptics.pulse(feel.buzzChopMs + index * 6);
          },
          STAR_DELAY_MS + index * STAR_STAGGER_MS,
        ),
      );
    });
  }

  /**
   * Banks the star bonus and pours it into the chest from the earned stars, with a callout.
   * Returns whether anything poured.
   */
  #pourStarBonus(): boolean {
    const logs = this.#round.claimStarBonus();
    if (logs <= 0) return false;
    const ui = this.#ui;
    ui.summaryBonus.textContent = `Star bonus +${String(logs)} logs!`;
    this.#showXp();
    ui.summaryBonus.className = 'w3d-summary-bonus w3d-summary-bonus-won';
    const box = this.#element.getBoundingClientRect();
    const points = ui.stars
      .filter((star) => star.classList.contains('w3d-star-on'))
      .map((star) => {
        const rect = star.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2 - box.left,
          y: rect.top + rect.height / 2 - box.top,
        };
      });
    this.#hud.hold(logs, this.#takeBankedXp()).pour(points);
    this.#sfx.play('star', 0.5, 700);
    return true;
  }

  /**
   * Leaving from the summary (Back to camp or Next clearing). Ended early, the star bonus pours
   * in first, so the player sees it land before the screen changes.
   */
  #leaveSummary(then: () => void): void {
    const ui = this.#ui;
    if (ui.summaryButtons.dataset.busy === 'true') return;
    if (!this.#pourStarBonus()) {
      then();
      return;
    }
    ui.summaryButtons.dataset.busy = 'true';
    ui.keepChopping.hidden = true;
    const waitForPour = () => {
      if (!this.#hud.settled) {
        this.#summaryTimers.push(window.setTimeout(waitForPour, 100));
        return;
      }
      this.#summaryTimers.push(
        window.setTimeout(() => {
          delete ui.summaryButtons.dataset.busy;
          then();
        }, BONUS_LINGER_MS),
      );
    };
    waitForPour();
  }

  /**
   * The cabin is hit, by a falling tree (`step`) or a rolling boulder: a freeze, the camera
   * punching in, a crash and a rumble, a buzz that dies away, then the cabin coming apart in slow
   * motion (real physics), its window shattering, dust billowing out, birds bursting from the
   * forest, and the tree sinking into the wreck. Only looks: the rules have already called it.
   */
  #crash(step: FallStep | undefined, boulder: string | undefined): void {
    const shape = this.#clearing.cabin;
    const cabin = this.#cabin;
    if (!shape || !cabin) return;
    const feel = this.#round.feel;
    const middle = this.#world(shape, shape.height * SCALE * 0.5);
    // Where it was hit, and which way it was pushed.
    const direction = new THREE.Vector3();
    const hit = middle.clone();
    const path = step?.paths.findIndex((entry) => entry.cabin) ?? -1;
    const tree = step ? this.#trees.get(step.tree) : undefined;
    const trunkPath = step?.paths[path];
    if (step && tree && trunkPath?.cabin) {
      direction.set(Math.cos(trunkPath.angle), 0, Math.sin(trunkPath.angle));
      hit
        .copy(this.#world(tree.tree))
        .addScaledVector(direction, trunkPath.cabin.at * SCALE)
        .setY(shape.height * SCALE * 0.8);
      tree.sag = {
        at: this.#round.now,
        tilts: step.paths.map((entry) =>
          entry.cabin
            ? cabinSagTilt(this.#clearing, tree.tree, entry.cabin, feel.crashRubble)
            : undefined,
        ),
      };
      cabin.tree = step.tree;
      cabin.trunk = path;
    } else if (boulder) {
      const holder = this.#boulders.get(boulder)?.holder;
      if (holder) direction.subVectors(middle, holder.position).setY(0);
      if (holder) hit.copy(holder.position).setY(shape.height * SCALE * 0.3);
    }
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
    direction.normalize();
    cabin.model.group.visible = true;
    cabin.wreck = new Wreck(
      this.#hazards,
      cabin.model.parts,
      hit,
      direction,
      middle.clone().setY(0),
      feel,
      this.#fxRng,
      (at, speed, kind) => {
        this.#knock(at, speed, kind);
      },
    );
    // The window shatters.
    cabin.model.pane.visible = false;
    const pane = cabin.model.pane.getWorldPosition(new THREE.Vector3());
    this.#burst('glass', pane, 18, direction);
    this.#burst('chip', hit, 26, direction);
    this.#burst('cloud', middle.clone().setY(0.3), 16);
    this.#play('crash-wood', 1, -200);
    this.#play('crash-glass', 0.7);
    this.#play('crash-rumble', 1);
    this.#shake = feel.crashShake * feel.shakeStrength;
    const now = performance.now();
    this.#frozenUntil = now + feel.crashHitStopMs;
    this.#slowUntil = this.#frozenUntil + feel.crashSlowMoSeconds * 1000;
    this.#punch = { at: hit, start: now };
    // Whatever else is still falling no longer counts: leave it and watch the cabin.
    this.#chase = undefined;
    this.#moveCamera(this.#crashPose(shape));
    this.#deps.haptics.rumble(feel.buzzCrashMs, feel.buzzCrashPulses);
    this.#startleBirds(middle, 2);
  }

  /** A wreck part knocking into something: a thud (and a puff of dust) for the hard ones. */
  #knock(at: THREE.Vector3, speed: number, kind: 'log' | 'roof' | 'stone' | 'door'): void {
    const now = performance.now();
    if (speed < KNOCK_SPEED || now - this.#knockAt < KNOCK_GAP_MS) return;
    this.#knockAt = now;
    const loud = Math.min(speed / 6, 1);
    if (kind === 'stone') {
      this.#play(`rock-${1 + Math.floor(Math.random() * 2)}`, 0.3 + loud * 0.5, 100);
    } else {
      this.#play(
        `land-${1 + Math.floor(Math.random() * 3)}`,
        0.25 + loud * 0.5,
        kind === 'log' ? 0 : 300,
      );
    }
    if (at.y < 0.4) this.#burst('dust', at.clone().setY(0.1), 3);
  }

  /** A flock or two of birds burst from the treetops nearest `near`, flying away from it. */
  #startleBirds(near: THREE.Vector3, flocks: number): void {
    const { birds } = this.#deps.game.data.woodcutting.scenery;
    const tops = [...this.#scenery.treetops]
      .sort((a, b) => a.distanceToSquared(near) - b.distanceToSquared(near))
      .slice(0, flocks);
    for (const top of tops) {
      const count = Math.round(this.#fxRng.range(birds.flock.min, birds.flock.max));
      this.#birds.burst(this.#fxRng, top, near, count, birds.speed * SCALE);
    }
  }

  #play(name: string, volume: number, pitchCents = 0): void {
    this.#sfx.play(name, volume, pitchCents + (Math.random() - 0.5) * 240);
  }

  #burst(kind: ParticleKind, at: THREE.Vector3, count: number, toward?: THREE.Vector3): void {
    const look = PARTICLES[kind];
    for (let i = 0; i < count; i++) {
      const object =
        kind === 'chip' || kind === 'glass' || kind === 'moss'
          ? new THREE.Mesh(
              kind === 'chip'
                ? new THREE.BoxGeometry(0.05, 0.02, 0.035)
                : kind === 'moss'
                  ? new THREE.BoxGeometry(0.06, 0.03, 0.06)
                  : new THREE.BoxGeometry(0.06, 0.005, 0.045),
              new THREE.MeshLambertMaterial({ color: look.color }),
            )
          : new THREE.Mesh(
              new THREE.SphereGeometry(kind === 'cloud' ? 0.3 : 0.12, 6, 4),
              new THREE.MeshBasicMaterial({
                color: look.color,
                transparent: true,
                opacity: look.opacity,
                depthWrite: false,
              }),
            );
      object.position.copy(at);
      // A cloud rolls out along the ground; everything else flies up and out.
      const spread =
        kind === 'cloud'
          ? new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.25, Math.random() - 0.5)
          : new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5);
      if (toward) spread.addScaledVector(toward, 0.8);
      this.#scene.add(object);
      this.#particles.push({
        object,
        velocity: spread.normalize().multiplyScalar(look.speed + Math.random() * look.speedRange),
        life: look.life * (0.8 + Math.random() * 0.4),
        age: 0,
        kind,
      });
    }
  }

  #updateParticles(dt: number): void {
    this.#particles = this.#particles.filter((particle) => {
      particle.age += dt;
      if (particle.age >= particle.life) {
        this.#scene.remove(particle.object);
        return false;
      }
      const look = PARTICLES[particle.kind];
      particle.velocity.y -= look.gravity * dt;
      particle.velocity.multiplyScalar(Math.exp(-look.drag * dt));
      particle.object.position.addScaledVector(particle.velocity, dt);
      if (particle.object.position.y < 0.01 && look.gravity > 0) {
        // Chips and glass come to rest on the ground.
        particle.object.position.y = 0.01;
        particle.velocity.set(0, 0, 0);
      } else {
        particle.object.rotation.x += dt * 9;
      }
      if (look.opacity < 1) {
        const share = particle.age / particle.life;
        particle.object.scale.setScalar(1 + particle.age * look.grow);
        particle.object.material.opacity = look.opacity * (1 - share * share);
      }
      return true;
    });
  }

  // Frame

  #loop(time: number): void {
    this.#timer.update(time);
    const realDt = Math.min(this.#timer.getDelta(), 0.05);
    this.#frameTimes.push(realDt * 1000);
    this.#checkFallback(realDt * 1000);
    const now = performance.now();
    // Frozen for a hit-stop; slowed for a crash.
    const dt =
      now < this.#frozenUntil
        ? 0
        : now < this.#slowUntil
          ? realDt * this.#round.feel.crashSlowMo
          : realDt;
    windTime.value += realDt * this.#deps.game.data.woodcutting.scenery.windSpeed;
    this.#round.tick(dt);
    // Chop is a button, so the phase can change between frames: compare with last frame's.
    const kind = this.#round.phase.kind;
    if (kind !== this.#cameraPhase) {
      if (kind === 'chop') this.#enterCloseUp();
      this.#cameraPhase = kind;
    }
    this.#updateTrees();
    this.#updateBoulders();
    this.#updateCabin(dt);
    this.#updateGuides();
    this.#updateAxe();
    this.#updateParticles(dt);
    this.#birds.update(dt);
    this.#updateCamera(realDt);
    this.#startPendingPour();
    const levelUp = this.#levelUpPending;
    if (levelUp && !this.#pendingPour && this.#hud.settled) {
      this.#levelUpPending = undefined;
      // The summary lists what was unlocked, so the callout is only for mid-round level-ups.
      if (!this.#summaryPending && this.#ui.summary.hidden) this.#levelUp(levelUp.from, levelUp.to);
    }
    const pending = this.#summaryPending;
    if (
      pending &&
      !this.#pendingPour &&
      this.#hud.settled &&
      this.#round.phase.kind !== 'falling' &&
      // A crash has nothing to pour: wait for the camera to come back and the callout to read.
      !this.#chase &&
      !this.#cameraTo &&
      this.#round.now >= this.#summaryNotBefore
    ) {
      this.#summaryPending = undefined;
      this.#showSummary(pending);
    }
    this.#updateUi();
    this.#renderer.render(this.#scene, this.#camera);
  }

  /** Once the camera has settled back on the overview, haul off the chain and pour its logs. */
  #startPendingPour(): void {
    const pending = this.#pendingPour;
    if (!pending || this.#chase || this.#cameraTo) return;
    this.#pendingPour = undefined;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const points: ScreenPoint[] = [];
    for (const id of pending.trees) {
      const visual = this.#trees.get(id);
      if (!visual) continue;
      if (visual.fallen) visual.fallen.sinkAt = this.#round.now;
      const projected = this.#world(visual.tree, 0.25).project(this.#camera);
      points.push({ x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height });
      this.#burst('chip', this.#world(visual.tree, 0.25), 8);
    }
    pending.deposit.pour(points);
    // Foraged things pour from where they were: the stumps, the patches, the boulders.
    const { forage } = pending;
    if (pending.drops.length === 0) return;
    const onScreen = (at: THREE.Vector3): ScreenPoint => {
      const projected = at.project(this.#camera);
      return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
    };
    const from: ScreenPoint[] = [];
    for (const id of forage.trees) {
      const visual = this.#trees.get(id);
      if (visual) from.push(onScreen(this.#world(visual.tree, 0.25)));
      this.#forageLooks.get(`tree:${id}`)?.removeFromParent();
      this.#forageLooks.get(`tree:${id}:moss`)?.removeFromParent();
    }
    for (const id of forage.patches) {
      const patch = this.#round.forage.patches.find((entry) => entry.id === id);
      if (patch) {
        from.push(onScreen(this.#world(patch, 0.1)));
        this.#burst('dust', this.#world(patch, 0.1), 8);
      }
      this.#forageLooks.get(`patch:${id}`)?.removeFromParent();
    }
    for (const id of forage.boulders) {
      const boulder = this.#round.clearing.boulders.find((entry) => entry.id === id);
      if (boulder) from.push(onScreen(this.#world(boulder, 0.4)));
    }
    for (const drop of pending.drops) drop.pour(from);
  }

  #enterCloseUp(): void {
    const phase = this.#round.phase;
    if (phase.kind !== 'chop') return;
    const pose = this.#closeUpPose(phase.tree, phase.angle);
    if (pose) this.#moveCamera(pose);
  }

  /**
   * In the chop close-up, trees standing between the camera and the chosen trunk would fill
   * the screen, so they're hidden until the camera goes back to the overview.
   */
  #blocksCloseUp(visual: TreeVisual): boolean {
    const phase = this.#round.phase;
    if (phase.kind === 'chop') {
      if (visual.tree.id === phase.tree) return false;
      const pose = this.#closeUpPose(phase.tree, phase.angle);
      return pose ? blocks(visual, pose, 1, 1.3) : false;
    }
    // Chasing a chain: standing trees close in front of the camera would hide the falls.
    const pose = this.#chase && this.#shownPose;
    if (!pose || visual.fallen || this.#round.fallers.some((f) => f.step.tree === visual.tree.id))
      return false;
    return blocks(visual, pose, 0.55, 1);
  }

  /**
   * Rolling boulders: each one moves along its roll (bounces and all) and tumbles as it goes,
   * slowing to a stop. Their outlines follow them.
   */
  #updateBoulders(): void {
    const round = this.#round;
    const speed = round.feel.boulderSpeed;
    for (const roller of [...this.#rolling]) {
      const visual = this.#boulders.get(roller.roll.boulder);
      if (!visual) continue;
      const { roll } = roller;
      const rolled = rollDistance(
        Math.max(round.now - roller.start, 0),
        roll.natural,
        speed,
        roll.distance,
      );
      // Walk the legs: where it is now, and the tumble so far (a turn of rolled ÷ radius about
      // the axis square to each leg).
      const radius =
        (round.clearing.boulders.find((b) => b.id === roll.boulder)?.radius ?? 1) * SCALE;
      const spin = new THREE.Quaternion();
      let left = rolled;
      let at = roll.path[0] ?? roll.from;
      for (let index = 1; index < roll.path.length; index++) {
        const to = roll.path[index] ?? at;
        const length = Math.hypot(to.x - at.x, to.y - at.y);
        const step = Math.min(left, length);
        const direction = new THREE.Vector3(to.x - at.x, 0, to.y - at.y).normalize();
        const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction);
        if (axis.lengthSq() > 0) {
          spin.premultiply(
            new THREE.Quaternion().setFromAxisAngle(axis.normalize(), (step * SCALE) / radius),
          );
        }
        const share = length > 0 ? step / length : 0;
        const point = { x: at.x + (to.x - at.x) * share, y: at.y + (to.y - at.y) * share };
        left -= step;
        at = point;
        if (left <= 0) break;
      }
      visual.holder.position.copy(this.#world(at));
      visual.ring.position.copy(this.#world(at, 0.03));
      visual.spinner.quaternion.copy(spin.multiply(visual.turned));
      if (round.now >= roller.end) this.#settleBoulder(roll.boulder);
    }
  }

  /** A boulder has stopped: keep its tumble, and stop moving it. */
  #settleBoulder(id: string): void {
    const visual = this.#boulders.get(id);
    const index = this.#rolling.findIndex((roller) => roller.roll.boulder === id);
    if (index < 0) return;
    const roller = this.#rolling[index];
    this.#rolling.splice(index, 1);
    if (!visual || !roller) return;
    visual.turned.copy(visual.spinner.quaternion);
    const to = this.#world(roller.roll.to);
    visual.holder.position.copy(to);
    visual.ring.position.set(to.x, 0.03, to.z);
  }

  /**
   * The cabin is hidden if it blocks the chop close-up. Once hit, its wreck runs, the sinking
   * trunk pushing the rubble down.
   */
  #updateCabin(dt: number): void {
    const cabin = this.#cabin;
    const shape = this.#clearing.cabin;
    if (!cabin || !shape) return;
    if (cabin.wreck) {
      const visual = cabin.tree === undefined ? undefined : this.#trees.get(cabin.tree);
      const trunk = cabin.trunk === undefined ? undefined : visual?.trunks[cabin.trunk];
      if (visual && trunk) {
        // The trunk's box: from its pivot up its length, as the tree now leans.
        const length = (visual.tree.height + this.#clearing.canopyRadius) * SCALE;
        trunk.updateWorldMatrix(true, false);
        const pivot = new THREE.Vector3().setFromMatrixPosition(trunk.matrixWorld);
        const turn = trunk.getWorldQuaternion(new THREE.Quaternion());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
        cabin.wreck.setPusher(
          pivot.addScaledVector(up, length / 2),
          turn,
          new THREE.Vector3(PUSHER_THICKNESS / 2, length / 2, PUSHER_THICKNESS / 2),
          dt,
        );
      }
      cabin.wreck.step(dt);
      return;
    }
    const phase = this.#round.phase;
    const pose = phase.kind === 'chop' ? this.#closeUpPose(phase.tree, phase.angle) : undefined;
    const reach = (Math.max(shape.width, shape.depth) / 2) * SCALE + 0.6;
    cabin.model.group.visible = !pose || !blocksAt(cabin.model.group.position, pose, 1, reach);
  }

  /**
   * How far trunk `index` of `visual` tips at most: flat, or resting on the cabin, sinking into it
   * once it has caved in.
   */
  #restingTilt(visual: TreeVisual, index: number, resting: number | undefined): number {
    const sag = visual.sag;
    const sunk = sag?.tilts[index];
    if (resting === undefined) return Math.PI / 2;
    if (!sag || sunk === undefined) return resting;
    const t = Math.min(
      Math.max((this.#round.now - sag.at) / this.#round.feel.crashSagSeconds, 0),
      1,
    );
    // Gives way fast, then settles onto the rubble.
    return resting + (sunk - resting) * (1 - (1 - t) ** 3);
  }

  #updateTrees(): void {
    const round = this.#round;
    for (const visual of this.#trees.values()) visual.root.visible = !this.#blocksCloseUp(visual);
    const feel = round.feel;
    const falling = new Map(round.fallers.map((faller) => [faller.step.tree, faller]));
    for (const visual of this.#trees.values()) {
      const faller = falling.get(visual.tree.id);
      if (faller) {
        const started = round.now >= faller.start;
        visual.stump.visible = started && visual.brokenAt === undefined;
        const tilt = started
          ? fallTilt((round.now - faller.start) / feel.fallSeconds, feel.fallEase)
          : 0;
        visual.trunks.forEach((trunk, index) => {
          const path = faller.step.paths[index];
          const trunkTilt = Math.min(tilt, this.#restingTilt(visual, index, path?.cabin?.tilt));
          this.#tip(trunk, path?.angle ?? faller.step.angle, trunkTilt);
          // A tree broken at its notch tips over the stump, then its butt drops to the ground.
          if (visual.brokenAt !== undefined)
            trunk.position.y = visual.brokenAt * (1 - Math.sin(trunkTilt));
        });
      } else if (visual.fallen) {
        visual.stump.visible = visual.brokenAt === undefined;
        const sinking =
          visual.fallen.sinkAt === undefined
            ? 0
            : Math.max(0, (round.now - visual.fallen.sinkAt) / HAUL_SECONDS);
        visual.trunks.forEach((trunk, index) => {
          const resting = visual.fallen?.tilts[index];
          this.#tip(
            trunk,
            visual.fallen?.trunks[index] ?? 0,
            resting === undefined || resting >= Math.PI / 2
              ? Math.PI / 2
              : this.#restingTilt(visual, index, resting),
          );
          trunk.position.y = -sinking * 0.6;
          trunk.scale.setScalar(Math.max(1 - sinking, 0.001));
          trunk.visible = sinking < 1;
        });
      }
    }
  }

  // Overlay

  buildUi() {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };
    const root = el('div', 'w3d-ui');
    const perf = el('div', 'w3d-perf');
    const hint = el('div', 'w3d-hint');
    const panel = el('div', 'w3d-panel');
    const aim = el('div', 'w3d-aim');
    const button = (label: string, action: () => void, wide = false) => {
      const element = el('button', `w3d-button${wide ? ' w3d-wide' : ''}`, label);
      element.type = 'button';
      element.addEventListener('click', () => {
        this.#sfx.unlock();
        action();
      });
      return element;
    };
    const left = button('↺', () => {
      this.#round.nudge(-1);
    });
    left.setAttribute('aria-label', 'Turn aim counter-clockwise');
    const chop = button(
      'Chop',
      () => {
        this.#round.chop();
      },
      true,
    );
    const right = button('↻', () => {
      this.#round.nudge(1);
    });
    right.setAttribute('aria-label', 'Turn aim clockwise');
    aim.append(left, chop, right);
    const chopPanel = el('div', 'w3d-chop');
    const bar = el('div', 'w3d-bar');
    const green = el('div', 'w3d-green');
    const yellow = el('div', 'w3d-yellow');
    const marker = el('div', 'w3d-marker');
    bar.append(green, yellow, marker);
    const pips = el('div', 'w3d-pips');
    const power = el('div', 'w3d-power');
    chopPanel.append(bar, pips, power);
    panel.append(aim, chopPanel);
    const fast = button('', () => {
      const { fastFall } = this.#deps;
      fastFall.set(fastFall.value === 'on' ? 'off' : 'on');
      this.#deps.logger.log('woodcutting3d.fastFall', { value: fastFall.value });
    });
    fast.classList.add('w3d-fast');
    const levelUp = el('div', 'w3d-levelup');
    const levelUpTitle = el('div', 'w3d-levelup-title');
    const levelUpText = el('div', 'w3d-levelup-text');
    levelUp.append(levelUpTitle, levelUpText);
    const flashes = el('div', 'w3d-flashes');
    const counter = el('div', 'w3d-counter');
    const summary = el('div', 'w3d-summary');
    const summaryTitle = el('div', 'w3d-summary-title', 'Clearing cleared!');
    const starRow = el('div', 'w3d-stars');
    const stars = [0, 1, 2].map(() => el('span', 'w3d-star', '★'));
    starRow.append(...stars);
    const summaryText = el('div', 'w3d-summary-text');
    const summarySeed = el('div', 'w3d-summary-seed');
    const leave = button('Back to camp', () => {
      this.#leaveSummary(() => {
        this.#deps.onLeave();
      });
    });
    leave.classList.add('w3d-secondary');
    const next = button('Next clearing', () => {
      this.#leaveSummary(() => {
        this.stop();
        this.start();
      });
    });
    const summaryBonus = el('div', 'w3d-summary-bonus');
    const summaryXp = el('div', 'w3d-xp');
    const summaryXpLabel = el('div', 'w3d-xp-label');
    const summaryXpBar = el('div', 'w3d-xp-bar');
    const summaryXpFill = el('div', 'w3d-xp-fill');
    summaryXpBar.append(summaryXpFill);
    const summaryUnlocks = el('div', 'w3d-xp-unlocks');
    summaryXp.append(summaryXpLabel, summaryXpBar, summaryUnlocks);
    const keepChopping = button(
      'Keep chopping',
      () => {
        this.#resume();
      },
      true,
    );
    const summaryButtons = el('div', 'w3d-summary-buttons');
    summaryButtons.append(leave, next);
    summary.append(
      summaryTitle,
      starRow,
      summaryText,
      summaryBonus,
      summaryXp,
      summarySeed,
      keepChopping,
      summaryButtons,
    );
    summary.hidden = true;
    // The round's stars so far, under the level bar: three stars and a bar to the next one.
    const liveStars = el('div', 'w3d-live-stars');
    const liveStarRow = el('div', 'w3d-live-star-row');
    const liveStarIcons = [0, 1, 2].map(() => el('span', 'w3d-live-star', '★'));
    liveStarRow.append(...liveStarIcons);
    const liveStarBar = el('div', 'w3d-live-star-bar');
    const liveStarFill = el('div', 'w3d-live-star-fill');
    liveStarBar.append(liveStarFill);
    const liveStarText = el('div', 'w3d-live-star-text');
    liveStars.append(liveStarRow, liveStarBar, liveStarText);
    root.append(perf, hint, panel, fast, flashes, counter, levelUp, summary, liveStars);
    this.#element.append(root);
    return {
      liveStars,
      liveStarIcons,
      liveStarFill,
      liveStarText,
      perf,
      hint,
      aim,
      chop,
      chopPanel,
      green,
      yellow,
      marker,
      pips,
      power,
      flashes,
      counter,
      summary,
      summaryTitle,
      summaryText,
      summaryBonus,
      summaryXpLabel,
      summaryXpFill,
      summaryUnlocks,
      fast,
      levelUp,
      levelUpTitle,
      levelUpText,
      summarySeed,
      summaryButtons,
      keepChopping,
      stars,
    };
  }

  #updateUi(): void {
    const ui = this.#ui;
    const round = this.#round;
    const phase = round.phase;
    const feel = round.feel;
    if (phase.kind !== this.#lastPhase) {
      this.#lastPhase = phase.kind;
      // Lets the e2e test follow the round.
      document.body.dataset.woodcutting = phase.kind;
      const hints: Record<string, string> = {
        pick: 'Touch a tree and pull back to aim',
        aim: 'Pull back from the tree to aim · ↺ ↻ to fine-tune · then Chop',
        chop: 'Pull back and let go on yellow · harder pull = smaller yellow',
      };
      ui.hint.textContent =
        this.#hazardHint && phase.kind === 'pick'
          ? "Don't fell onto the cabin! Knock a boulder to roll it through trees"
          : (hints[phase.kind] ?? '');
      ui.hint.classList.toggle('w3d-hint-warn', this.#hazardHint && phase.kind === 'pick');
    }
    const waiting = !ui.summary.hidden || this.#summaryPending !== undefined;
    const { game, fastFall } = this.#deps;
    ui.fast.hidden = waiting || !fastFallUnlocked(game.data.woodcutting, game.level(this.#skill));
    ui.fast.textContent = `⏩ Fast fall: ${fastFall.value === 'on' ? 'on' : 'off'}`;
    ui.fast.setAttribute('aria-pressed', String(fastFall.value === 'on'));
    ui.aim.hidden = phase.kind !== 'aim' || waiting;
    ui.chop.disabled = !round.canChop;
    ui.chopPanel.hidden = phase.kind !== 'chop' || waiting;
    if (phase.kind === 'chop') {
      const percent = (value: number) => `${value * 100}%`;
      ui.green.style.left = percent(phase.target - feel.timingWindow / 2);
      ui.green.style.width = percent(feel.timingWindow);
      const yellow = round.yellowWidth;
      ui.yellow.style.left = percent(phase.target - yellow / 2);
      ui.yellow.style.width = percent(yellow);
      const marker = round.marker;
      ui.marker.hidden = marker === undefined;
      if (marker !== undefined) ui.marker.style.left = percent(marker);
      const pips = Array.from({ length: feel.chopPoints }, (_, i) =>
        i < phase.points ? '●' : '○',
      ).join(' ');
      if (ui.pips.textContent !== pips) ui.pips.textContent = pips;
      const pull = phase.hold?.pull ?? 0;
      const power = phase.hold ? Math.max(1, Math.round(pull * feel.fullPullPoints)) : 0;
      const filled = pull > 0 ? power : 0;
      const key = `${filled}/${feel.fullPullPoints}`;
      if (ui.power.dataset.key !== key) {
        ui.power.dataset.key = key;
        ui.power.replaceChildren(
          ...Array.from({ length: feel.fullPullPoints }, (_, i) => {
            const bar = document.createElement('span');
            bar.className = i < filled ? 'w3d-power-bar w3d-on' : 'w3d-power-bar';
            return bar;
          }),
        );
      }
    }
    if (++this.#frame % 30 === 0) {
      const recent = this.#frameTimes.slice(-60);
      const average = recent.reduce((sum, value) => sum + value, 0) / Math.max(recent.length, 1);
      ui.perf.textContent = `${average.toFixed(1)} ms/frame`;
      this.#publishTreePositions();
    }
  }

  /** Screen positions of standing trees, for the e2e test (only while the overview is still). */
  #publishTreePositions(): void {
    if (this.#cameraTo || this.#cameraPose !== this.#overview) return;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const positions: Record<string, [number, number]> = {};
    for (const id of this.#round.standing) {
      const tree = this.#trees.get(id)?.tree;
      if (!tree) continue;
      const projected = this.#world(tree).project(this.#camera);
      positions[id] = [
        Math.round(((projected.x + 1) / 2) * width),
        Math.round(((1 - projected.y) / 2) * height),
      ];
    }
    this.#element.dataset.trees = JSON.stringify(positions);
  }

  #flash(message: string, tone: 'perfect' | 'good' | 'glancing' | 'danger', size = 22): void {
    const flash = document.createElement('div');
    flash.style.fontSize = `${size}px`;
    flash.className = `w3d-flash w3d-${tone}`;
    flash.textContent = message;
    this.#ui.flashes.append(flash);
    setTimeout(() => {
      flash.remove();
    }, 900);
  }

  /**
   * The chain counter: it grows, warms from white to gold to orange, shows the logs the chain
   * is worth so far (they go up by the square), and shouts a callout from data as it gets long.
   */
  #showCounter(trees: number): void {
    const { counter } = this.#ui;
    const { chainExponent, comboCallouts } = this.#deps.game.data.woodcutting;
    const callout = comboCallouts.filter((entry) => trees >= entry.trees).at(-1);
    const logs = chainLogs(trees, chainExponent);
    counter.replaceChildren(
      ...[
        ['w3d-count', `${trees} trees!`],
        ['w3d-callout', callout?.text ?? ''],
        ['w3d-worth', `${logs} logs`],
      ].map(([className, text]) => {
        const line = document.createElement('div');
        line.className = className ?? '';
        line.textContent = text ?? '';
        return line;
      }),
    );
    const level = Math.min(trees - 2, 5);
    counter.style.setProperty('--combo-size', `${42 + level * 9}px`);
    counter.style.setProperty('--combo-color', COMBO_COLORS[level] ?? '#ffffff');
    counter.style.setProperty('--combo-pop', `${1.5 + level * 0.15}`);
    // Restart the pop animation.
    counter.classList.remove('w3d-pop');
    counter.getBoundingClientRect();
    counter.classList.add('w3d-pop');
  }

  // Tree style and logs

  /**
   * Older phones: if the detailed trees run slowly while aiming (when nothing heavy is happening),
   * switch to the simpler trees for good. Only when the player hasn't picked a style themselves.
   */
  #checkFallback(frameMs: number): void {
    const kind = this.#round.phase.kind;
    if (this.#styleChosen || this.#style !== 'quaternius') return;
    if (kind !== 'pick' && kind !== 'aim') return;
    this.#aimFrames.push(frameMs);
    if (this.#aimFrames.length < FALLBACK_FRAMES) return;
    const sorted = [...this.#aimFrames].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.#styleChosen = true;
    if (median > FALLBACK_MS) {
      this.#deps.logger.log('woodcutting3d.style', { style: 'kenney', auto: true, p50: median });
      this.#deps.treeStyle.set('kenney');
    }
  }

  /** Redraws the clearing with the other trees (picked in the debug menu, or by the fallback). */
  #applyStyle(style: TreeStyle): void {
    if (style === this.#style) return;
    this.#style = style;
    this.#buildTrees({ keepFallen: true });
    this.#scenery.setForest(this.#models[style]);
    // Mid-chop the notch was rebuilt away with the old trees: cut it again.
    const phase = this.#round.phase;
    if (phase.kind === 'chop' && phase.points > 0) {
      const frame = this.#closeUpFrame(phase.tree, phase.angle);
      if (frame)
        this.#carverFor(phase.tree, frame)?.carve(phase.points / this.#round.feel.chopPoints);
    }
    this.#updateTrees();
  }

  #logPerformance(): void {
    const times = [...this.#frameTimes].sort((a, b) => a - b);
    if (times.length === 0) return;
    const at = (share: number) =>
      Math.round((times[Math.floor((times.length - 1) * share)] ?? 0) * 10) / 10;
    this.#deps.logger.log('woodcutting3d.perf', {
      frames: times.length,
      p50: at(0.5),
      p95: at(0.95),
      max: at(1),
      style: this.#style,
      pixelRatio: this.#renderer.getPixelRatio(),
      carveMs: Math.round(Math.max(0, ...[...this.#carvers.values()].map((c) => c.slowestMs))),
      // The cabin's wreck, if it came down: its slowest physics step (ms) and how long it ran.
      ...(this.#cabin?.wreck && {
        wreckStepMs: Math.round(this.#cabin.wreck.slowestStepMs * 10) / 10,
        wreckSeconds: Math.round(this.#cabin.wreck.age * 10) / 10,
      }),
    });
  }
}

/**
 * Whether `visual` stands near the line from the camera toward its target (on the ground), within
 * the first `share` of that line and `radius` of it.
 */
/** Where a boulder is once it has rolled `distance` along its roll (bounces and all). */
function rollPoint(roll: BoulderRoll, distance: number): Point {
  let left = distance;
  let at = roll.path[0] ?? roll.from;
  for (const to of roll.path.slice(1)) {
    const length = Math.hypot(to.x - at.x, to.y - at.y);
    if (left <= length) {
      const share = length > 0 ? left / length : 0;
      return { x: at.x + (to.x - at.x) * share, y: at.y + (to.y - at.y) * share };
    }
    left -= length;
    at = to;
  }
  return at;
}

function blocks(visual: TreeVisual, pose: CameraPose, share: number, radius: number): boolean {
  return blocksAt(visual.root.position, pose, share, radius);
}

/** Whether something standing at `position` is within `radius` of the camera's line of sight. */
function blocksAt(
  position: THREE.Vector3,
  pose: CameraPose,
  share: number,
  radius: number,
): boolean {
  const from = new THREE.Vector2(pose.position.x, pose.position.z);
  const to = new THREE.Vector2(pose.target.x, pose.target.z);
  const at = new THREE.Vector2(position.x, position.z);
  const line = to.clone().sub(from);
  const t = Math.min(Math.max(at.clone().sub(from).dot(line) / line.lengthSq(), 0), share);
  const closest = from.clone().addScaledVector(line, t);
  return at.distanceTo(closest) < radius;
}
