import * as THREE from 'three';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { groundMesh, wornGround } from '../../../app/ground';
import type { ScreenView } from '../../../app/screen';
import type { Haptics } from '../../../app/haptics';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import { Rng, type EventLogger, type Game, type LiveTuning } from '../../../core';
import type { SplittingFeel, SplittingLog } from '../../../data';
import { generateLog } from '../logic/generate';
import { DEG, inArc, markArc, openHeads, starsFor, type Plan } from '../logic/pattern';
import { SplittingRound, type SplittingEvent } from '../logic/round';
import {
  BARK_TILE,
  STAVE_LENGTH,
  barkTextures,
  barkUvs,
  drawEndGrain,
  drawSplitGrain,
} from '../../../app/woodGrain';
import { capturePointer } from '../../../app/pointer';

export interface Splitting3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<SplittingFeel>;
  haptics: Haptics;
  /** Leaves the station (the end card's Back to camp). */
  onLeave: () => void;
}

const TAU = Math.PI * 2;
/** One-time flag: the practice log has been split. */
const TUTORIAL = 'tutorial.splitting';
/** The chopping block the log stands on: its height, and how much wider than the log it is. */
const BLOCK_HEIGHT = 0.55;
const BLOCK_SPREAD = 1.25;
/** How far the wedges open while the head is pumped through (world units, at the end). */
const STRAIN_GAP = 0.06;
/** The camera: how far it looks down (radians) and how far back it sits. */
const CAMERA_ELEVATION = 58 * DEG;
const CAMERA_DISTANCE = 9;
/** How far the splitting head sinks into the log. */
const HEAD_SINK = 0.5;
/** The head's hub height: the ram pushes on its top. */
const HUB_HEIGHT = 0.22;
/**
 * The press: a post behind the block with an arm hinged at its top, a bottle jack hanging upside
 * down from the arm's end over the pith, its chrome ram pushing the head. The jack's body length
 * and radius, the ram's least showing length (at the tallest log), the arm's thickness, and how
 * far it's swung up and back out of the way while you plan (radians).
 */
const JACK_LENGTH = 0.75;
const JACK_RADIUS = 0.17;
const RAM_MIN = 0.3;
const ARM_THICKNESS = 0.18;
const ARM_RAISED = -100 * DEG;
/** How far behind the pith the post stands, past the block's back. */
const POST_GAP = 0.18;
/** Seconds the arm takes to lift back up after the burst, and how long it waits first. */
const LIFT_SECONDS = 0.7;
const LIFT_DELAY = 0.5;
/**
 * The pump handle, in a socket near the top of the jack: how far it swings (from `HANDLE_REST`
 * above level to as far below), how much of a notch the head gives as it goes down before the
 * stroke clicks it in, its length, the grip's size, and the least gap above the tallest log.
 */
const HANDLE_SWING = 50 * DEG;
const HANDLE_REST = 25 * DEG;
const HANDLE_GIVE = 0.35;
const HANDLE_LENGTH = 1.5;
const GRIP_DROP = 0.11;
const HANDLE_CLEARANCE = 0.15;
/** How wide the cut lines are drawn (world units): thin, so you can see where they cross. */
const GUIDE_WIDTH = 0.025;
/** Staves drawn in the burst (past this many, the count says the rest). */
const MAX_STAVES_SHOWN = 64;
/**
 * A split stave: a wedge out of the log, its pith side `STAVE_PITH` of its bark side across, and
 * `STAVE_DEPTH` as thick as it's wide. The burst's staves are sized from the log they came from
 * (see `staveSize`), never thinner than `STAVE_MIN_WIDTH` across.
 */
const STAVE_PITH = 0.45;
const STAVE_DEPTH = 0.72;
const STAVE_MIN_WIDTH = 0.25;
/** The most of the log's wood one stave is drawn with, so a small split doesn't make boulders. */
const STAVE_MOST = 1 / 10;
/**
 * The heap: staves lie across in front of the block, stacked in a woodpile (each layer in the
 * gaps of the one under it, a row fewer each layer up), in one bay or, past `HEAP_ONE_BAY`
 * staves, two side by side. The gap between staves in a row, how far in front of the block it
 * starts, and how much each stave strays from its place (across, sideways and turned) so it
 * reads as a heap thrown down rather than a stack.
 */
const HEAP_ONE_BAY = 21;
const HEAP_GAP = 0.03;
const HEAP_CLEARANCE = 0.25;
const HEAP_STRAY = { across: 0.12, along: 0.025, yaw: 0.14, roll: 0.15 };
/** The share of the heap's staves lying bark up; the rest lie on a split face. */
const HEAP_BARK_UP = 0.25;
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
    'crash-wood',
    'star',
  ].map((name) => [name, `audio/woodcutting/${name}.mp3`]),
);
for (const name of ['press-slam', 'press-clunk', 'press-click']) {
  SOUNDS[name] = `audio/splitting/${name}.mp3`;
}
const COLORS = {
  sky: 0xb4cfa8,
  /** Tints over the bark photo (warmer for the log, darker and older for the block). */
  bark: 0xe2c6a6,
  blockBark: 0xa08a74,
  /** The block's top: its end grain darkened by weather and chopping. */
  blockWeather: 'rgb(122 104 88)',
  chopMark: 'rgb(60 40 24 / 0.55)',
  grain: { rot: '#5a4325', silver: '#cfd8dc', gold: '#f2c037' } as Record<string, string>,
  grainEdge: { rot: '#33240f', silver: '#8fa0a8', gold: '#a87a12' } as Record<string, string>,
  knot: '#3b2413',
  cancelled: '#9b9284',
  glowGood: '#7fd65a',
  glowBad: '#ff4a3a',
  steel: 0x9aa3a8,
  steelDark: 0x5d666b,
  frame: 0x3a4044,
  jack: 0xb3261e,
  chrome: 0xdfe4e8,
  rubber: 0x1c1c1c,
  guide: 0xf2ead3,
  danger: 0xe0503c,
  good: 0x7fd65a,
  crack: 0x1d120a,
};

/**
 * The press's moving parts. The arm pivots at its hinge (x = 0, `hinge` y and z in the log root);
 * along it, at the pith, hang the jack and its ram (`ramTop` below the hinge), the head under the
 * ram, and the handle's socket.
 */
interface Press {
  arm: THREE.Group;
  ram: THREE.Mesh;
  handle: THREE.Group;
  hinge: { y: number; z: number };
  ramTop: number;
}

/** A part of the log seen on its end: the arc of the end face it covers. */
interface Arc {
  id: string;
  start: number;
  width: number;
}

interface PieceVisual {
  arc: Arc;
  mesh: THREE.Group;
  /** Where it's easing from and to, and when it set off (and for how long). */
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromTilt: number;
  toTilt: number;
  fromScale: number;
  toScale: number;
  movedAt: number;
  seconds: number;
  /** Burst pieces hop on their way. */
  hop: number;
}

/** A stave in the burst: flying from the log to where it lands in the heap. */
interface StaveFlight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  launchAt: number;
  seconds: number;
  height: number;
  /** How it lies in the heap, and how much more it's turned as it sets off (tumbling to rest). */
  rest: THREE.Euler;
  spin: THREE.Vector3;
  /** Gone from the heap: it has set off into the chest. */
  left?: boolean;
}

/**
 * Splitting in 3D: a log stood on end on a chopping block, seen from above, split by a splitting
 * head (a star of blades) into staves. Pick a head and turn the cuts, strike to drop the head on,
 * pump the handle to drive it through, and the log bursts into its staves (times its grains).
 * The rules (SplittingRound) decide everything; this draws them and feeds them touches.
 */
