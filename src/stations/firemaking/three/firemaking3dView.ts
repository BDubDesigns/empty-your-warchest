import * as THREE from 'three';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import type { ScreenView } from '../../../app/screen';
import { Sfx, type SoundLoop } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import { barkTextures, barkUvs, drawSplitGrain } from '../../../app/woodGrain';
import type { EventLogger, Game, LiveTuning } from '../../../core';
import type { FiremakingFeel } from '../../../data';
import { generateFire, stavesOver, type Finish } from '../logic/fire';
import { FiremakingRound, nextLayers, type FiremakingEvent, type RackResult } from '../logic/round';

export interface Firemaking3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<FiremakingFeel>;
  haptics: Haptics;
  /** Leaves the station (the end card's Back to camp). */
  onLeave: () => void;
}

const DEG = Math.PI / 180;
/** Gap between staves along the rack, and a stave's length (it lies front to back) and size. */
const STAVE_GAP = 0.28;
const STAVE_LENGTH = 1.05;
const STAVE_WIDTH = 0.07;
const STAVE_DEPTH = 0.06;
/** The point at a stave's back end. */
const TIP_LENGTH = 0.16;
/** How high the rack's staves sit over the coals, and the next layer up when stacked. */
const RACK_Y = 0.5;
const LAYER_GAP = 0.075;
/** The trench: how far it reaches past the rack each side, and front to back. */
const TRENCH_MARGIN = 0.22;
const TRENCH_DEPTH_Z = 1.3;
/** Where the rack sits: over the fire, and slid out toward you on its rails. */
const RACK_IN_Z = 0;
const RACK_OUT_Z = 1.6;
/** The handle sticks out this far in front of the rack. */
const HANDLE_REACH = 0.36;
/** A log in a fuel spot: its radius. */
const LOG_RADIUS = 0.065;
/** Coal lumps scattered over the trench floor. */
const COALS = 420;
/** The water bucket, in front of the rails where the rack comes out: where it stands, its size. */
const BUCKET_Z = 3.05;
const BUCKET_RADIUS = 0.3;
const BUCKET_HEIGHT = 0.46;
/** The camera: how far it looks down, how far back it sits, and where it looks. */
const CAMERA_ELEVATION = 56 * DEG;
/**
 * The camera's two views: planning (the trench, the rack waiting out front and the bucket, drawn
 * `lift` of the screen higher, clear of the controls) and cooking (in close on the rack and its
 * smoke). It eases between them.
 */
const VIEWS = {
  plan: { target: new THREE.Vector3(0, 0.2, 1.25), distance: 6.6, lift: 0.13 },
  cook: { target: new THREE.Vector3(0, 0.35, 0.3), distance: 4.6, lift: -0.02 },
};
/** Particles alive at once, at most. */
const MAX_PARTICLES = 420;
const SOUNDS: Record<string, string> = {
  'fire-loop': 'audio/firemaking/fire-loop.mp3',
  'fire-crackle': 'audio/firemaking/fire-crackle.mp3',
  'steam-1': 'audio/firemaking/steam-1.mp3',
  'steam-2': 'audio/firemaking/steam-2.mp3',
  'land-1': 'audio/woodcutting/land-1.mp3',
  'land-2': 'audio/woodcutting/land-2.mp3',
  'chop-2': 'audio/woodcutting/chop-2.mp3',
  'press-clunk': 'audio/splitting/press-clunk.mp3',
  'press-click': 'audio/splitting/press-click.mp3',
  star: 'audio/woodcutting/star.mp3',
};
const COLORS = {
  sky: 0xb4cfa8,
  pit: 0x1c130d,
  stone: 0x8a8680,
  iron: 0x3b3f42,
  grip: 0x2a1a10,
  bucket: 0x7a5434,
  band: 0x2f3336,
  water: 0x3f5f6e,
  /** Coals: cold, hot and white-hot. */
  coalCold: new THREE.Color(0x2a0d05),
  coalHot: new THREE.Color(0xff5a14),
  coalWhite: new THREE.Color(0xffd890),
  /** A stave as it cooks: raw wood, toasted when hardened, black when charred. */
  raw: new THREE.Color(0xffffff),
  toasted: new THREE.Color(0xc0844e),
  done: new THREE.Color(0x744420),
  charred: new THREE.Color(0x1d1712),
};

/**
 * Smoke off a stave's point as it cooks, by stage: none, thin white wisps, thicker, thick grey
 * (pull now), and black (burning). How many puffs a second, how big, what colour and how thick.
 * Puffs are short-lived, so the plume changes the moment the stave does.
 */
const SMOKE = [
  { rate: 0, size: 0, color: 0xffffff, opacity: 0 },
  { rate: 4, size: 0.09, color: 0xf6f6f2, opacity: 0.3 },
  { rate: 9, size: 0.14, color: 0xe6e6e0, opacity: 0.45 },
  { rate: 22, size: 0.24, color: 0x7d7d79, opacity: 0.75 },
  { rate: 24, size: 0.26, color: 0x141210, opacity: 0.9 },
] as const;
/** The burst of thick grey off a point the moment it hardens. */
const READY_PUFFS = 7;

type ParticleKind = 'flame' | 'ember' | 'smoke' | 'steam' | 'ash';

interface Particle {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  kind: ParticleKind;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  opacity: number;
}

/** A stave on the rack, and where it's going once the rack is off the fire. */
interface StaveVisual {
  mesh: THREE.Group;
  material: THREE.MeshLambertMaterial;
  /** The point: glows as it chars. */
  tipMaterial: THREE.MeshLambertMaterial;
  column: number;
  layer: number;
  finish: Finish | undefined;
  /** After the pull: flying to the bucket (hardened), crumbling (charred) or fading (underdone). */
  move:
    | {
        from: THREE.Vector3;
        to: THREE.Vector3;
        fromTurn: THREE.Euler;
        toTurn: THREE.Euler;
        at: number;
        seconds: number;
        hop: number;
      }
    | undefined;
  /** In the bucket, waiting to pour into the chest; gone once it has set off. */
  inBucket: boolean;
  left: boolean;
}

/**
 * Fire-hardening in 3D: a trench of coals with a rack of staves on rails over it, seen from the
 * front. While planning, the rack waits slid out toward you: tap a fuel spot (in the scene or
 * the buttons under the heat curve) to drop logs in and even out the heat, then Lay the rack and
 * it slides in over the fire. Smoke rises off each stave as it cooks, thin white to thick grey
 * (pull now) to black (burning); grab the handle and drag it toward you to pull the rack out.
 * Spears plunge into the water bucket, hissing, and pour into the chest. The rules
 * (FiremakingRound) decide everything; this draws them and feeds them touches.
 */