export class Splitting3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Splitting3DDeps;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  readonly #timer = new THREE.Timer();
  readonly #raycaster = new THREE.Raycaster();
  readonly #sfx = new Sfx();
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #logRoot = new THREE.Group();
  #ui!: ReturnType<Splitting3DView['buildUi']>;
  #round: SplittingRound | undefined;
  #log: SplittingLog | undefined;
  #pieces = new Map<string, PieceVisual>();
  #faceTexture: THREE.CanvasTexture | undefined;
  #faceCanvas: HTMLCanvasElement | undefined;
  #grain: { id: string; end: HTMLCanvasElement; split: THREE.CanvasTexture } | undefined;
  /** The head chosen last, kept for the next log. */
  #lastHead: number | undefined;
  /** What the plan last drew (face glow, lines, equation), so it redraws only on change. */
  #planKey = '';
  /** The press (built once): its swinging arm, the ram, the handle, and where things hang. */
  #press!: Press;
  /** The splitting head on the ram, built for the head picked at the strike. */
  #head: { root: THREE.Group; count: number } | undefined;
  /** Round time the arm starts lifting back up after the burst. */
  #liftAt: number | undefined;
  /** The handle was down last frame (for the ratchet click as it comes back up). */
  #handleDown = false;
  #guideLines: THREE.Mesh[] = [];
  #cracks: THREE.Mesh[] = [];
  #staves!: THREE.InstancedMesh;
  /** The staves' split faces and ends: the log's own split grain, set as it bursts. */
  #staveWood!: THREE.MeshLambertMaterial;
  #flights: StaveFlight[] = [];
  #pointer:
    | {
        id: number;
        startY: number;
        /** Turning the cuts: where it started, and the recent turns for the lift guard. */
        turn:
          | {
              from: number;
              at: number;
              recent: { time: number; x: number; y: number; rotation: number }[];
            }
          | undefined;
      }
    | undefined;
  /**
   * The turn last shown and when it last clicked (a click each step), and the head and grains
   * cut then (a buzz when turning changes which grains are cut).
   */
  #shownTurn: number | undefined;
  #shownCut: string | undefined;
  #tickedAt = 0;
  /** The head's depth into the log as drawn (0–1), easing from one notch to the next. */
  #drive = { from: 0, to: 0, at: 0 };
  #shake = 0;
  /** How far the camera has eased back for the heap (0 in close, 1 all the way back). */
  #heapView = 0;
  #frozenUntil = 0;
  #bankedXp: XpDeposit | undefined;
  #lastPhase = '';
  #starsShown = 0;
  /** The staves the chest is holding back until they pour in from the heap. */
  #deposit: ReturnType<WarchestHud['hold']> | undefined;
  /** The finished log, waiting in its heap until it's time to show the card and pour. */
  #heap: { event: Extract<SplittingEvent, { type: 'done' }>; at: number } | undefined;

  private constructor(element: HTMLElement, deps: Splitting3DDeps, hud: WarchestHud) {
    this.#element = element;
    this.#deps = deps;
    this.#hud = hud;
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'splitting');
    this.#skill = station?.skill ?? 'splitting';
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.domElement.className = 'sp-canvas';
    element.append(this.#renderer.domElement);
    this.#buildWorld();
    this.#ui = this.buildUi();
    this.#sfx.load(SOUNDS);
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Splitting3DDeps): Promise<Splitting3DView> {
    const recipe = deps.game.data.recipes.find(
      (entry) => entry.id === deps.game.data.splitting.recipe,
    );
    const item = recipe?.outputs[0]?.item;
    if (!item) throw new Error('The splitting recipe makes nothing');
    const hud = await WarchestHud.create(element, {
      game: deps.game,
      item,
      haptics: deps.haptics,
      logger: deps.logger,
    });
    return new Splitting3DView(element, deps, hud);
  }

  /** Loads the models ahead of time (e.g. at the camp), so `create` doesn't wait for them. */
  static async preload(): Promise<void> {
    await WarchestHud.preload();
  }

  // ScreenView

  start(): void {
    restoreContext(this.#renderer);
    this.#hud.wake();
    this.#resize();
    this.#startLog();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  /** Back to camp once the head has dropped loses the cut in progress: nothing is banked. */
  leaveCost(): string | undefined {
    const kind = this.#round?.phase.kind;
    if (kind !== 'swing' && kind !== 'pump') return undefined;
    return 'Your cut in progress is lost.';
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#round?.exit();
    this.#round = undefined;
    this.#hud.sleep();
    this.#skillBar.settle();
    this.#bankedXp = undefined;
    this.#heap = undefined;
    this.#deposit = undefined;
    delete document.body.dataset.splitting;
    this.#lastPhase = '';
    releaseContext(this.#renderer, this.#deps.logger, 'splitting3d');
  }

  // Logs

  /** A new log, if there's one in the warchest to split: the practice log first, then random. */
  #startLog(): void {
    const { game } = this.#deps;
    const rules = game.data.splitting;
    const recipe = game.data.recipes.find((entry) => entry.id === rules.recipe);
    const input = recipe?.inputs[0];
    this.#ui.card.hidden = true;
    this.#clearBurst();
    if (input && !game.inventory.has(input.item, input.count)) {
      this.#round = undefined;
      this.#clearLog();
      this.#showNoLogs();
      return;
    }
    const tutorial = !game.hasDone(TUTORIAL);
    const seed = Date.now() >>> 0;
    const level = game.level(this.#skill);
    const heads = openHeads(rules, level);
    const log = tutorial ? rules.tutorialLog : generateLog(rules, seed, heads);
    this.#log = log;
    this.#round = new SplittingRound(
      log,
      {
        logger: this.#deps.logger,
        feel: () => this.#deps.feel.values,
        rules,
        heads,
        bank: (worth, staves) => {
          const before = game.xp(this.#skill);
          // XP on the staves split; the grains and stars multiply what goes into the warchest.
          const result = game.craft(rules.recipe, { yield: worth, xpYield: staves });
          this.#bankedXp = this.#skillBar.hold(game.xp(this.#skill) - before);
          if (tutorial) game.markDone(TUTORIAL);
          return result.produced.reduce((sum, stack) => sum + stack.count, 0);
        },
        onEvent: (event) => {
          this.#onEvent(event);
        },
      },
      seed,
      this.#lastHead ?? heads[heads.length - 1],
    );
    this.#drive = { from: 0, to: 0, at: 0 };
    this.#shownTurn = this.#shownCut = undefined;
    this.#planKey = '';
    this.#starsShown = 0;
    this.#buildLog(log);
    this.#buildPicker(level);
    this.#ui.logName.textContent = tutorial ? 'Practice log' : this.#grainNames(log);
  }

  #clearLog(): void {
    for (const visual of this.#pieces.values()) this.#logRoot.remove(visual.mesh);
    this.#pieces.clear();
    this.#faceTexture?.dispose();
    this.#faceTexture = undefined;
    if (this.#head) this.#head.root.visible = false;
    this.#liftAt = undefined;
  }

  // World

  #buildWorld(): void {
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(3, 8, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.#scene.add(sun);
    // The workbench yard: grass, trodden bare round the block where the work happens.
    this.#scene.add(groundMesh('meadowGrass', 40, 40));
    const { yard } = this.#deps.game.data.splitting;
    this.#scene.add(
      wornGround('troddenDirt', yard.radius * 2, yard.radius * 2, {
        cover: yard.wear,
        round: true,
        seed: 5,
      }),
    );
    this.#scene.add(this.#buildBlock());
    this.#logRoot.position.y = BLOCK_HEIGHT;
    this.#press = this.#buildPress();
    this.#scene.add(this.#logRoot);
    // The burst's staves: one mesh drawn many times, so a big log stays smooth on a phone. It's
    // rebuilt to each log's size when it bursts.
    const stave = staveGeometry({
      width: STAVE_MIN_WIDTH,
      thickness: STAVE_MIN_WIDTH * STAVE_DEPTH,
      length: STAVE_LENGTH,
    });
    const grain = new THREE.CanvasTexture(drawSplitGrain(64, 256, 5, 3));
    grain.colorSpace = THREE.SRGBColorSpace;
    this.#staveWood = new THREE.MeshLambertMaterial({ map: grain });
    const { map, normalMap } = barkTextures();
    const bark = new THREE.MeshLambertMaterial({ color: COLORS.bark, map, normalMap });
    // The box's sides in order: ±x, ±y, ±z.
    const wood = this.#staveWood;
    this.#staves = new THREE.InstancedMesh(
      stave,
      [wood, wood, bark, wood, wood, wood],
      MAX_STAVES_SHOWN,
    );
    this.#staves.receiveShadow = true;
    this.#staves.castShadow = true;
    this.#staves.count = 0;
    this.#staves.frustumCulled = false;
    this.#scene.add(this.#staves);
  }

  /**
   * The chopping block: a big old round of wood, bark round its side and its top weathered grey
   * and scarred with chop marks.
   */
  #buildBlock(): THREE.Group {
    const block = new THREE.Group();
    const top = BLOCK_SPREAD * 1.05;
    const bottom = BLOCK_SPREAD * 1.12;
    const sideGeometry = new THREE.CylinderGeometry(top, bottom, BLOCK_HEIGHT, 40, 1, true);
    barkUvs(sideGeometry, (top + bottom) / 2, BLOCK_HEIGHT, 0, TAU);
    const { map, normalMap } = barkTextures();
    const side = new THREE.Mesh(
      sideGeometry,
      new THREE.MeshLambertMaterial({ color: COLORS.blockBark, map, normalMap }),
    );
    side.position.y = BLOCK_HEIGHT / 2;
    const canvas = drawEndGrain(512, 34, 7);
    const context = canvas.getContext('2d');
    if (context) {
      context.globalCompositeOperation = 'multiply';
      context.fillStyle = COLORS.blockWeather;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-over';
      // Chop marks: short dark cuts from missed blows, mostly across the middle.
      const rng = new Rng(11);
      context.strokeStyle = COLORS.chopMark;
      context.lineCap = 'round';
      for (let mark = 0; mark < 16; mark++) {
        const angle = rng.range(0, TAU);
        const out = Math.sqrt(rng.range(0, 1)) * 0.75;
        const x = 256 + Math.cos(angle) * out * 256;
        const y = 256 + Math.sin(angle) * out * 256;
        const along = rng.range(0, Math.PI);
        const length = rng.range(18, 60);
        context.lineWidth = rng.range(1.5, 3.5);
        context.beginPath();
        context.moveTo(x - Math.cos(along) * length, y - Math.sin(along) * length);
        context.lineTo(x + Math.cos(along) * length, y + Math.sin(along) * length);
        context.stroke();
      }
    }
    const grain = new THREE.CanvasTexture(canvas);
    grain.colorSpace = THREE.SRGBColorSpace;
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(top, 40),
      new THREE.MeshLambertMaterial({ map: grain }),
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = BLOCK_HEIGHT;
    block.add(side, cap);
    block.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = true;
    });
    return block;
  }

  /**
   * The press, a bottle-jack log splitter: a steel post bolted behind the block, an arm hinged at
   * its top that swings over the log, and a red bottle jack hanging upside down from the arm's end
   * over the pith. Its chrome ram pushes the splitting head, creeping out a notch each pump of the
   * handle in the jack's socket. Sized for the tallest log, so the ram shows more on shorter ones.
   */
  #buildPress(): Press {
    const rules = this.#deps.game.data.splitting;
    const tallest = Math.max(rules.tutorialLog.height, rules.generator.height.max);
    const frame = new THREE.MeshPhongMaterial({ color: COLORS.frame, shininess: 40 });
    const jack = new THREE.MeshPhongMaterial({ color: COLORS.jack, shininess: 70 });
    const chrome = new THREE.MeshPhongMaterial({
      color: COLORS.chrome,
      shininess: 140,
      specular: 0xffffff,
    });
    // From the top of the tallest log up: hub, the ram's least length, the jack, its base plate,
    // and half the arm, to the hinge.
    const jackBottom = tallest - 0.03 + HUB_HEIGHT + RAM_MIN;
    const plate = 0.08;
    const hingeY = jackBottom + JACK_LENGTH + plate + ARM_THICKNESS / 2;
    const hingeZ = -(BLOCK_SPREAD * 1.12 + POST_GAP);
    const group = new THREE.Group();
    // The post, from the ground to the hinge, on a foot plate, strapped to the block.
    const postHeight = hingeY + BLOCK_HEIGHT;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, postHeight, 0.22), frame);
    post.position.set(0, postHeight / 2 - BLOCK_HEIGHT, hingeZ);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.5), frame);
    foot.position.set(0, 0.025 - BLOCK_HEIGHT, hingeZ);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), frame);
    strap.position.set(0, -BLOCK_HEIGHT / 2, hingeZ + 0.15);
    // The hinge: a knuckle across the top, with a stop the arm slams down onto.
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.34, 14), frame);
    knuckle.rotation.z = Math.PI / 2;
    knuckle.position.set(0, hingeY, hingeZ);
    group.add(post, foot, strap, knuckle);
    // The arm, pivoting at the hinge, reaching forward past the pith.
    const arm = new THREE.Group();
    arm.position.set(0, hingeY, hingeZ);
    // Up and back out of the way until a strike swings it over.
    arm.rotation.x = ARM_RAISED;
    const reach = -hingeZ + 0.2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.24, ARM_THICKNESS, reach), frame);
    beam.position.z = reach / 2;
    arm.add(beam);
    // The jack hangs under the arm's end over the pith (arm-local: the pith is at z = -hingeZ).
    const at = -hingeZ;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, plate, 18), jack);
    base.position.set(0, -ARM_THICKNESS / 2 - plate / 2, at);
    const jackTop = -ARM_THICKNESS / 2 - plate;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(JACK_RADIUS, JACK_RADIUS * 1.1, JACK_LENGTH, 18),
      jack,
    );
    body.position.set(0, jackTop - JACK_LENGTH / 2, at);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14), chrome);
    collar.position.set(0, jackTop - JACK_LENGTH - 0.03, at);
    arm.add(base, body, collar);
    // The ram: a unit-tall chrome rod, stretched each frame from the jack down to the head.
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 14), chrome);
    ram.position.z = at;
    arm.add(ram);
    // The handle's socket near the top of the jack, on the right, and the handle in it.
    const socketY = jackTop - 0.14;
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.14), jack);
    socket.position.set(JACK_RADIUS + 0.05, socketY, at);
    arm.add(socket);
    const handle = new THREE.Group();
    handle.position.set(JACK_RADIUS + 0.1, socketY, at);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, HANDLE_LENGTH, 10), frame);
    bar.rotation.z = Math.PI / 2;
    bar.position.x = HANDLE_LENGTH / 2;
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.36, 12),
      new THREE.MeshLambertMaterial({ color: COLORS.rubber }),
    );
    grip.rotation.z = Math.PI / 2;
    grip.position.x = HANDLE_LENGTH - 0.18;
    handle.add(bar, grip);
    arm.add(handle);
    group.add(arm);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    // At the bottom of a stroke the handle dips HANDLE_SWING - HANDLE_REST below level: it must
    // stay above the tallest log, grip and all, so it never looks to go into the wood.
    const socketHeight = hingeY + socketY;
    const lowest = socketHeight - Math.sin(HANDLE_SWING - HANDLE_REST) * HANDLE_LENGTH - GRIP_DROP;
    if (lowest < tallest + HANDLE_CLEARANCE) {
      throw new Error('The press handle would dip into the log: raise the jack');
    }
    this.#logRoot.add(group);
    return {
      arm,
      ram,
      handle,
      hinge: { y: hingeY, z: hingeZ },
      ramTop: jackTop - JACK_LENGTH - 0.06,
    };
  }

  /** The splitting head for a `count`-way split: a steel blade along each cut line from a hub. */
  #buildHead(count: number, radius: number) {
    if (this.#head) this.#press.arm.remove(this.#head.root);
    const root = new THREE.Group();
    const steel = new THREE.MeshPhongMaterial({ color: COLORS.steel, shininess: 60 });
    const dark = new THREE.MeshPhongMaterial({ color: COLORS.steelDark, shininess: 40 });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, HUB_HEIGHT, 16), dark);
    hub.position.y = HUB_HEIGHT / 2;
    root.add(hub);
    // Blades sit along the face's angles; their outline runs from the hub to just past the bark.
    for (let index = 0; index < count; index++) {
      const geometry = new THREE.BoxGeometry(radius * 1.02, 0.24, 0.04);
      geometry.translate((radius * 1.02) / 2, 0.12, 0);
      const blade = new THREE.Mesh(geometry, steel);
      blade.rotation.y = (index * TAU) / count;
      root.add(blade);
    }
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
    this.#press.arm.add(root);
    this.#head = { root, count };
    return this.#head;
  }

  /** A cut line on the end face, drawn over everything (one per line, made as needed). */
  #guideLine(index: number): THREE.Mesh {
    const existing = this.#guideLines[index];
    if (existing) return existing;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0.5, 0, 0);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: COLORS.guide,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 10;
    this.#guideLines[index] = mesh;
    this.#logRoot.add(mesh);
    return mesh;
  }

  /** A crack racing down the bark at the end of a cut line (one per line, made as needed). */
  #crack(index: number): THREE.Mesh {
    const existing = this.#cracks[index];
    if (existing) return existing;
    const crack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 1),
      new THREE.MeshBasicMaterial({ color: COLORS.crack, side: THREE.DoubleSide }),
    );
    this.#cracks[index] = crack;
    this.#logRoot.add(crack);
    return crack;
  }

  /** The log as one piece (the whole end face), its end grain drawn from data. */
  #buildLog(log: SplittingLog): void {
    this.#clearLog();
    this.#faceTexture = this.#drawFace(log, [], []);
    this.#addPiece({ id: 'log', start: 0, width: TAU }, new THREE.Vector3(), 0);
  }

  /**
   * The end grain: the log's wood (drawn once per log), knots as dark patches,
   * and each grain as a coloured patch over the arc of the face it covers (the arc the rules
   * use), marked with what it's worth. Grains the cuts would run through glow (red for a good
   * one, green for rot); ones a struck head has cut are drawn faded and crossed out.
   */
  #drawFace(
    log: SplittingLog,
    aimed: readonly number[],
    cancelled: readonly number[],
  ): THREE.CanvasTexture {
    const size = 512;
    const canvas = this.#faceCanvas ?? document.createElement('canvas');
    this.#faceCanvas = canvas;
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    const middle = size / 2;
    const radius = size / 2;
    // Canvas y runs down; the face's angles run counter-clockwise from +x, as in the rules.
    const at = (angle: number, share: number) => ({
      x: middle + Math.cos(angle) * radius * share,
      y: middle - Math.sin(angle) * radius * share,
    });
    context.drawImage(this.#grainFor(log).end, 0, 0, size, size);
    const kinds = this.#deps.game.data.splitting.grainKinds;
    const wedgePath = (mark: { angle: number; width: number }) => {
      // Canvas angles run clockwise, so the face's angles are negated.
      const from = -(mark.angle + mark.width / 2) * DEG;
      const to = -(mark.angle - mark.width / 2) * DEG;
      context.beginPath();
      context.arc(middle, middle, radius * 0.93, from, to);
      context.arc(middle, middle, radius * 0.16, to, from, true);
      context.closePath();
    };
    for (const knot of log.knots) {
      wedgePath(knot);
      context.fillStyle = COLORS.knot;
      context.fill();
    }
    log.grains.forEach((grain, index) => {
      const alive = !cancelled.includes(index);
      wedgePath(grain);
      // The wood shows through a little, so a grain reads as part of the log.
      context.globalAlpha = alive ? 0.8 : 0.35;
      context.fillStyle = alive ? (COLORS.grain[grain.kind] ?? '#888') : COLORS.cancelled;
      context.fill();
      context.globalAlpha = 1;
      const multiplier = kinds.find((kind) => kind.id === grain.kind)?.multiplier ?? 1;
      if (alive && aimed.includes(index)) {
        const glow = multiplier < 1 ? COLORS.glowGood : COLORS.glowBad;
        context.save();
        context.shadowColor = glow;
        context.shadowBlur = 28;
        context.lineWidth = 12;
        context.strokeStyle = glow;
        context.stroke();
        context.restore();
      }
      context.lineWidth = 4;
      context.strokeStyle = alive ? (COLORS.grainEdge[grain.kind] ?? '#444') : COLORS.cancelled;
      context.stroke();
      const label = at(grain.angle * DEG, 0.62);
      context.font = '900 44px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 7;
      context.strokeStyle = 'rgba(0,0,0,0.75)';
      context.fillStyle = alive ? '#fff' : '#ddd';
      const text = alive ? `×${times(multiplier)}` : '✕';
      context.strokeText(text, label.x, label.y);
      context.fillText(text, label.x, label.y);
    });
    if (this.#faceTexture) {
      this.#faceTexture.needsUpdate = true;
      return this.#faceTexture;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // The wedge tops' UVs are their outline in world units (−radius to +radius): fit the face.
    texture.repeat.set(1 / (2 * log.radius), 1 / (2 * log.radius));
    texture.offset.set(0.5, 0.5);
    return texture;
  }

  /**
   * The wood drawn for this log (its end grain, and its split face as a texture), made once per
   * log from its id, so the same log always looks the same.
   */
  #grainFor(log: SplittingLog): { end: HTMLCanvasElement; split: THREE.CanvasTexture } {
    if (this.#grain?.id === log.id) return this.#grain;
    this.#grain?.split.dispose();
    let seed = 7;
    for (let index = 0; index < log.id.length; index++) {
      seed = (seed * 31 + log.id.charCodeAt(index)) | 0;
    }
    const split = new THREE.CanvasTexture(drawSplitGrain(128, 256, log.rings, seed));
    split.colorSpace = THREE.SRGBColorSpace;
    this.#grain = { id: log.id, end: drawEndGrain(512, log.rings, seed), split };
    return this.#grain;
  }

  /** The log's grains, for its name, repeats counted: "3 Silver ×2 · Rot ×½". */
  #grainNames(log: SplittingLog): string {
    const kinds = this.#deps.game.data.splitting.grainKinds;
    const names = kinds.flatMap((kind) => {
      const count = log.grains.filter((grain) => grain.kind === kind.id).length;
      if (count === 0) return [];
      return [`${count > 1 ? `${String(count)} ` : ''}${kind.name} ×${times(kind.multiplier)}`];
    });
    const knots = log.knots.length;
    if (knots > 0) names.push(`${String(knots)} knot${knots === 1 ? '' : 's'}`);
    return names.length > 0 ? names.join(' · ') : 'Plain log';
  }

  /**
   * A piece as a solid wedge standing on the block: bark round the outside, fresh wood on the
   * split faces, and its top showing its part of the end grain.
   */
  #addPiece(arc: Arc, at: THREE.Vector3, movedAt: number): PieceVisual {
    const log = this.#log;
    if (!log) throw new Error('No log');
    const { radius, height } = log;
    const whole = arc.width >= TAU - 1e-9;
    const root = new THREE.Group();
    const segments = Math.max(4, Math.ceil((arc.width / TAU) * 48));
    // The top: the piece's outline, its UVs in world units to show its part of the end face.
    const shape = new THREE.Shape();
    if (whole) {
      shape.absarc(0, 0, radius, 0, TAU, false);
    } else {
      shape.moveTo(0, 0);
      shape.absarc(0, 0, radius, arc.start, arc.start + arc.width, false);
      shape.lineTo(0, 0);
    }
    const topGeometry = new THREE.ShapeGeometry(shape, segments);
    topGeometry.rotateX(-Math.PI / 2);
    const top = new THREE.Mesh(
      topGeometry,
      new THREE.MeshLambertMaterial({ map: this.#faceTexture ?? null }),
    );
    top.position.y = height;
    // The bark: a cylinder's side over the piece's arc (its angles start a quarter turn round).
    const barkGeometry = new THREE.CylinderGeometry(
      radius,
      radius,
      height,
      segments,
      1,
      true,
      arc.start + Math.PI / 2,
      arc.width,
    );
    barkUvs(barkGeometry, radius, height, arc.start + Math.PI / 2, arc.width);
    const { map, normalMap } = barkTextures();
    const bark = new THREE.Mesh(
      barkGeometry,
      new THREE.MeshLambertMaterial({ color: COLORS.bark, map, normalMap, side: THREE.DoubleSide }),
    );
    bark.position.y = height / 2;
    root.add(top, bark);
    if (!whole) {
      for (const edge of [arc.start, arc.start + arc.width]) {
        const geometry = new THREE.PlaneGeometry(radius, height);
        geometry.translate(radius / 2, height / 2, 0);
        const face = new THREE.Mesh(
          geometry,
          new THREE.MeshLambertMaterial({ map: this.#grainFor(log).split, side: THREE.DoubleSide }),
        );
        face.rotation.y = edge;
        root.add(face);
      }
    }
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = true;
    });
    root.position.copy(at);
    this.#logRoot.add(root);
    const visual: PieceVisual = {
      arc,
      mesh: root,
      from: at.clone(),
      to: at.clone(),
      fromTilt: 0,
      toTilt: 0,
      fromScale: 1,
      toScale: 1,
      movedAt,
      seconds: 0,
      hop: 0,
    };
    this.#pieces.set(arc.id, visual);
    return visual;
  }

  /** The face's angle as a direction on the block (the face's y runs away from the camera). */
  #direction(angle: number): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
  }

  #move(
    visual: PieceVisual,
    to: THREE.Vector3,
    options: { tilt?: number; scale?: number; seconds: number; hop?: number },
  ): void {
    visual.from.copy(visual.mesh.position);
    visual.fromTilt = visual.mesh.rotation.z;
    visual.fromScale = visual.mesh.scale.x;
    visual.to.copy(to);
    visual.toTilt = options.tilt ?? 0;
    visual.toScale = options.scale ?? 1;
    visual.movedAt = this.#round?.now ?? 0;
    visual.seconds = options.seconds;
    visual.hop = options.hop ?? 0;
  }

  // Events

  #onEvent(event: SplittingEvent): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    const log = this.#log;
    if (!round || !log) return;
    if (event.type === 'strike') {
      const head = this.#buildHead(round.count, log.radius);
      head.root.rotation.y = round.rotation;
      head.root.visible = true;
      this.#liftAt = undefined;
      // The struck plan's cut grains are gone for good.
      this.#drawFace(log, [], round.plan.cut);
      this.#play('creak-1', 0.35, 500);
    } else if (event.type === 'landed') {
      // The arm slams onto its stop and the head bites in.
      this.#play('press-slam', 0.9, -200);
      this.#play('chop-perfect', 0.7, -250);
      this.#play(`chop-${1 + Math.floor(Math.random() * 3)}`, 0.6);
      this.#deps.haptics.pulse(feel.buzzStrikeMs);
      this.#shake = 0.07 * feel.shakeStrength;
      this.#frozenUntil = performance.now() + feel.hitStopMs;
      // The log becomes its wedges, standing together until the head drives them apart.
      const whole = this.#pieces.get('log');
      if (whole) this.#logRoot.remove(whole.mesh);
      this.#pieces.delete('log');
      for (const wedge of round.plan.wedges) {
        this.#addPiece(
          { id: String(wedge.index), start: wedge.start, width: wedge.width },
          new THREE.Vector3(),
          round.now,
        );
      }
    } else if (event.type === 'stroke') {
      this.#stroke(event.stroke, event.strokes);
    } else {
      this.#burst(event);
    }
  }

  /**
   * A stroke of the pump: the head jolts one notch deeper, each one harder than the last (louder,
   * lower, a longer buzz and a bigger shake), so it builds to the burst.
   */
  #stroke(stroke: number, strokes: number): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    if (!round) return;
    const build = stroke / strokes;
    this.#drive = { from: this.#driveDepth(), to: build, at: round.now };
    // The jack's clunk as the ram jolts out, and the wood creaking under it.
    this.#play('press-clunk', 0.5 + build * 0.4, -120 * stroke);
    this.#play(`chop-${1 + Math.floor(Math.random() * 3)}`, 0.3 + build * 0.3, -150 * stroke);
    this.#play(`creak-${1 + Math.floor(Math.random() * 3)}`, 0.25 + build * 0.45, -400 * build);
    this.#deps.haptics.pulse(feel.buzzPumpMs + Math.round(build * feel.buzzPumpBuildMs));
    this.#shake = (0.03 + 0.07 * build) * feel.shakeStrength;
    this.#frozenUntil = performance.now() + feel.hitStopMs * (0.4 + 0.6 * build);
  }

  /** How deep the head is drawn now: easing into the last notch the pump drove it to. */
  #driveDepth(): number {
    const round = this.#round;
    if (!round) return 0;
    const { from, to, at } = this.#drive;
    const t = Math.min(Math.max((round.now - at) / this.#deps.feel.values.pumpSeconds, 0), 1);
    return from + (to - from) * (1 - (1 - t) ** 3);
  }

  /**
   * Through: a big hit, the wedges fly apart, and the log's worth of staves bursts out and lands
   * in a heap in front of the block, then pours into the chest.
   */
  #burst(event: Extract<SplittingEvent, { type: 'done' }>): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    const log = this.#log;
    if (!round || !log) return;
    this.#play('crash-wood', 0.9, 100);
    this.#play('chop-perfect', 1, -400);
    this.#play(`land-${1 + Math.floor(Math.random() * 3)}`, 0.7);
    this.#deps.haptics.pulse(feel.buzzBurstMs);
    this.#shake = 0.18 * feel.shakeStrength;
    this.#frozenUntil = performance.now() + feel.hitStopMs * 1.5;
    // The press lifts back out of the way once the staves are flying.
    this.#liftAt = round.now + LIFT_DELAY;
    for (const visual of this.#pieces.values()) {
      const out = this.#direction(visual.arc.start + visual.arc.width / 2);
      this.#move(visual, out.multiplyScalar(1.3).setY(0.2), {
        tilt: Math.PI / 3,
        scale: 0,
        seconds: feel.burstSeconds * 0.5,
        hop: 0.8,
      });
    }
    // The chest holds the staves back until they pour in from the heap.
    const xp = this.#bankedXp;
    this.#bankedXp = undefined;
    this.#deposit =
      event.banked > 0 ? this.#hud.hold(event.banked, (share) => xp?.arrive(share)) : undefined;
    // The staves fly from the log onto a heap in front of the block, the bottom of it first. They
    // show the log's own split grain.
    this.#staveWood.map = this.#grainFor(log).split;
    const shown = Math.min(event.banked, MAX_STAVES_SHOWN);
    const size = staveSize(log, shown);
    this.#staves.geometry.dispose();
    this.#staves.geometry = staveGeometry(size);
    const start = new THREE.Vector3(0, BLOCK_HEIGHT + log.height * 0.8, 0);
    const places = heapPlaces(shown, size);
    this.#flights = places.map((place, index) => {
      const seconds = feel.burstSeconds * (0.45 + Math.random() * 0.1);
      const landAt = round.now + feel.burstSeconds * (0.5 + (0.45 * index) / shown);
      return {
        from: start.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0)),
        to: place.at,
        rest: place.turn,
        launchAt: landAt - seconds,
        seconds,
        height: 1 + Math.random() * 1.2,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 14,
        ),
      };
    });
    this.#staves.count = shown;
    // Let the heap sit a moment before it pours in (on the round's clock, so hit-stop counts).
    this.#heap = { event, at: round.now + feel.burstSeconds + feel.heapSeconds };
  }

  /**
   * The heap's staves fly into the chest, off the top of the heap first, each one leaving the heap
   * as it sets off; the log's XP ticks in with them.
   */
  #pourStaves(): void {
    const deposit = this.#deposit;
    this.#deposit = undefined;
    if (!deposit) return;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const flights = this.#flights;
    const order = flights
      .map((flight, index) => ({ index, y: flight.to.y }))
      .sort((a, b) => b.y - a.y)
      .map((entry) => entry.index);
    const points: ScreenPoint[] = order.map((index) => {
      const projected = (flights[index]?.to ?? new THREE.Vector3()).clone().project(this.#camera);
      return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
    });
    deposit.pour(points, (source) => {
      const flight = flights[order[source] ?? -1];
      if (flight) flight.left = true;
    });
  }

  #clearBurst(): void {
    this.#heap = undefined;
    this.#flights = [];
    this.#staves.count = 0;
  }

  // Loop

  #loop(time: number): void {
    this.#timer.update(time);
    const realDt = Math.min(this.#timer.getDelta(), 0.05);
    const round = this.#round;
    if (round && performance.now() >= this.#frozenUntil) round.tick(realDt);
    const heap = this.#heap;
    if (heap && round && round.now >= heap.at) {
      this.#heap = undefined;
      this.#showCard(heap.event);
      this.#pourStaves();
    }
    this.#updatePieces();
    this.#updateTools();
    this.#updateStaves();
    this.#updateUi();
    this.#updateCamera(realDt);
    this.#renderer.render(this.#scene, this.#camera);
  }

  #updatePieces(): void {
    const round = this.#round;
    if (!round) return;
    const strain = round.phase.kind === 'pump' ? this.#headDepth() : 0;
    for (const visual of this.#pieces.values()) {
      // Standing wedges open a little as the head drives in.
      if (visual.seconds === 0 && visual.arc.id !== 'log') {
        const out = this.#direction(visual.arc.start + visual.arc.width / 2);
        visual.mesh.position.copy(out.multiplyScalar(STRAIN_GAP * strain));
        continue;
      }
      if (visual.seconds === 0) continue;
      const t = Math.min(Math.max((round.now - visual.movedAt) / visual.seconds, 0), 1);
      const eased = 1 - (1 - t) ** 3;
      const position = visual.from.clone().lerp(visual.to, eased);
      position.y += Math.sin(eased * Math.PI) * visual.hop;
      visual.mesh.position.copy(position);
      visual.mesh.rotation.z = visual.fromTilt + (visual.toTilt - visual.fromTilt) * eased;
      visual.mesh.scale.setScalar(
        Math.max(visual.fromScale + (visual.toScale - visual.fromScale) * eased, 0.0001),
      );
    }
  }

  /** The head's depth as drawn (0–1): the notch it's at, plus the give as the handle goes down. */
  #headDepth(): number {
    const phase = this.#round?.phase;
    if (phase?.kind === 'done') return 1;
    if (phase?.kind !== 'pump') return 0;
    const { pump } = phase;
    return Math.min(this.#driveDepth() + (pump.handle * HANDLE_GIVE) / pump.strokes, 1);
  }

  /**
   * The press for this frame: the head's root at `headY` (log-root height, when the arm is down),
   * the ram reaching from the jack to it, the handle `handle` of the way down, and the arm swung
   * up out of the way while planning and after the burst (the strike swings it down).
   */
  #placePress(headY: number, handle: number): void {
    const press = this.#press;
    const round = this.#round;
    // Arm-local: the hinge is the origin and the pith is ahead of it.
    const headLocal = headY - press.hinge.y;
    const top = headLocal + HUB_HEIGHT;
    const length = Math.max(press.ramTop - top, 0.01);
    press.ram.scale.y = length;
    press.ram.position.y = top + length / 2;
    if (this.#head) this.#head.root.position.set(0, headLocal, -press.hinge.z);
    press.handle.rotation.z = HANDLE_REST - handle * HANDLE_SWING;
    const phase = round?.phase.kind;
    // The ratchet clicks as the handle comes back up for the next stroke.
    const down = handle > 0.5;
    if (this.#handleDown && !down && phase === 'pump') this.#play('press-click', 0.45);
    this.#handleDown = down;
    if (phase === 'plan' || !round) {
      press.arm.rotation.x = ARM_RAISED;
    } else if (phase === 'done' && this.#liftAt !== undefined) {
      const t = Math.min(Math.max((round.now - this.#liftAt) / LIFT_SECONDS, 0), 1);
      press.arm.rotation.x = ARM_RAISED * (t * t * (3 - 2 * t));
    } else {
      press.arm.rotation.x = 0;
    }
  }

  /** The cut lines while planning; the head dropping and driving in, and the cracks, after. */
  #updateTools(): void {
    const round = this.#round;
    const log = this.#log;
    const phase = round?.phase;
    for (const line of this.#guideLines) line.visible = false;
    for (const crack of this.#cracks) crack.visible = false;
    if (!round || !log || !phase) return;
    const plan = round.plan;
    if (phase.kind === 'plan') {
      this.#placePress(log.height - 0.03, 0);
      plan.lines.forEach((angle, index) => {
        const mesh = this.#guideLine(index);
        mesh.visible = true;
        mesh.position.set(0, log.height + 0.01, 0);
        mesh.rotation.set(0, angle, 0);
        mesh.scale.set(log.radius, 1, GUIDE_WIDTH);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(this.#lineColor(angle));
      });
      return;
    }
    const pump = phase.kind === 'pump' ? phase.pump : undefined;
    const progress = this.#headDepth();
    this.#placePress(log.height - 0.03 - progress * HEAD_SINK, pump?.handle ?? 0);
    if (phase.kind === 'swing') {
      // The arm swings over the log, speeding up as it falls, and slams down as the head lands.
      const t = Math.min((round.now - phase.at) / round.feel.strikeSeconds, 1);
      this.#press.arm.rotation.x = ARM_RAISED * (1 - t * t);
    }
    if (!pump) return;
    // A crack runs down the bark at the end of every line, further with each stroke.
    plan.lines.forEach((angle, index) => {
      const crack = this.#crack(index);
      const out = this.#direction(angle);
      crack.visible = true;
      const depth = log.height * Math.max(progress, 0.04);
      crack.scale.set(1, depth, 1);
      crack.position.copy(out).multiplyScalar(log.radius + 0.01);
      crack.position.y = log.height - depth / 2;
      crack.rotation.set(0, angle + Math.PI / 2, 0);
    });
  }

  /** Red through a good grain, green through rot; else plain. */
  #lineColor(angle: number): number {
    const log = this.#log;
    if (!log) return COLORS.guide;
    const rules = this.#deps.game.data.splitting;
    const through = log.grains.filter((grain) => {
      const arc = markArc(grain);
      return inArc(angle, arc.start, arc.width);
    });
    const value = (kind: string) =>
      rules.grainKinds.find((entry) => entry.id === kind)?.multiplier ?? 1;
    if (through.some((grain) => value(grain.kind) > 1)) return COLORS.danger;
    if (through.length > 0) return COLORS.good;
    return COLORS.guide;
  }

  /** The burst's staves: arcing out of the log, tumbling, then lying in the heap. */
  #updateStaves(): void {
    const round = this.#round;
    if (this.#flights.length === 0 || !round) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const hidden = new THREE.Vector3(0, 0, 0);
    this.#flights.forEach((flight, index) => {
      const t = (round.now - flight.launchAt) / flight.seconds;
      if (t < 0 || flight.left) {
        matrix.compose(flight.from, rotation.identity(), hidden);
      } else {
        const done = Math.min(t, 1);
        const position = flight.from.clone().lerp(flight.to, done);
        position.y += flight.height * 4 * done * (1 - done);
        const left = 1 - done;
        const tumble = new THREE.Euler(
          flight.rest.x + flight.spin.x * left,
          flight.rest.y + flight.spin.y * left,
          flight.rest.z + flight.spin.z * left,
        );
        rotation.setFromEuler(tumble);
        matrix.compose(position, rotation, scale);
      }
      this.#staves.setMatrixAt(index, matrix);
    });
    this.#staves.instanceMatrix.needsUpdate = true;
  }

  #updateCamera(dt: number): void {
    const log = this.#log;
    const target = new THREE.Vector3(0, BLOCK_HEIGHT + (log?.height ?? 1.6) * 0.55, 0.35);
    const back = new THREE.Vector3(0, Math.sin(CAMERA_ELEVATION), Math.cos(CAMERA_ELEVATION));
    // Back while there's a heap out (until the next log), in close otherwise.
    const feel = this.#deps.feel.values;
    const step = dt / feel.heapCameraSeconds;
    this.#heapView =
      this.#flights.length > 0
        ? Math.min(this.#heapView + step, 1)
        : Math.max(this.#heapView - step, 0);
    const eased = this.#heapView * this.#heapView * (3 - 2 * this.#heapView);
    this.#camera.position
      .copy(target)
      .addScaledVector(back, CAMERA_DISTANCE + eased * feel.heapCameraBack);
    this.#shake *= Math.exp(-10 * dt);
    if (this.#shake > 0.001) {
      this.#camera.position.add(
        new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(this.#shake),
      );
    }
    this.#camera.lookAt(target);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    // Narrow portrait screens: widen the view so the whole block and heap fit across.
    this.#camera.fov = width / height < 0.6 ? 46 : 40;
    this.#camera.updateProjectionMatrix();
  }

  #play(name: string, volume: number, detune = 0): void {
    this.#sfx.play(name, volume, detune + (Math.random() - 0.5) * 80);
  }

  // Input

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      // The audio can only start from a touch.
      this.#sfx.unlock();
      const round = this.#round;
      if (!round || this.#pointer) return;
      if (!capturePointer(canvas, event.pointerId)) return;
      const angle = this.#angleAt(event.clientX, event.clientY);
      this.#pointer = {
        id: event.pointerId,
        startY: event.clientY,
        // A finger keeps doing what it started: one that was turning the cuts doesn't pump.
        turn:
          round.phase.kind === 'plan' && angle !== undefined
            ? { from: round.rotation, at: angle, recent: [] }
            : undefined,
      };
    });
    canvas.addEventListener('pointermove', (event) => {
      const pointer = this.#pointer;
      const round = this.#round;
      if (!pointer || pointer.id !== event.pointerId || !round) return;
      const phase = round.phase;
      if (phase.kind === 'plan' && pointer.turn) {
        // Turning: the cuts follow the finger round the pith, a step at a time.
        const angle = this.#angleAt(event.clientX, event.clientY);
        if (angle === undefined) return;
        const { turn } = pointer;
        turn.recent.push({
          time: performance.now(),
          x: event.clientX,
          y: event.clientY,
          rotation: round.rotation,
        });
        if (turn.recent.length > 40) turn.recent.shift();
        round.turnTo(turn.from + angle - turn.at);
      } else if (phase.kind === 'pump' && !pointer.turn) {
        // Pumping: swipe down for a stroke, back up (or lift) for the next.
        round.pull(event.clientY - pointer.startY);
      }
    });
    const end = (event: PointerEvent) => {
      const pointer = this.#pointer;
      if (pointer?.id !== event.pointerId) return;
      const round = this.#round;
      if (round?.phase.kind === 'pump' && !pointer.turn) {
        // Where the finger lifted counts too: moves can be dropped on a fast flick.
        round.pull(event.clientY - pointer.startY);
        round.release();
      } else if (round?.phase.kind === 'plan' && pointer.turn) {
        this.#guardLift(round, pointer.turn.recent, event);
      }
      this.#pointer = undefined;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /**
   * A finger that was holding still before it lifted meant the turn it was holding: lifting rolls
   * the touch point a pixel or two, which mustn't nudge the cuts off it. If the finger moved under
   * `liftPx` in its last `liftMs`, the turn goes back to where it was then.
   */
  #guardLift(
    round: SplittingRound,
    recent: readonly { time: number; x: number; y: number; rotation: number }[],
    event: PointerEvent,
  ): void {
    const feel = this.#deps.feel.values;
    const settled = performance.now() - feel.liftMs;
    const before = recent.filter((entry) => entry.time <= settled).at(-1);
    if (!before || before.rotation === round.rotation) return;
    const moved = Math.hypot(event.clientX - before.x, event.clientY - before.y);
    if (moved >= feel.liftPx) return;
    this.#deps.logger.log('splitting.liftGuard', {
      from: Math.round(round.rotation / DEG),
      to: Math.round(before.rotation / DEG),
      moved: Math.round(moved),
    });
    round.turnTo(before.rotation);
  }

  /** The angle round the pith (as the face measures it) of a point on the screen. */
  #angleAt(clientX: number, clientY: number): number | undefined {
    const log = this.#log;
    if (!log) return undefined;
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(log.height + BLOCK_HEIGHT));
    const point = this.#raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return point ? Math.atan2(-point.z, point.x) : undefined;
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
    const root = el('div', 'sp-ui');
    const logName = el('div', 'sp-log-name');
    // The stars this plan would earn, and what each needs.
    const stars = el('div', 'sp-stars');
    const starRow = el('div', 'sp-star-row');
    const starIcons = [0, 1, 2].map(() => el('span', 'sp-star', '★'));
    starRow.append(...starIcons);
    const starText = el('div', 'sp-star-text');
    stars.append(starRow, starText);
    const hint = el('div', 'sp-hint');
    // The plan as a sum: staves × each grain kept (cut ones struck through) = what the log makes.
    const sum = el('div', 'sp-sum');
    const heads = el('div', 'sp-heads');
    heads.setAttribute('role', 'radiogroup');
    heads.setAttribute('aria-label', 'Splitting head');
    const flashes = el('div', 'sp-flashes');
    const controls = el('div', 'sp-controls');
    const left = button('↺', 'sp-button sp-nudge', () => {
      this.#round?.nudge(1);
    });
    const strike = button('Strike', 'sp-button sp-strike', () => {
      this.#round?.strike();
    });
    const right = button('↻', 'sp-button sp-nudge', () => {
      this.#round?.nudge(-1);
    });
    left.setAttribute('aria-label', 'Turn the cuts counter-clockwise');
    right.setAttribute('aria-label', 'Turn the cuts clockwise');
    controls.append(left, strike, right);
    // The turn of the cuts, in degrees.
    const turn = el('div', 'sp-turn');
    turn.setAttribute('aria-label', 'Turn of the cuts');
    const card = el('div', 'sp-card');
    const cardStars = el('div', 'w3d-stars sp-card-stars');
    const cardTitle = el('div', 'sp-card-title');
    const cardText = el('div', 'sp-card-text');
    const cardButtons = el('div', 'sp-card-buttons');
    const leave = button('Back to camp', 'sp-button sp-secondary', () => {
      this.#deps.onLeave();
    });
    const next = button('Next log', 'sp-button', () => {
      this.#hud.settle();
      this.#skillBar.settle();
      this.#startLog();
    });
    cardButtons.append(leave, next);
    card.append(cardStars, cardTitle, cardText, cardButtons);
    card.hidden = true;
    root.append(logName, stars, turn, hint, sum, heads, flashes, controls, card);
    this.#element.append(root);
    return {
      root,
      logName,
      stars,
      starIcons,
      starText,
      hint,
      sum,
      heads,
      flashes,
      controls,
      strike,
      turn,
      card,
      cardStars,
      cardTitle,
      cardText,
      next,
    };
  }

  /**
   * The head picker: a button per open head, each drawn as the cut it makes (a log end split
   * that many ways), and the next head to open, locked, with the level it needs.
   */
  #buildPicker(level: number): void {
    const round = this.#round;
    if (!round) return;
    const rules = this.#deps.game.data.splitting;
    const locked = rules.cutters
      .filter((cutter) => cutter.level > level)
      .sort((a, b) => a.level - b.level || a.count - b.count)[0];
    const entries = [
      ...round.heads.map((count) => ({ count, level: undefined as number | undefined })),
      ...(locked ? [{ count: locked.count, level: locked.level }] : []),
    ];
    const buttons = entries.map(({ count, level: needs }) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `sp-head${needs === undefined ? '' : ' sp-head-locked'}`;
      item.dataset.count = String(count);
      item.setAttribute('role', 'radio');
      item.setAttribute(
        'aria-label',
        needs === undefined
          ? `${String(count)}-way head`
          : `${String(count)}-way head, opens at level ${String(needs)}`,
      );
      item.innerHTML = `${headIcon(count)}<span class="sp-head-label">${
        needs === undefined ? String(count) : `Lv ${String(needs)}`
      }</span>`;
      item.addEventListener('click', () => {
        if (needs !== undefined) {
          const skill = this.#deps.game.data.skills.find((entry) => entry.id === this.#skill);
          this.#flash(
            `${String(count)}-way opens at ${skill?.name ?? this.#skill} ${String(needs)}`,
            'warn',
          );
          return;
        }
        if (this.#round?.phase.kind !== 'plan' || this.#round.count === count) return;
        this.#round.choose(count);
        this.#lastHead = count;
        this.#play('chop-1', 0.3, 700 - count * 20);
        this.#deps.haptics.pulse(6);
      });
      return item;
    });
    this.#ui.heads.replaceChildren(...buttons);
  }

  #updateUi(): void {
    const ui = this.#ui;
    const round = this.#round;
    const phase = round?.phase.kind ?? 'none';
    if (phase !== this.#lastPhase) {
      this.#lastPhase = phase;
      // Lets the e2e test follow along.
      document.body.dataset.splitting = phase;
    }
    if (!round) {
      ui.controls.hidden = ui.heads.hidden = ui.sum.hidden = ui.stars.hidden = true;
      ui.turn.hidden = true;
      ui.hint.textContent = '';
      return;
    }
    const kind = round.phase.kind;
    const planning = kind === 'plan';
    ui.controls.hidden = ui.heads.hidden = ui.turn.hidden = !planning;
    ui.sum.hidden = kind === 'done';
    ui.stars.hidden = kind === 'done';
    const plan = round.plan;
    this.#showPlan(plan);
    const practice = this.#log?.id === this.#deps.game.data.splitting.tutorialLog.id;
    const hints: Record<string, string> = {
      plan: practice
        ? 'Drag the log to turn the cuts: run one through the rot, keep the silver whole'
        : 'Drag the log to turn the cuts · pick a head · then Strike',
      swing: '',
      pump: 'Swipe down to pump the handle',
      done: '',
    };
    ui.hint.textContent = hints[kind] ?? '';
    const phaseNow = round.phase;
    const pump = phaseNow.kind === 'pump' ? phaseNow.pump : undefined;
    const degrees = Math.round(round.rotation / DEG);
    if (planning) this.#showTurn(degrees, plan);
    this.#element.dataset.head = String(round.count);
    this.#element.dataset.turn = String(degrees);
    this.#element.dataset.worth = String(plan.worth);
    this.#element.dataset.progress = pump ? pump.progress.toFixed(2) : '';
  }

  /**
   * The degrees readout and a soft click for each step the cuts turn, and a buzz only when the
   * turn changes what's cut: a line starting or stopping cutting a grain (not every step, and
   * not when picking another head).
   */
  #showTurn(degrees: number, plan: Plan): void {
    const feel = this.#deps.feel.values;
    const cut = `${String(plan.count)}|${plan.cut.join(',')}`;
    const turned = this.#shownTurn !== undefined && degrees !== this.#shownTurn;
    const sameHead = this.#shownCut?.startsWith(`${String(plan.count)}|`) === true;
    if (turned && sameHead && cut !== this.#shownCut) this.#deps.haptics.pulse(feel.buzzCutMs);
    this.#shownCut = cut;
    if (degrees === this.#shownTurn) return;
    const first = this.#shownTurn === undefined;
    this.#shownTurn = degrees;
    this.#ui.turn.textContent = `${String(degrees)}°`;
    const now = performance.now();
    if (first || now - this.#tickedAt < feel.tickGapMs) return;
    this.#tickedAt = now;
    this.#play('chop-1', 0.06, 1500);
  }

  /**
   * The plan, redrawn when it changes: grains the cuts run through glow on the log, the sum
   * shows staves × each grain (cut ones struck through) = the total, the stars light up for
   * what it would earn, and the picker marks the head chosen.
   */
  #showPlan(plan: Plan): void {
    const round = this.#round;
    const log = this.#log;
    if (!round || !log) return;
    const key = `${String(plan.count)}|${plan.cut.join(',')}|${String(plan.staves)}|${String(
      plan.worth,
    )}|${round.phase.kind === 'plan' ? 'plan' : 'go'}`;
    if (key === this.#planKey) return;
    const worthBefore = Number(this.#planKey.split('|')[3] ?? -1);
    this.#planKey = key;
    const ui = this.#ui;
    if (round.phase.kind === 'plan') this.#drawFace(log, plan.cut, []);
    for (const item of ui.heads.querySelectorAll<HTMLElement>('.sp-head')) {
      const on = item.dataset.count === String(plan.count);
      if (on && !item.classList.contains('sp-head-on')) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
      item.classList.toggle('sp-head-on', on);
      item.setAttribute('aria-checked', String(on));
    }
    // The sum: kept grains multiply; cut ones are struck through (green for rot, red for good).
    const kinds = this.#deps.game.data.splitting.grainKinds;
    const parts: HTMLElement[] = [];
    const span = (className: string, text: string) => {
      const part = document.createElement('span');
      part.className = className;
      part.textContent = text;
      return part;
    };
    parts.push(span('sp-sum-staves', `${String(plan.staves)} staves`));
    const kept = plan.kept.map((entry) => entry.grain);
    log.grains.forEach((grain, index) => {
      const kind = kinds.find((entry) => entry.id === grain.kind);
      if (!kind) return;
      const isCut = plan.cut.includes(index);
      if (!isCut && !kept.includes(index)) return;
      const tone = isCut ? (kind.multiplier < 1 ? ' sp-sum-cut-good' : ' sp-sum-cut-bad') : '';
      parts.push(span(`sp-sum-factor sp-sum-${grain.kind}${tone}`, `×${times(kind.multiplier)}`));
    });
    parts.push(span('sp-sum-equals', '='));
    const total = span('sp-sum-total', String(plan.worth));
    if (worthBefore >= 0 && plan.worth !== worthBefore) {
      total.classList.add(plan.worth > worthBefore ? 'sp-sum-up' : 'sp-sum-down');
    }
    parts.push(total);
    const product = kept.reduce(
      (value, index) =>
        value * (kinds.find((entry) => entry.id === log.grains[index]?.kind)?.multiplier ?? 1),
      1,
    );
    if (product > plan.multiplier) parts.push(span('sp-sum-cap', `cap ×${times(plan.multiplier)}`));
    ui.sum.replaceChildren(...parts);
    // Stars for this plan.
    const stars = starsFor(this.#deps.game.data.splitting, plan.worth, round.best.worth);
    ui.starIcons.forEach((icon, index) => {
      const on = index < stars;
      icon.classList.toggle('sp-star-on', on);
      if (on && index >= this.#starsShown) {
        icon.classList.remove('sp-star-pop');
        // Reading the layout restarts the pop.
        icon.getBoundingClientRect();
        icon.classList.add('sp-star-pop');
      }
    });
    if (stars > this.#starsShown && round.phase.kind === 'plan') {
      this.#sfx.play('star', 0.3, 200 + stars * 200);
    }
    this.#starsShown = stars;
    const targets = round.starTargets;
    const next = targets.find((target) => target > plan.worth);
    ui.starText.textContent =
      next === undefined
        ? `${String(plan.worth)} · the best split!`
        : `${String(plan.worth)} · next ★ at ${String(next)}`;
  }

  /**
   * The end card: the stars, what went into the warchest, the sum, any bonus, and the best this
   * log could have made.
   */
  #showCard(event: Extract<SplittingEvent, { type: 'done' }>): void {
    const log = this.#log;
    if (!log) return;
    const ui = this.#ui;
    const { plan, best, stars, bonus, banked } = event;
    const kinds = this.#deps.game.data.splitting.grainKinds;
    ui.cardStars.replaceChildren(
      ...[0, 1, 2].map((index) => {
        const star = document.createElement('span');
        star.className = `w3d-star ${index < stars ? 'w3d-star-on' : 'w3d-star-off'}`;
        star.textContent = '★';
        star.style.animationDelay = `${String(index * 0.18)}s`;
        return star;
      }),
    );
    window.setTimeout(() => {
      for (let index = 0; index < stars; index++) {
        window.setTimeout(() => {
          this.#sfx.play('star', 0.6, index * 250);
        }, index * 180);
      }
    }, 50);
    const factors = plan.kept.flatMap((entry) => {
      const kind = kinds.find((value) => value.id === log.grains[entry.grain]?.kind);
      return kind ? [`×${times(kind.multiplier)}`] : [];
    });
    const sum = [`${String(plan.staves)} stave${plan.staves === 1 ? '' : 's'}`, ...factors].join(
      ' ',
    );
    const lines = [`${sum} = ${String(plan.worth)}`];
    if (bonus > 0) lines.push(`${'★'.repeat(stars)} bonus +${String(bonus)}`);
    lines.push(
      plan.worth >= best.worth
        ? 'The best split there was!'
        : `Best: ${String(best.worth)} with the ${String(best.count)}-way`,
    );
    ui.cardTitle.textContent = `${String(banked)} stave${banked === 1 ? '' : 's'}`;
    ui.cardText.textContent = lines.join('\n');
    ui.next.hidden = false;
    ui.card.hidden = false;
  }

  #showNoLogs(): void {
    const ui = this.#ui;
    ui.cardStars.replaceChildren();
    ui.cardTitle.textContent = 'No logs';
    ui.cardText.textContent = 'The warchest has no logs to split. Fell some at the tree line.';
    ui.next.hidden = true;
    ui.card.hidden = false;
    ui.logName.textContent = '';
  }

  #flash(message: string, tone: 'good' | 'bad' | 'warn'): void {
    const flash = document.createElement('div');
    flash.className = `sp-flash sp-${tone}`;
    flash.textContent = message;
    this.#ui.flashes.append(flash);
    window.setTimeout(() => {
      flash.remove();
    }, 1100);
  }
}

/** A head's icon: a log end split `count` ways, as an inline SVG. */
function headIcon(count: number): string {
  const lines = Array.from({ length: count }, (_, index) => {
    const angle = (index * TAU) / count - Math.PI / 2;
    const x = (20 + Math.cos(angle) * 17).toFixed(2);
    const y = (20 + Math.sin(angle) * 17).toFixed(2);
    return `<line x1="20" y1="20" x2="${x}" y2="${y}"/>`;
  }).join('');
  return `<svg class="sp-head-icon" viewBox="0 0 40 40" aria-hidden="true"><circle class="sp-head-bark" cx="20" cy="20" r="18"/><circle class="sp-head-wood" cx="20" cy="20" r="15.5"/><circle class="sp-head-ring" cx="20" cy="20" r="10"/><g class="sp-head-cuts">${lines}</g><circle class="sp-head-hub" cx="20" cy="20" r="3"/></svg>`;
}

/** A multiplier or bonus for show: ½ for a half, whole numbers as they are. */
function times(value: number): string {
  const whole = Math.floor(value + 1e-9);
  const part = value - whole;
  if (part < 1e-6) return String(whole);
  const eighths: Record<number, string> = {
    1: '⅛',
    2: '¼',
    3: '⅜',
    4: '½',
    5: '⅝',
    6: '¾',
    7: '⅞',
  };
  const fraction = eighths[Math.round(part * 8)];
  if (!fraction || Math.abs(part * 8 - Math.round(part * 8)) > 1e-6) return value.toFixed(2);
  return whole > 0 ? `${String(whole)}${fraction}` : fraction;
}