export class Firemaking3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Firemaking3DDeps;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  readonly #timer = new THREE.Timer();
  readonly #raycaster = new THREE.Raycaster();
  readonly #sfx = new Sfx();
  readonly #fireSound: SoundLoop;
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  #ui!: ReturnType<Firemaking3DView['buildUi']>;
  #round: FiremakingRound | undefined;
  /** How deep the next rack stacks (the hot streak). */
  #layers = 1;
  /** The rack (frame and staves) that slides along the rails, and where it's sliding. */
  readonly #rack = new THREE.Group();
  #rackSlide = { from: RACK_OUT_Z, to: RACK_OUT_Z, at: 0, seconds: 0.01 };
  #staves: StaveVisual[] = [];
  #staveGeometry!: THREE.BufferGeometry;
  #tipGeometry!: THREE.BufferGeometry;
  #grain!: THREE.Texture;
  #handle!: THREE.Object3D;
  #coals!: THREE.InstancedMesh;
  #coalPhase: number[] = [];
  #coalX: number[] = [];
  /** How much each lump glows at full heat: some burn bright, most smoulder. */
  #coalGlow: number[] = [];
  #lights: THREE.PointLight[] = [];
  /** Logs in each fuel spot, as drawn. */
  #logMeshes: THREE.Mesh[][] = [];
  #logGeometry!: THREE.CylinderGeometry;
  #logMaterial!: THREE.MeshStandardMaterial;
  #bucketTop = new THREE.Vector3();
  #particles: Particle[] = [];
  #puffTexture!: THREE.Texture;
  /** Smoke owed per column, building up between frames. */
  #smokeDue: number[] = [];
  /** Hot logs flare for a moment when they drop in or the rack goes on. */
  #flare = 0;
  #pointer: { id: number; startX: number; startY: number; grabbed: boolean } | undefined;
  #shake = 0;
  #frozenUntil = 0;
  #bankedXp: XpDeposit | undefined;
  #deposit: ReturnType<WarchestHud['hold']> | undefined;
  /** The finished rack, waiting for the plunge to finish before the card and the pour. */
  #finished: { result: RackResult; at: number } | undefined;
  #lastPhase = '';
  /** Where the camera is between its views. */
  #view = {
    target: VIEWS.plan.target.clone(),
    distance: VIEWS.plan.distance,
    lift: VIEWS.plan.lift,
  };
  #shownStage: number[] = [];
  #previewKey = '';

  private constructor(element: HTMLElement, deps: Firemaking3DDeps, hud: WarchestHud) {
    this.#element = element;
    this.#deps = deps;
    this.#hud = hud;
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'firemaking');
    this.#skill = station?.skill ?? 'firemaking';
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.domElement.className = 'fm-canvas';
    element.append(this.#renderer.domElement);
    this.#buildWorld();
    this.#ui = this.buildUi();
    this.#sfx.load(SOUNDS);
    this.#fireSound = this.#sfx.loop('fire-loop');
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Firemaking3DDeps): Promise<Firemaking3DView> {
    const rules = deps.game.data.firemaking;
    const recipe = deps.game.data.recipes.find((entry) => entry.id === rules.recipe);
    const item = recipe?.outputs[0]?.item;
    if (!item) throw new Error('The hardening recipe makes nothing');
    const hud = await WarchestHud.create(element, { game: deps.game, item, haptics: deps.haptics });
    return new Firemaking3DView(element, deps, hud);
  }

  // ScreenView

  start(): void {
    this.#resize();
    this.#startRack();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#round?.exit();
    this.#round = undefined;
    this.#fireSound.setVolume(0);
    this.#hud.settle();
    this.#skillBar.settle();
    this.#bankedXp = undefined;
    this.#deposit = undefined;
    this.#finished = undefined;
    this.#layers = 1;
    delete document.body.dataset.firemaking;
    this.#lastPhase = '';
  }

  // Racks

  /** A new rack and a fresh fire, if there are staves in the warchest to harden. */
  #startRack(): void {
    const { game } = this.#deps;
    const rules = game.data.firemaking;
    const recipe = game.data.recipes.find((entry) => entry.id === rules.recipe);
    const input = recipe?.inputs[0];
    this.#ui.card.hidden = true;
    this.#finished = undefined;
    this.#clearParticles('smoke');
    const have = input ? game.inventory.count(input.item) : 0;
    if (have < 1) {
      this.#round = undefined;
      this.#placeStaves(0);
      this.#showNoStaves();
      return;
    }
    const seed = Date.now() >>> 0;
    const feel = this.#deps.feel.values;
    const fire = generateFire(rules, feel, seed);
    const staves = Math.min(rules.rack.staves * this.#layers, have);
    this.#round = new FiremakingRound(
      fire,
      {
        logger: this.#deps.logger,
        feel: () => this.#deps.feel.values,
        rules,
        logsAvailable: game.inventory.count(rules.fuel),
        burn: (logs) => {
          game.removeItems(rules.fuel, logs);
        },
        bank: (hardened, charred) => {
          const before = game.xp(this.#skill);
          let banked = 0;
          if (hardened > 0) {
            const result = game.craft(rules.recipe, { batches: hardened });
            banked = result.produced.reduce((sum, stack) => sum + stack.count, 0);
          }
          if (charred > 0 && input) game.removeItems(input.item, charred);
          this.#bankedXp = this.#skillBar.hold(game.xp(this.#skill) - before);
          return banked;
        },
        onEvent: (event) => {
          this.#onEvent(event);
        },
      },
      staves,
      Math.ceil(staves / rules.rack.staves),
    );
    this.#placeStaves(staves);
    this.#slideRack(RACK_OUT_Z, 0.01);
    this.#shownStage = [];
    this.#smokeDue = new Array<number>(rules.rack.staves).fill(0);
    this.#previewKey = '';
    this.#showLogs();
    this.#ui.streak.hidden = this.#layers <= 1;
    this.#ui.streak.textContent = `🔥 Hot streak: ${String(this.#layers)} deep`;
  }

  // World

  #buildWorld(): void {
    const rules = this.#deps.game.data.firemaking;
    const columns = rules.rack.staves;
    const span = (columns - 1) * STAVE_GAP;
    const trenchWidth = span + STAVE_GAP + TRENCH_MARGIN * 2;
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.25));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sun.position.set(3, 8, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.#scene.add(sun);
    // The fire pit's yard: grass, trodden bare round the trench.
    this.#scene.add(groundMesh('meadowGrass', 40, 40));
    const { yard } = rules;
    const bare = wornGround('troddenDirt', yard.radius * 2, yard.radius * 2, {
      cover: yard.wear,
      round: true,
      seed: 9,
    });
    bare.position.z = 0.6;
    this.#scene.add(bare);
    // The trench: a dark pit ringed with stones, its floor ash and embers under the coals.
    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(trenchWidth, 0.04, TRENCH_DEPTH_Z),
      new THREE.MeshLambertMaterial({ color: COLORS.pit, emissive: 0x3a0e04 }),
    );
    pit.position.y = 0.01;
    pit.receiveShadow = true;
    this.#scene.add(pit);
    this.#scene.add(this.#buildRim(trenchWidth));
    this.#buildCoals(trenchWidth);
    // A glow over each fuel spot, brighter the hotter it burns.
    for (let spot = 0; spot < rules.rack.spots; spot++) {
      const light = new THREE.PointLight(0xff7a2a, 0, 2.6, 1.6);
      light.position.set(this.#spotX(spot), 0.35, 0);
      this.#lights.push(light);
      this.#scene.add(light);
    }
    // Fuel logs: drawn in when dropped into a spot.
    this.#logGeometry = new THREE.CylinderGeometry(LOG_RADIUS, LOG_RADIUS, 1, 10, 1);
    barkUvs(this.#logGeometry, LOG_RADIUS, 1, 0, Math.PI * 2);
    this.#logGeometry.rotateZ(Math.PI / 2);
    const { map, normalMap } = barkTextures();
    this.#logMaterial = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      color: 0xd8c0a0,
      roughness: 0.95,
      emissive: 0xff4a10,
      emissiveIntensity: 0,
    });
    this.#logMeshes = Array.from({ length: rules.rack.spots }, () => []);
    this.#scene.add(this.#buildRails(span));
    this.#buildRack(span);
    this.#scene.add(this.#rack);
    this.#scene.add(this.#buildBucket());
    // Smoke, steam and flames: soft round puffs.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    this.#puffTexture = new THREE.CanvasTexture(canvas);
  }

  /** Stones round the trench's edge. */
  #buildRim(trenchWidth: number): THREE.InstancedMesh {
    const stones: THREE.Matrix4[] = [];
    const place = (x: number, z: number, size: number, turn: number) => {
      stones.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, size * 0.35, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(turn, turn * 1.7, turn * 0.6)),
          new THREE.Vector3(size, size * 0.7, size),
        ),
      );
    };
    const halfX = trenchWidth / 2 + 0.08;
    const halfZ = TRENCH_DEPTH_Z / 2 + 0.08;
    let seed = 1;
    const jitter = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let x = -halfX; x <= halfX + 1e-6; x += 0.22) {
      place(x, -halfZ, 0.13 + jitter() * 0.06, jitter() * 3);
      place(x, halfZ, 0.13 + jitter() * 0.06, jitter() * 3);
    }
    for (let z = -halfZ + 0.22; z < halfZ - 0.1; z += 0.22) {
      place(-halfX, z, 0.13 + jitter() * 0.06, jitter() * 3);
      place(halfX, z, 0.13 + jitter() * 0.06, jitter() * 3);
    }
    const mesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: COLORS.stone, flatShading: true }),
      stones.length,
    );
    stones.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new THREE.Color(COLORS.stone).multiplyScalar(0.75 + jitter() * 0.4));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  /** Coal lumps over the trench floor, lit by the heat above them. */
  #buildCoals(trenchWidth: number): void {
    this.#coals = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      COALS,
    );
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < COALS; index++) {
      const x = (Math.random() - 0.5) * (trenchWidth - 0.1);
      const z = (Math.random() - 0.5) * (TRENCH_DEPTH_Z - 0.12);
      const size = 0.022 + Math.random() * 0.03;
      matrix.compose(
        new THREE.Vector3(x, 0.035 + Math.random() * 0.03, z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        ),
        new THREE.Vector3(size, size * 0.8, size),
      );
      this.#coals.setMatrixAt(index, matrix);
      this.#coals.setColorAt(index, COLORS.coalCold);
      this.#coalX.push(x);
      this.#coalGlow.push(
        Math.random() < 0.3 ? 0.9 + Math.random() * 0.3 : 0.3 + Math.random() * 0.5,
      );
      this.#coalPhase.push(Math.random() * Math.PI * 2);
    }
    this.#scene.add(this.#coals);
  }

  /** The iron rails the rack slides along: over the trench and out toward you. */
  #buildRails(span: number): THREE.Group {
    const rails = new THREE.Group();
    const iron = new THREE.MeshLambertMaterial({ color: COLORS.iron });
    const back = -TRENCH_DEPTH_Z / 2 - 0.1;
    const front = RACK_OUT_Z + STAVE_LENGTH / 2 + 0.15;
    for (const side of [-1, 1]) {
      const x = side * (span / 2 + STAVE_GAP / 2 + 0.12);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, front - back), iron);
      rail.position.set(x, RACK_Y - 0.075, (front + back) / 2);
      rail.castShadow = true;
      rails.add(rail);
      for (const z of [back + 0.05, (front + back) / 2 + 0.4, front - 0.05]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, RACK_Y - 0.075), iron);
        post.position.set(x, (RACK_Y - 0.075) / 2, z);
        post.castShadow = true;
        rails.add(post);
      }
    }
    return rails;
  }

  /** The rack: a frame with a handle at the front; the staves go on it each rack. */
  #buildRack(span: number): void {
    const iron = new THREE.MeshLambertMaterial({ color: COLORS.iron });
    const width = span + STAVE_GAP + 0.24;
    for (const z of [-STAVE_LENGTH / 2 + 0.12, STAVE_LENGTH / 2 - 0.12]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, 0.035), iron);
      bar.position.set(0, RACK_Y - 0.05, z);
      bar.castShadow = true;
      this.#rack.add(bar);
    }
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, STAVE_LENGTH - 0.2), iron);
      bar.position.set((side * width) / 2, RACK_Y - 0.05, 0);
      this.#rack.add(bar);
    }
    // The handle: an iron bar out the front with a wrapped grip across its end.
    const front = STAVE_LENGTH / 2 - 0.12;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, HANDLE_REACH), iron);
    shaft.position.set(0, RACK_Y - 0.05, front + HANDLE_REACH / 2);
    this.#rack.add(shaft);
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.34, 10),
      new THREE.MeshLambertMaterial({ color: COLORS.grip }),
    );
    grip.rotation.z = Math.PI / 2;
    grip.position.set(0, RACK_Y - 0.05, front + HANDLE_REACH);
    grip.castShadow = true;
    this.#rack.add(grip);
    this.#handle = grip;
    // A stave: a split, squared length with a point at the back, the grain running along it.
    this.#staveGeometry = new THREE.BoxGeometry(
      STAVE_WIDTH,
      STAVE_DEPTH,
      STAVE_LENGTH - TIP_LENGTH,
    );
    const uv = this.#staveGeometry.getAttribute('uv');
    for (let index = 0; index < 8; index++) uv.setXY(index, uv.getY(index), uv.getX(index));
    this.#staveGeometry.translate(0, 0, TIP_LENGTH / 2);
    this.#tipGeometry = new THREE.ConeGeometry(STAVE_WIDTH * 0.62, TIP_LENGTH, 4);
    this.#tipGeometry.rotateX(-Math.PI / 2);
    this.#tipGeometry.rotateZ(Math.PI / 4);
    this.#tipGeometry.translate(0, 0, -STAVE_LENGTH / 2 + TIP_LENGTH / 2);
    const grain = new THREE.CanvasTexture(drawSplitGrain(64, 256, 5, 3));
    grain.colorSpace = THREE.SRGBColorSpace;
    this.#grain = grain;
  }

  /** The water bucket the spears plunge into: wooden, iron-banded, full to near the top. */
  #buildBucket(): THREE.Group {
    const bucket = new THREE.Group();
    const wood = new THREE.Mesh(
      new THREE.CylinderGeometry(BUCKET_RADIUS, BUCKET_RADIUS * 0.85, BUCKET_HEIGHT, 18, 1, true),
      new THREE.MeshLambertMaterial({ color: COLORS.bucket, side: THREE.DoubleSide }),
    );
    wood.position.y = BUCKET_HEIGHT / 2;
    wood.castShadow = true;
    bucket.add(wood);
    for (const y of [0.1, BUCKET_HEIGHT - 0.08]) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(BUCKET_RADIUS * (y > 0.2 ? 0.99 : 0.89), 0.014, 6, 24),
        new THREE.MeshLambertMaterial({ color: COLORS.band }),
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      bucket.add(band);
    }
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(BUCKET_RADIUS * 0.97, 24),
      new THREE.MeshLambertMaterial({ color: COLORS.water }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = BUCKET_HEIGHT - 0.07;
    bucket.add(water);
    bucket.position.set(0, 0, BUCKET_Z);
    this.#bucketTop.set(0, BUCKET_HEIGHT - 0.07, BUCKET_Z);
    return bucket;
  }

  /** The x of fuel spot `spot`'s middle (under its staves). */
  #spotX(spot: number): number {
    const staves = stavesOver(this.#deps.game.data.firemaking, spot);
    const middle = staves.reduce((sum, column) => sum + this.#columnX(column), 0) / staves.length;
    return middle;
  }

  #columnX(column: number): number {
    const columns = this.#deps.game.data.firemaking.rack.staves;
    return (column - (columns - 1) / 2) * STAVE_GAP;
  }

  /** Puts `count` staves on the rack: full layers across, stacked up. */
  #placeStaves(count: number): void {
    for (const stave of this.#staves) {
      stave.mesh.removeFromParent();
      stave.material.dispose();
      stave.tipMaterial.dispose();
    }
    const columns = this.#deps.game.data.firemaking.rack.staves;
    this.#staves = Array.from({ length: count }, (_, index) => {
      const material = new THREE.MeshLambertMaterial({ map: this.#grain });
      const tipMaterial = new THREE.MeshLambertMaterial({ map: this.#grain, emissive: 0xff3a08 });
      tipMaterial.emissiveIntensity = 0;
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(this.#staveGeometry, material);
      const tip = new THREE.Mesh(this.#tipGeometry, tipMaterial);
      body.castShadow = tip.castShadow = true;
      mesh.add(body, tip);
      const column = index % columns;
      const layer = Math.floor(index / columns);
      // Each layer sits a little across from the one under it, so a stacked rack reads as more.
      const across = layer === 0 ? 0 : (layer % 2 === 1 ? 0.3 : -0.3) * STAVE_GAP;
      mesh.position.set(this.#columnX(column) + across, RACK_Y + layer * LAYER_GAP, 0);
      mesh.rotation.y = (Math.random() - 0.5) * 0.04;
      this.#rack.add(mesh);
      return {
        mesh,
        material,
        tipMaterial,
        column,
        layer,
        finish: undefined,
        move: undefined,
        inBucket: false,
        left: false,
      };
    });
  }

  /** Draws the logs in each spot as the round has them. */
  #showLogs(): void {
    const round = this.#round;
    this.#logMeshes.forEach((meshes, spot) => {
      const want = round?.logs[spot] ?? 0;
      while (meshes.length > want) meshes.pop()?.removeFromParent();
      while (meshes.length < want) {
        const log = new THREE.Mesh(this.#logGeometry, this.#logMaterial);
        const staves = stavesOver(this.#deps.game.data.firemaking, spot).length;
        log.scale.x = staves * STAVE_GAP * 0.9;
        const layer = meshes.length;
        log.position.set(
          this.#spotX(spot) + (Math.random() - 0.5) * 0.04,
          0.06 + LOG_RADIUS + layer * LOG_RADIUS * 1.6,
          (layer === 0 ? -0.08 : 0.09) + (Math.random() - 0.5) * 0.03,
        );
        log.rotation.y = (Math.random() - 0.5) * 0.15;
        log.castShadow = true;
        this.#scene.add(log);
        meshes.push(log);
      }
    });
  }

  #slideRack(to: number, seconds: number): void {
    const now = this.#round?.now ?? 0;
    this.#rackSlide = { from: this.#rack.position.z, to, at: now, seconds };
  }

  // Events

  #onEvent(event: FiremakingEvent): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    if (!round) return;
    if (event.type === 'fuel') {
      this.#showLogs();
      if (event.logs > 0) {
        // A log thumps into the coals and the fire flares up round it.
        this.#play(`land-${String(1 + Math.floor(Math.random() * 2))}`, 0.45, 300);
        this.#play('fire-crackle', 0.35);
        this.#deps.haptics.pulse(feel.buzzLogMs);
        this.#flare = 1;
        const at = new THREE.Vector3(this.#spotX(event.spot), 0.15, 0);
        this.#burst('ember', at, 10);
        this.#burst('flame', at, 8);
      } else {
        this.#play('chop-2', 0.25, -300);
      }
    } else if (event.type === 'lay') {
      this.#slideRack(RACK_IN_Z, 0.5);
      this.#play('press-clunk', 0.35, 400);
      this.#play('fire-crackle', 0.5, -200);
      this.#deps.haptics.pulse(feel.buzzLayMs);
      this.#flare = 1;
    } else {
      this.#pulled(event);
    }
  }

  /**
   * The rack comes off: it slides out toward you, the hardened staves plunge into the bucket with
   * a hiss of steam, charred ones crumble to ash, underdone ones fade back to the warchest.
   */
  #pulled(result: RackResult): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    if (!round) return;
    this.#slideRack(RACK_OUT_Z, feel.pullSeconds);
    this.#play('press-clunk', 0.6, -100);
    this.#play('press-click', 0.4);
    this.#deps.haptics.pulse(feel.buzzPullMs);
    this.#shake = 0.03 * feel.shakeStrength;
    this.#frozenUntil = performance.now() + feel.hitStopMs * 0.5;
    const plungeAt = round.now + feel.pullSeconds;
    let hardened = 0;
    this.#staves.forEach((stave, index) => {
      stave.finish = result.finishes[index];
      if (stave.finish !== 'hardened') return;
      // Into the bucket point first, one after another, standing up in the water.
      const spread = (hardened % 5) - 2;
      const ring = Math.floor(hardened / 5);
      hardened += 1;
      const to = this.#bucketTop
        .clone()
        .add(new THREE.Vector3(spread * 0.07, 0.25, (ring % 2) * 0.08 - 0.04));
      stave.move = {
        from: new THREE.Vector3(),
        to,
        fromTurn: new THREE.Euler(),
        toTurn: new THREE.Euler(-Math.PI / 2 + (Math.random() - 0.5) * 0.25, 0, spread * 0.06),
        at: plungeAt + hardened * 0.05,
        seconds: feel.plungeSeconds * 0.6,
        hop: 0.7,
      };
    });
    const plungeEnd = plungeAt + feel.plungeSeconds + hardened * 0.05;
    this.#finished = { result, at: plungeEnd + feel.pourDelaySeconds };
    // The chest holds the spears back until they pour in from the bucket.
    const xp = this.#bankedXp;
    this.#bankedXp = undefined;
    if (result.banked > 0) {
      this.#deposit = this.#hud.hold(result.banked, (share) => xp?.arrive(share));
    } else {
      xp?.arrive(1);
      this.#deposit = undefined;
    }
  }

  /** The bucket's spears pour into the chest, each leaving the bucket as it sets off. */
  #pourSpears(): void {
    const deposit = this.#deposit;
    this.#deposit = undefined;
    if (!deposit) return;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const inBucket = this.#staves.filter((stave) => stave.inBucket);
    const points: ScreenPoint[] = inBucket.map((stave) => {
      const projected = stave.mesh.getWorldPosition(new THREE.Vector3()).project(this.#camera);
      return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
    });
    if (points.length === 0) {
      const projected = this.#bucketTop.clone().project(this.#camera);
      points.push({ x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height });
    }
    deposit.pour(points, (source) => {
      const stave = inBucket[source];
      if (stave) stave.left = true;
    });
  }

  // Loop

  #loop(time: number): void {
    this.#timer.update(time);
    const realDt = Math.min(this.#timer.getDelta(), 0.05);
    const frozen = performance.now() < this.#frozenUntil;
    const dt = frozen ? 0 : realDt;
    const round = this.#round;
    if (round) round.tick(dt);
    const finished = this.#finished;
    if (finished && round && round.now >= finished.at) {
      this.#finished = undefined;
      this.#showCard(finished.result);
      this.#pourSpears();
    }
    this.#updateRack();
    this.#updateStaves(dt);
    this.#updateFire(dt, time / 1000);
    this.#updateParticles(dt);
    this.#updateUi();
    this.#updateCamera(realDt);
    this.#renderer.render(this.#scene, this.#camera);
  }

  #updateRack(): void {
    const now = this.#round?.now ?? 0;
    const { from, to, at, seconds } = this.#rackSlide;
    const t = Math.min(Math.max((now - at) / seconds, 0), 1);
    this.#rack.position.z = from + (to - from) * (1 - (1 - t) ** 3);
  }

  /** Each stave's colour as it cooks, its smoke, and its trip to the bucket after the pull. */
  #updateStaves(dt: number): void {
    const round = this.#round;
    if (!round) return;
    const feel = round.feel;
    const cooking = round.phase.kind === 'cook';
    const color = new THREE.Color();
    const columns = round.columns;
    if (cooking) {
      for (let column = 0; column < columns; column++) {
        const done = round.doneness(column);
        const stage = this.#stage(done, feel);
        const point = () =>
          new THREE.Vector3(
            this.#columnX(column) + (Math.random() - 0.5) * 0.05,
            RACK_Y + (round.layers - 1) * LAYER_GAP + 0.04,
            this.#rack.position.z - STAVE_LENGTH / 2 + TIP_LENGTH * (0.4 + Math.random()),
          );
        const shown = this.#shownStage[column] ?? 0;
        if (stage !== shown) {
          this.#shownStage[column] = stage;
          // The moment a point hardens it puffs thick grey: seen, not heard or felt, so reading
          // the smoke stays the skill.
          if (stage === 3) {
            for (let puff = 0; puff < READY_PUFFS; puff++) this.#smoke(point(), SMOKE[3]);
          }
          // Starting to char: a crackle and a buzz, so you know you're late (like a glancing
          // chop), without giving away the moment before it.
          if (
            stage === 4 &&
            !this.#shownStage.some((other, index) => other === 4 && index !== column)
          ) {
            this.#play('fire-crackle', 0.5, 240);
            this.#deps.haptics.pulse(feel.buzzCharMs);
          }
        }
        const look = SMOKE[stage] ?? SMOKE[0];
        const due = (this.#smokeDue[column] ?? 0) + look.rate * dt;
        const puffs = Math.floor(due);
        this.#smokeDue[column] = due - puffs;
        for (let puff = 0; puff < puffs; puff++) this.#smoke(point(), look);
        // Burning points throw sparks.
        if (stage === 4 && Math.random() < dt * 6) this.#burst('ember', point(), 1);
      }
    }
    for (const stave of this.#staves) {
      const done = round.phase.kind === 'plan' ? 0 : round.doneness(stave.column);
      stave.material.color.copy(staveColor(done, feel.charRatio, color));
      // The point darkens first and glows once it's burning.
      stave.tipMaterial.color.copy(staveColor(done * 1.06, feel.charRatio, color));
      stave.tipMaterial.emissiveIntensity =
        done >= feel.charRatio ? 0.5 + 0.3 * Math.sin(round.now * 18 + stave.column) : 0;
      const move = stave.move;
      if (move) {
        if (round.now < move.at) continue;
        if (move.from.lengthSq() === 0) {
          // Leaves the rack for the bucket from wherever it is now.
          stave.mesh.getWorldPosition(move.from);
          this.#scene.attach(stave.mesh);
          move.fromTurn.copy(stave.mesh.rotation);
          this.#play(`steam-${String(1 + Math.floor(Math.random() * 2))}`, 0.5, 0);
        }
        const t = Math.min((round.now - move.at) / move.seconds, 1);
        const eased = 1 - (1 - t) ** 2;
        stave.mesh.position.lerpVectors(move.from, move.to, eased);
        stave.mesh.position.y += Math.sin(t * Math.PI) * move.hop;
        stave.mesh.rotation.set(
          move.fromTurn.x + (move.toTurn.x - move.fromTurn.x) * eased,
          move.fromTurn.y + (move.toTurn.y - move.fromTurn.y) * eased,
          move.fromTurn.z + (move.toTurn.z - move.fromTurn.z) * eased,
        );
        if (t >= 1) {
          stave.move = undefined;
          stave.inBucket = true;
          // The plunge: a hiss and a cloud of steam off the water.
          this.#play(`steam-${String(1 + Math.floor(Math.random() * 2))}`, 0.8, -200);
          this.#deps.haptics.pulse(feel.buzzPlungeMs);
          this.#burst('steam', this.#bucketTop.clone().add(new THREE.Vector3(0, 0.05, 0)), 7);
          this.#shake = Math.max(this.#shake, 0.02 * feel.shakeStrength);
        }
      }
      if (stave.inBucket) stave.mesh.visible = !stave.left;
      if (round.phase.kind === 'done' && stave.finish === 'charred' && stave.mesh.visible) {
        // Charred: crumbles to ash where it lies.
        stave.mesh.scale.multiplyScalar(Math.exp(-2.2 * dt));
        if (Math.random() < dt * 14) {
          this.#burst('ash', stave.mesh.getWorldPosition(new THREE.Vector3()), 1);
        }
        if (stave.mesh.scale.x < 0.05) stave.mesh.visible = false;
      }
      if (round.phase.kind === 'done' && stave.finish === 'under' && !this.#finished) {
        // Underdone: back to the warchest as a stave, once the card is up.
        stave.mesh.visible = false;
      }
    }
  }

  /** The smoke stage of a stave this far along: 0 none, 1 wisps, 2 thicker, 3 ready, 4 burning. */
  #stage(done: number, feel: FiremakingFeel): number {
    if (done >= feel.charRatio) return 4;
    if (done >= 1) return 3;
    if (done >= feel.smokeThick) return 2;
    return done >= feel.smokeWisps ? 1 : 0;
  }

  /** The coals glow by the heat over them, flickering; the fuel logs smoulder; flames lick up. */
  #updateFire(dt: number, seconds: number): void {
    const round = this.#round;
    const rules = this.#deps.game.data.firemaking;
    const heats = round?.heats ?? new Array<number>(rules.rack.staves).fill(rules.generator.flat);
    const hottest = rules.generator.flat * 1.5;
    this.#flare = Math.max(this.#flare - dt * 1.6, 0);
    const color = new THREE.Color();
    for (let index = 0; index < COALS; index++) {
      const heat = heatAt(heats, this.#coalX[index] ?? 0, (column) => this.#columnX(column));
      const flicker = 0.82 + 0.18 * Math.sin(seconds * 3.1 + (this.#coalPhase[index] ?? 0) * 7);
      const glow = Math.min(
        (heat / hottest) * flicker * (this.#coalGlow[index] ?? 1) + this.#flare * 0.15,
        1.2,
      );
      if (glow < 0.6) color.copy(COLORS.coalCold).lerp(COLORS.coalHot, glow / 0.6);
      else color.copy(COLORS.coalHot).lerp(COLORS.coalWhite, Math.min((glow - 0.6) / 0.6, 1));
      this.#coals.setColorAt(index, color);
    }
    if (this.#coals.instanceColor) this.#coals.instanceColor.needsUpdate = true;
    this.#lights.forEach((light, spot) => {
      const staves = stavesOver(rules, spot);
      const heat = staves.reduce((sum, column) => sum + (heats[column] ?? 0), 0) / staves.length;
      const flicker = 0.85 + 0.15 * Math.sin(seconds * 5.3 + spot * 2.1);
      light.intensity = (heat / rules.generator.flat) * 1.6 * flicker + this.#flare * 1.5;
    });
    this.#logMaterial.emissiveIntensity = 0.25 + 0.2 * Math.sin(seconds * 4) + this.#flare * 0.6;
    // Flames and embers, more where it's hotter.
    for (let column = 0; column < heats.length; column++) {
      const heat = heats[column] ?? 0;
      const rate = (heat / rules.generator.flat) ** 2 * 2.2 + this.#flare * 6;
      if (Math.random() < rate * dt) {
        const at = new THREE.Vector3(
          this.#columnX(column) + (Math.random() - 0.5) * STAVE_GAP,
          0.08,
          (Math.random() - 0.5) * (TRENCH_DEPTH_Z - 0.3),
        );
        this.#burst(Math.random() < 0.7 ? 'flame' : 'ember', at, 1);
      }
    }
    const phase = round?.phase.kind;
    // The fire roars up as the rack cooks: a build, not a signal at any one moment.
    let cookShare = 0;
    if (round && phase === 'cook') {
      for (let column = 0; column < round.columns; column++) cookShare += round.doneness(column);
      cookShare = Math.min(cookShare / round.columns / round.feel.charRatio, 1);
    }
    this.#fireSound.setVolume(
      phase === 'cook' ? 0.35 + 0.45 * cookShare : phase === 'plan' ? 0.3 : 0.18,
    );
  }

  // Particles

  #puff(
    kind: ParticleKind,
    at: THREE.Vector3,
    look: { size: number; color: number; opacity: number },
  ) {
    if (this.#particles.length >= MAX_PARTICLES) return;
    const additive = kind === 'flame' || kind === 'ember';
    const material = new THREE.SpriteMaterial({
      map: this.#puffTexture,
      color: look.color,
      transparent: true,
      opacity: look.opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(at);
    sprite.scale.setScalar(look.size);
    this.#scene.add(sprite);
    const motion: Record<ParticleKind, { up: number; side: number; life: number; grow: number }> = {
      flame: { up: 0.55, side: 0.06, life: 0.45, grow: -1.2 },
      ember: { up: 0.9, side: 0.15, life: 1.1, grow: -0.6 },
      smoke: { up: 0.7, side: 0.08, life: 0.85, grow: 1.4 },
      steam: { up: 0.75, side: 0.35, life: 1.1, grow: 2.2 },
      ash: { up: -0.25, side: 0.12, life: 0.9, grow: -0.4 },
    };
    const move = motion[kind];
    this.#particles.push({
      sprite,
      material,
      kind,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * move.side * 2,
        move.up * (0.7 + Math.random() * 0.6),
        (Math.random() - 0.5) * move.side * 2,
      ),
      age: 0,
      life: move.life * (0.8 + Math.random() * 0.4),
      size: look.size,
      grow: move.grow,
      opacity: look.opacity,
    });
  }

  #smoke(at: THREE.Vector3, look: { size: number; color: number; opacity: number }): void {
    this.#puff('smoke', at, look);
  }

  #burst(kind: Exclude<ParticleKind, 'smoke'>, at: THREE.Vector3, count: number): void {
    const looks = {
      flame: { size: 0.16, color: 0xff7a2a, opacity: 0.85 },
      ember: { size: 0.035, color: 0xffc070, opacity: 1 },
      steam: { size: 0.28, color: 0xf2f5f6, opacity: 0.55 },
      ash: { size: 0.05, color: 0x2a2622, opacity: 0.9 },
    };
    for (let index = 0; index < count; index++) {
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 0.12,
        0,
        (Math.random() - 0.5) * 0.12,
      );
      this.#puff(kind, at.clone().add(spread), looks[kind]);
    }
  }

  #updateParticles(dt: number): void {
    this.#particles = this.#particles.filter((particle) => {
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.sprite.removeFromParent();
        particle.material.dispose();
        return false;
      }
      const share = particle.age / particle.life;
      particle.sprite.position.addScaledVector(particle.velocity, dt);
      // Smoke and steam drift and slow; flames shrink as they rise.
      particle.velocity.multiplyScalar(Math.exp(-0.6 * dt));
      particle.sprite.scale.setScalar(Math.max(particle.size * (1 + particle.grow * share), 0.005));
      particle.material.opacity = particle.opacity * (1 - share) ** 1.4;
      return true;
    });
  }

  #clearParticles(kind: ParticleKind): void {
    this.#particles = this.#particles.filter((particle) => {
      if (particle.kind !== kind) return true;
      particle.sprite.removeFromParent();
      particle.material.dispose();
      return false;
    });
  }

  // Camera

  #updateCamera(dt: number): void {
    const round = this.#round;
    // In close while it cooks, until the rack is out of the fire.
    const close = round?.phase.kind === 'cook';
    const want = close ? VIEWS.cook : VIEWS.plan;
    const ease = 1 - Math.exp(-(close ? 2.5 : 4) * dt);
    const view = this.#view;
    view.target.lerp(want.target, ease);
    view.distance += (want.distance - view.distance) * ease;
    view.lift += (want.lift - view.lift) * ease;
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width > 0 && height > 0) {
      this.#camera.setViewOffset(width, height, 0, height * view.lift, width, height);
    }
    const back = new THREE.Vector3(0, Math.sin(CAMERA_ELEVATION), Math.cos(CAMERA_ELEVATION));
    this.#camera.position.copy(view.target).addScaledVector(back, view.distance);
    this.#shake *= Math.exp(-10 * dt);
    if (this.#shake > 0.001) {
      this.#camera.position.add(
        new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(this.#shake),
      );
    }
    this.#camera.lookAt(view.target);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    // Narrow portrait screens: widen the view so the trench and the bucket fit across.
    this.#camera.fov = width / height < 0.6 ? 50 : 42;
    this.#camera.setViewOffset(width, height, 0, height * this.#view.lift, width, height);
    this.#camera.updateProjectionMatrix();
  }

  #play(name: string, volume: number, detune = 0): void {
    this.#sfx.play(name, volume, detune + (Math.random() - 0.5) * 80);
  }

  // Input

  /** Where the handle is on screen (client pixels). */
  #handleOnScreen(): { x: number; y: number } {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const projected = this.#handle.getWorldPosition(new THREE.Vector3()).project(this.#camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  /** The way the rack slides out toward you, on screen (a unit direction). */
  #pullDirection(): { x: number; y: number } {
    const from = this.#handle.getWorldPosition(new THREE.Vector3());
    const a = from.clone().project(this.#camera);
    const b = from.add(new THREE.Vector3(0, 0, 1)).project(this.#camera);
    const x = b.x - a.x;
    const y = -(b.y - a.y);
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      const round = this.#round;
      if (!round || this.#pointer) return;
      if (round.phase.kind === 'plan') {
        const spot = this.#spotAt(event.clientX, event.clientY);
        if (spot !== undefined) round.tapSpot(spot);
        return;
      }
      if (round.phase.kind !== 'cook') return;
      // A forgiving grab: anywhere near the handle takes hold of it.
      const handle = this.#handleOnScreen();
      const near =
        Math.hypot(event.clientX - handle.x, event.clientY - handle.y) <= round.feel.grabPx;
      canvas.setPointerCapture(event.pointerId);
      this.#pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        grabbed: near,
      };
      if (near) this.#play('press-click', 0.3, 300);
    });
    canvas.addEventListener('pointermove', (event) => {
      const pointer = this.#pointer;
      const round = this.#round;
      if (!pointer || pointer.id !== event.pointerId || !round || !pointer.grabbed) return;
      const way = this.#pullDirection();
      const moved =
        (event.clientX - pointer.startX) * way.x + (event.clientY - pointer.startY) * way.y;
      // The pull counts as soon as the handle starts to move.
      if (moved >= round.feel.dragPx) {
        this.#pointer = undefined;
        round.pull();
      }
    });
    const end = (event: PointerEvent) => {
      if (this.#pointer?.id === event.pointerId) this.#pointer = undefined;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /** The fuel spot under a point on the screen, if it's over the trench. */
  #spotAt(clientX: number, clientY: number): number | undefined {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const point = this.#raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1),
      new THREE.Vector3(),
    );
    if (!point || Math.abs(point.z) > TRENCH_DEPTH_Z / 2 + 0.25) return undefined;
    const rules = this.#deps.game.data.firemaking;
    const width = rules.rack.staves * STAVE_GAP;
    const spot = Math.floor(((point.x + width / 2) / width) * rules.rack.spots);
    return spot >= 0 && spot < rules.rack.spots ? spot : undefined;
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
    const rules = this.#deps.game.data.firemaking;
    const root = el('div', 'fm-ui');
    const streak = el('div', 'fm-streak');
    streak.hidden = true;
    const hint = el('div', 'fm-hint');
    // The heat under each stave as bars, coloured by how each would come out at the best pull.
    const heat = el('div', 'fm-heat');
    heat.setAttribute('aria-label', 'Heat under each stave');
    const heatBars = el('div', 'fm-heat-bars');
    const heatMarks = el('div', 'fm-heat-marks');
    const bars = Array.from({ length: rules.rack.staves }, () => {
      const column = el('div', 'fm-bar');
      const fill = el('div', 'fm-bar-fill');
      column.append(fill);
      heatBars.append(column);
      const mark = el('div', 'fm-bar-mark');
      heatMarks.append(mark);
      return { column, fill, mark };
    });
    const best = el('div', 'fm-best');
    heat.append(heatBars, heatMarks, best);
    // A button per fuel spot, under its staves' bars.
    const spots = el('div', 'fm-spots');
    const spotButtons = Array.from({ length: rules.rack.spots }, (_, spot) => {
      const element = button('', 'fm-spot', () => {
        this.#round?.tapSpot(spot);
      });
      element.setAttribute('aria-label', `Fuel spot ${String(spot + 1)}`);
      spots.append(element);
      return element;
    });
    const controls = el('div', 'fm-controls');
    const fuel = el('div', 'fm-fuel');
    const lay = button('Lay the rack', 'fm-button fm-lay', () => {
      this.#round?.lay();
    });
    controls.append(fuel, lay);
    // The handle's grab ring while it cooks.
    const grab = el('div', 'fm-grab');
    grab.setAttribute('aria-hidden', 'true');
    const card = el('div', 'fm-card');
    const cardStars = el('div', 'w3d-stars fm-card-stars');
    const cardTitle = el('div', 'fm-card-title');
    const cardText = el('div', 'fm-card-text');
    const cardButtons = el('div', 'fm-card-buttons');
    const leave = button('Back to camp', 'fm-button fm-secondary', () => {
      this.#deps.onLeave();
    });
    const next = button('Next rack', 'fm-button', () => {
      this.#hud.settle();
      this.#skillBar.settle();
      this.#startRack();
    });
    cardButtons.append(leave, next);
    card.append(cardStars, cardTitle, cardText, cardButtons);
    card.hidden = true;
    root.append(streak, grab, hint, heat, spots, controls, card);
    this.#element.append(root);
    return {
      root,
      streak,
      hint,
      heat,
      bars,
      best,
      spots,
      spotButtons,
      controls,
      fuel,
      lay,
      grab,
      card,
      cardStars,
      cardTitle,
      cardText,
      next,
    };
  }

  #updateUi(): void {
    const ui = this.#ui;
    const round = this.#round;
    const phase = round?.phase.kind ?? 'none';
    if (phase !== this.#lastPhase) {
      this.#lastPhase = phase;
      // Lets the e2e test follow along.
      document.body.dataset.firemaking = phase;
    }
    if (!round) {
      ui.heat.hidden = ui.spots.hidden = ui.controls.hidden = ui.grab.hidden = true;
      ui.hint.textContent = '';
      return;
    }
    const planning = phase === 'plan';
    ui.heat.hidden = ui.spots.hidden = ui.controls.hidden = !planning;
    const logsLeft =
      this.#deps.game.inventory.count(this.#deps.game.data.firemaking.fuel) -
      (planning ? round.logsPlaced : 0);
    if (planning) {
      this.#showPreview(round);
      ui.fuel.textContent = `🪵 ${String(Math.max(logsLeft, 0))} logs · ${String(round.staves)} staves`;
    }
    const hints: Record<string, string> = {
      plan:
        logsLeft + round.logsPlaced > 0
          ? 'Tap a fuel spot to drop in a log: even out the fire until every bar is gold'
          : 'No logs for fuel: lay the rack on the fire as it is',
      cook: 'Grab the handle and pull the rack out when the smoke turns thick grey',
      done: '',
    };
    ui.hint.textContent = hints[phase] ?? '';
    // While it cooks the hint moves up top, clear of the handle.
    ui.hint.dataset.phase = phase;
    // The grab ring round the handle while it cooks.
    const cooking = phase === 'cook';
    ui.grab.hidden = !cooking;
    const handle = this.#handleOnScreen();
    const rect = this.#element.getBoundingClientRect();
    if (cooking) {
      ui.grab.style.left = `${String(handle.x - rect.left)}px`;
      ui.grab.style.top = `${String(handle.y - rect.top)}px`;
      ui.grab.style.width = ui.grab.style.height = `${String(round.feel.grabPx * 1.2)}px`;
    }
    // For the e2e test: where the handle is, and how each stave would come out right now.
    this.#element.dataset.handleX = String(Math.round(handle.x));
    this.#element.dataset.handleY = String(Math.round(handle.y));
    this.#element.dataset.finishes = Array.from({ length: round.columns }, (_, column) =>
      cooking ? finishName(round.doneness(column), round.feel.charRatio) : '',
    ).join(',');
  }

  /** The heat bars and each stave's mark and colour at the best pull, redrawn on change. */
  #showPreview(round: FiremakingRound): void {
    const preview = round.preview;
    const heats = round.heats;
    const key = `${heats.map((heat) => heat.toFixed(2)).join(',')}|${round.logs.join('')}`;
    if (key === this.#previewKey) return;
    this.#previewKey = key;
    const ui = this.#ui;
    const rules = this.#deps.game.data.firemaking;
    // Scaled to this fire so the lumps read: from half the coldest up to a little over the
    // hottest stave (and at least the even fire's heat, so an even fire isn't drawn squashed at
    // the top).
    const floor = Math.min(...heats) * 0.5;
    const top = Math.max(...heats, rules.generator.flat) * 1.25;
    const share = (heat: number) =>
      `${String(Math.min(Math.max(((heat - floor) / (top - floor)) * 100, 0), 100))}%`;
    const marks: Record<Finish, string> = { hardened: '✓', under: '↓', charred: '✕' };
    ui.bars.forEach((bar, column) => {
      const finish = preview.finishes[column] ?? 'under';
      bar.fill.style.height = share(heats[column] ?? 0);
      bar.column.dataset.finish = bar.mark.dataset.finish = finish;
      bar.mark.textContent = marks[finish];
    });
    ui.best.textContent =
      preview.hardened === round.columns
        ? `Full rack · ${preview.window.toFixed(1)} s to pull`
        : `${String(preview.hardened)} of ${String(round.columns)} at best`;
    ui.spotButtons.forEach((element, spot) => {
      const logs = round.logs[spot] ?? 0;
      element.dataset.logs = String(logs);
      element.replaceChildren(
        ...Array.from({ length: rules.rack.maxLogs }, (_, index) => {
          const log = document.createElement('span');
          log.className = index < logs ? 'fm-log fm-log-on' : 'fm-log';
          return log;
        }),
      );
    });
    ui.root.style.setProperty('--fm-columns', String(round.columns));
  }

  /** The end card: stars, spears, what went wrong if anything, and the hot streak. */
  #showCard(result: RackResult): void {
    const ui = this.#ui;
    const feel = this.#deps.feel.values;
    ui.cardStars.replaceChildren(
      ...[0, 1, 2].map((index) => {
        const star = document.createElement('span');
        star.className = `w3d-star ${index < result.stars ? 'w3d-star-on' : 'w3d-star-off'}`;
        star.textContent = '★';
        star.style.animationDelay = `${String(index * 0.18)}s`;
        return star;
      }),
    );
    window.setTimeout(() => {
      for (let index = 0; index < result.stars; index++) {
        window.setTimeout(() => {
          this.#sfx.play('star', 0.6, index * 250);
        }, index * 180);
      }
    }, 50);
    const layers = nextLayers(this.#layers, result.stars, feel.streakCap);
    const lines: string[] = [];
    const parts = [`${String(result.hardened)} hardened`];
    if (result.under > 0) parts.push(`${String(result.under)} underdone (back to staves)`);
    if (result.charred > 0) parts.push(`${String(result.charred)} charred`);
    lines.push(parts.join(' · '));
    const columns = this.#deps.game.data.firemaking.rack.staves;
    if (result.burnt) lines.push('Left on the fire too long');
    else if (result.stars >= 3) lines.push('Pulled right on time');
    else if (result.best.hardened < columns) {
      lines.push(`The fuel allowed ${String(result.best.hardened)} of ${String(columns)} at best`);
    } else lines.push(result.under > 0 ? 'Pulled a touch early' : 'Pulled a touch late');
    if (layers > this.#layers) lines.push(`🔥 Hot streak! Next rack stacks ${String(layers)} deep`);
    else if (layers === this.#layers && layers > 1)
      lines.push(`🔥 Hot streak holds: ${String(layers)} deep`);
    else if (this.#layers > 1) lines.push('The streak is over');
    this.#layers = layers;
    ui.cardTitle.textContent = `${String(result.banked)} spear${result.banked === 1 ? '' : 's'}`;
    ui.cardText.textContent = lines.join('\n');
    ui.next.hidden = false;
    ui.card.hidden = false;
  }

  #showNoStaves(): void {
    const ui = this.#ui;
    ui.cardStars.replaceChildren();
    ui.cardTitle.textContent = 'No staves';
    ui.cardText.textContent =
      'The warchest has no staves to harden. Split some logs at the workbench.';
    ui.next.hidden = true;
    ui.card.hidden = false;
  }
}

/** The colour of a stave `done` along (1 hardened, `charRatio` charred). */
function staveColor(done: number, charRatio: number, out: THREE.Color): THREE.Color {
  if (done < 1) return out.copy(COLORS.raw).lerp(COLORS.toasted, Math.max(done, 0) ** 2);
  if (done < charRatio)
    return out.copy(COLORS.toasted).lerp(COLORS.done, (done - 1) / (charRatio - 1));
  return out.copy(COLORS.charred);
}

function finishName(done: number, charRatio: number): Finish {
  if (done < 1) return 'under';
  return done < charRatio ? 'hardened' : 'charred';
}

/** The heat at `x` along the trench, between the staves' heats. */
function heatAt(heats: readonly number[], x: number, columnX: (column: number) => number): number {
  const first = columnX(0);
  const gap = columnX(1) - first || 1;
  const at = Math.min(Math.max((x - first) / gap, 0), heats.length - 1);
  const low = Math.floor(at);
  const high = Math.min(low + 1, heats.length - 1);
  const t = at - low;
  return (heats[low] ?? 0) * (1 - t) + (heats[high] ?? 0) * t;
}