interface StaveSize {
  width: number;
  thickness: number;
  length: number;
}

/**
 * The size of each of `shown` staves split from `log`: as long as the log is tall, and between
 * them as much wood across as the log's end, so the heap is the log it came from (a log worth 60
 * makes 60 slim staves, one worth 10 makes 10 big wedges); never more than `STAVE_MOST` of the
 * log each, nor thinner than `STAVE_MIN_WIDTH`.
 */
function staveSize(log: SplittingLog, shown: number): StaveSize {
  const area = Math.PI * log.radius * log.radius * Math.min(1 / Math.max(shown, 1), STAVE_MOST);
  // A wedge's end is its width × thickness, narrowed to the pith on one side.
  const width = Math.max(Math.sqrt(area / (((1 + STAVE_PITH) / 2) * STAVE_DEPTH)), STAVE_MIN_WIDTH);
  return { width, thickness: width * STAVE_DEPTH, length: log.height };
}

/**
 * A stave's shape: a box narrowed to its pith side (−y), bark on its +y side, the grain running
 * its length.
 */
function staveGeometry({ width, thickness, length }: StaveSize): THREE.BufferGeometry {
  const stave = new THREE.BoxGeometry(width, thickness, length);
  const position = stave.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    if (position.getY(index) < 0) position.setX(index, position.getX(index) * STAVE_PITH);
  }
  stave.computeVertexNormals();
  // A box's sides map their long edge across u (the ±x sides) or up v (the ±y sides): turn the
  // ±x sides' UVs so the grain runs the stave's length on all four, and size the bark (+y, the
  // 8th to 11th vertices) in world units as it is on the log.
  const uv = stave.getAttribute('uv');
  for (let index = 0; index < 8; index++) uv.setXY(index, uv.getY(index), uv.getX(index));
  for (let index = 8; index < 12; index++) {
    uv.setXY(index, (uv.getX(index) * width) / BARK_TILE, (uv.getY(index) * length) / BARK_TILE);
  }
  return stave;
}

/**
 * Where `count` staves lie in the heap, bottom layer first: a woodpile in front of the block,
 * staves lying across, a row fewer each layer up and each layer in the gaps of the one under it;
 * past `HEAP_ONE_BAY` staves, two bays side by side. Each strays a little from its place.
 */
function heapPlaces(count: number, size: StaveSize): { at: THREE.Vector3; turn: THREE.Euler }[] {
  const bays = count > HEAP_ONE_BAY ? 2 : 1;
  let rows = 1;
  while ((bays * rows * (rows + 1)) / 2 < count) rows++;
  const pitch = size.width + HEAP_GAP;
  const middle = BLOCK_SPREAD * 1.12 + HEAP_CLEARANCE + (rows * pitch) / 2;
  const places: { at: THREE.Vector3; turn: THREE.Euler }[] = [];
  const stray = (size: number) => (Math.random() - 0.5) * 2 * size;
  // How far a stave rolls to lie on one of its split faces (they slope in to the pith side).
  const onSide = Math.PI / 2 - Math.atan((size.width * (1 - STAVE_PITH)) / 2 / size.thickness);
  for (let layer = 0; layer < rows; layer++) {
    const across = rows - layer;
    for (let row = 0; row < across; row++) {
      for (let bay = 0; bay < bays; bay++) {
        if (places.length >= count) return places;
        places.push({
          at: new THREE.Vector3(
            (bay - (bays - 1) / 2) * (size.length + 0.1) + stray(HEAP_STRAY.across),
            size.thickness / 2 + layer * size.thickness * 0.85,
            middle + (row - (across - 1) / 2) * pitch + stray(HEAP_STRAY.along),
          ),
          // Lying across (its length along x), on a split face or bark up, a little askew.
          turn: new THREE.Euler(
            0,
            Math.PI / 2 + stray(HEAP_STRAY.yaw),
            (Math.random() < HEAP_BARK_UP ? 0 : Math.sign(stray(1)) * onSide) +
              stray(HEAP_STRAY.roll),
          ),
        });
      }
    }
  }
  return places;
}
