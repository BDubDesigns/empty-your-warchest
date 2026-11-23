import * as THREE from 'three';
import { TrunkCarver } from './carve';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import type { EventLogger, Game, LiveTuning } from '../../../core';
import type { Clearing, ClearingTree, WoodcuttingFeel } from '../../../data';
import { fallTip, previewFall, trunkAngles, type FallStep, type Point } from '../logic/chain';
import { fallTilt } from '../logic/fall';
import { WoodcuttingRound, type RoundEvent } from '../logic/round';

export interface Woodcutting3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<WoodcuttingFeel>;
}

type TreeStyle = 'kenney' | 'quaternius';

interface Models {
  kenney: THREE.Object3D[];
  quaternius: THREE.Object3D[];
  stump: THREE.Object3D;
  axe: THREE.Object3D;
}

/** World units per clearing unit: the 360×640 clearing becomes 12×21 units. */
const SCALE = 1 / 30;
const STYLE_KEY = 'warchest.woodcutting.treeStyle';
/** Frames (while aiming) to judge the detailed trees by, and the median frame time that's too slow. */
const FALLBACK_FRAMES = 90;
const FALLBACK_MS = 25;
const MODELS = {
  kenney: ['tree_default', 'tree_oak', 'tree_detailed'].map((name) => `models/kenney/${name}.glb`),
  quaternius: ['CommonTree_1', 'CommonTree_3', 'Pine_1'].map(
    (name) => `models/quaternius/${name}.gltf`,
  ),
  stump: 'models/kenney/stump_round.glb',
  axe: 'models/kenney/tool-axe.glb',
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
  ].map((name) => [name, `audio/woodcutting/${name}.mp3`]),
);
const COLORS = {
  sky: 0xa9cfe0,
  grass: 0x5d8c46,
  clearing: 0x77a457,
  accent: 0xc8873a,
  guide: 0xf2ead3,
  gold: 0xe8c04f,
  wood: 0xe0c089,
  chip: 0xd8b483,
  dust: 0xcbbd9a,
};
/** Screen space the overlay uses: buttons and logs above, the chop panel below. */
const UI_TOP = 96;
const UI_BOTTOM = 236;
/** Pull-back aiming ignores the finger until it's this far (clearing units) from the tree. */
const AIM_DEAD_ZONE = 14;
/** Screen pixels of drag that pull the axe all the way back. */
const FULL_PULL = 120;
/** Seconds for the camera to move between the overview and the chop close-up. */
const CAMERA_MOVE = 0.6;
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
  /** Trunk directions once it has fallen, and when it started sinking away. */
  fallen?: { trunks: number[]; sinkAt?: number };
  /** Set once the chopped tree has broken at its notch: the trunks tip from this height. */
  brokenAt?: number;
}

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
  kind: 'chip' | 'dust';
}

/**
 * Makes every material plain and matte. Some packs export full metalness, which renders
 * black without a reflection map.
 */
function matte(model: THREE.Object3D): THREE.Object3D {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials: unknown[] = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.metalness = 0;
        material.roughness = 1;
      }
    }
  });
  return model;
}

function treeSeed(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/**
 * 3D spike of the woodcutting mini game: the same rules (WoodcuttingRound) drawn with
 * three.js and low-poly CC0 models. An angled overview of the clearing for aiming and
 * watching chains; a close-up facing the trunk for chopping.
 */
export class Woodcutting3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Woodcutting3DDeps;
  readonly #clearing: Clearing;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  readonly #models: Models;
  readonly #sfx = new Sfx();
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

  private constructor(element: HTMLElement, deps: Woodcutting3DDeps, models: Models) {
    this.#element = element;
    this.#deps = deps;
    this.#models = models;
    const [clearing] = deps.game.data.woodcutting.clearings;
    if (!clearing) throw new Error('No woodcutting clearing in data');
    this.#clearing = clearing;
    this.#style = this.#savedStyle();

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
    this.#buildTrees();
    this.#sfx.load(SOUNDS);
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  /** Loads the models, then builds the view. */
  static async create(element: HTMLElement, deps: Woodcutting3DDeps): Promise<Woodcutting3DView> {
    const loader = new GLTFLoader();
    const load = async (url: string) => matte((await loader.loadAsync(url)).scene);
    const [kenney, quaternius, stump, axe] = await Promise.all([
      Promise.all(MODELS.kenney.map(load)),
      Promise.all(MODELS.quaternius.map(load)),
      load(MODELS.stump),
      load(MODELS.axe),
    ]);
    return new Woodcutting3DView(element, deps, { kenney, quaternius, stump, axe });
  }

  // ScreenView

  start(): void {
    this.#resize();
    this.#round = new WoodcuttingRound(
      this.#clearing,
      {
        logger: this.#deps.logger,
        feel: () => this.#deps.feel.values,
        chainExponent: this.#deps.game.data.woodcutting.chainExponent,
        bank: (batches) => {
          const { game } = this.#deps;
          const result = game.craft(game.data.woodcutting.recipe, { batches }, { awardXp: false });
          return result.produced.reduce((sum, stack) => sum + stack.count, 0);
        },
        onEvent: (event) => {
          this.#onEvent(event);
        },
        view: '3d',
      },
      Date.now() >>> 0,
    );
    this.#resetTrees();
    this.#frameTimes = [];
    this.#cameraPose = this.#overview;
    this.#cameraFrom = this.#cameraTo = undefined;
    this.#cameraPhase = '';
    this.#ui.summary.hidden = true;
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#round.exit();
    this.#logPerformance();
    delete document.body.dataset.woodcutting;
    this.#lastPhase = '';
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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshLambertMaterial({ color: COLORS.grass }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.#scene.add(ground);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(this.#clearing.width * SCALE + 1, this.#clearing.height * SCALE + 1),
      new THREE.MeshLambertMaterial({ color: COLORS.clearing }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.y = 0.005;
    patch.receiveShadow = true;
    this.#scene.add(patch);
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

  #buildTrees(): void {
    for (const carver of this.#carvers.values()) carver.dispose();
    this.#carvers.clear();
    for (const visual of this.#trees.values()) this.#scene.remove(visual.root);
    this.#trees.clear();
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
        const model = this.#modelOfHeight(source, tree.height * SCALE * (forks > 1 ? 0.85 : 1));
        model.rotation.y = ((seed % 360) + i * 137) * DEG;
        pivot.add(model);
        root.add(pivot);
        trunks.push(pivot);
      }
      const stump = this.#modelOfHeight(this.#models.stump, 0.22);
      stump.visible = false;
      root.add(stump);
      this.#scene.add(root);
      this.#trees.set(tree.id, { tree, root, trunks, stump });
    }
  }

  #resetTrees(): void {
    if (this.#carvers.size > 0) {
      // Carved and broken trees are rebuilt from the models rather than patched back.
      this.#buildTrees();
      return;
    }
    for (const visual of this.#trees.values()) {
      delete visual.fallen;
      visual.stump.visible = false;
      for (const trunk of visual.trunks) {
        trunk.visible = true;
        trunk.quaternion.identity();
        trunk.scale.setScalar(1);
        trunk.position.y = 0;
      }
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
    const phase = this.#round.phase;
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
    trunkAngles(tree, phase.angle).forEach((trunk, index) => {
      const set = sets[index];
      if (!set) return;
      const preview = previewFall(this.#clearing, this.#round.standing, tree, trunk);
      const ghost = this.#world(preview.ghost);
      this.#placeStrip(set.line, base, ghost, 0.06);
      set.ghost.position.set(ghost.x, 0.05, ghost.z);
      set.ghost.visible = true;
      if (preview.hit) {
        const hitTree = this.#trees.get(preview.hit.tree)?.tree;
        if (!hitTree) return;
        const from = this.#world(hitTree);
        // The knocked tree's whole fall: a line to where its top lands, and its landing ring.
        const land = this.#world(fallTip(hitTree, preview.hit.angle));
        const canopy = this.#clearing.canopyRadius * SCALE;
        const lineEnd = land
          .clone()
          .addScaledVector(
            new THREE.Vector3(Math.cos(preview.hit.angle), 0, Math.sin(preview.hit.angle)),
            -canopy - 0.25,
          );
        this.#placeStrip(set.hitLine, from, lineEnd, 0.08);
        set.hitHead.position.set(lineEnd.x, 0.05, lineEnd.z);
        set.hitHead.rotation.set(0, -preview.hit.angle, 0);
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
   * each lands). When the chain splits it widens to keep both paths; as trees land it closes in
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
      const height = tree.height * SCALE;
      const tilt = fallTilt(
        Math.max(round.now - faller.start, 0) / feel.fallSeconds,
        feel.fallEase,
      );
      const base = this.#world(tree);
      points.push(base);
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
    if (points.length === 0) return undefined;
    const direction = side
      .clone()
      .multiplyScalar(Math.cos(CHASE_ELEVATION))
      .setY(Math.sin(CHASE_ELEVATION))
      .normalize();
    return this.#framing(points, direction, CHASE_MIN_DISTANCE);
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
        Math.min(...xs) >= 24 &&
        Math.max(...xs) <= width - 24 &&
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
        if (visual) visual.fallen = { trunks: step.trunks };
        const carver = this.#carvers.get(step.tree);
        if (visual && carver && visual.brokenAt === undefined) this.#breakAtNotch(visual, carver);
      }
      this.#startChase(event.steps[0]);
      this.#play(`creak-${1 + Math.floor(Math.random() * 3)}`, 0.7);
    } else if (event.type === 'landed') {
      const visual = this.#trees.get(event.step.tree);
      if (visual) {
        for (const trunk of event.step.trunks) {
          this.#burst('dust', this.#world(fallTip(visual.tree, trunk), 0.2), 10);
        }
      }
      this.#play(`land-${1 + Math.floor(Math.random() * 3)}`, 0.85);
      this.#shake = Math.min(0.05 + event.step.depth * 0.02, 0.15) * feel.shakeStrength;
      if (event.count > 1) this.#showCounter(event.count);
    } else if (event.type === 'banked') {
      for (const visual of this.#trees.values()) {
        if (visual.fallen && visual.fallen.sinkAt === undefined)
          visual.fallen.sinkAt = this.#round.now + 0.5;
      }
      const { trees, logs } = event;
      const sum =
        trees > 1 && logs === trees * trees
          ? `${trees} × ${trees} = ${logs} logs!`
          : `+${logs} log${logs === 1 ? '' : 's'}`;
      this.#flash(sum, trees > 1 ? 'perfect' : 'good');
    } else {
      this.#ui.summaryText.textContent = `${this.#round.felled} trees · ${this.#round.logs} logs to the warchest`;
      this.#ui.summary.hidden = false;
    }
  }

  #play(name: string, volume: number): void {
    this.#sfx.play(name, volume, (Math.random() - 0.5) * 240);
  }

  #burst(kind: 'chip' | 'dust', at: THREE.Vector3, count: number, toward?: THREE.Vector3): void {
    for (let i = 0; i < count; i++) {
      const object =
        kind === 'chip'
          ? new THREE.Mesh(
              new THREE.BoxGeometry(0.05, 0.02, 0.035),
              new THREE.MeshLambertMaterial({ color: COLORS.chip }),
            )
          : new THREE.Mesh(
              new THREE.SphereGeometry(0.12, 6, 4),
              new THREE.MeshBasicMaterial({
                color: COLORS.dust,
                transparent: true,
                opacity: 0.6,
                depthWrite: false,
              }),
            );
      object.position.copy(at);
      const spread = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8 + 0.2,
        Math.random() - 0.5,
      );
      if (toward) spread.addScaledVector(toward, 0.8);
      const speed = kind === 'chip' ? 2.4 + Math.random() * 2 : 0.6 + Math.random() * 0.8;
      this.#scene.add(object);
      this.#particles.push({
        object,
        velocity: spread.normalize().multiplyScalar(speed),
        life: kind === 'chip' ? 0.6 : 0.9,
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
      if (particle.kind === 'chip') particle.velocity.y -= 9 * dt;
      particle.object.position.addScaledVector(particle.velocity, dt);
      particle.object.rotation.x += dt * 9;
      if (particle.kind === 'dust') {
        const grow = 1 + particle.age * 2.5;
        particle.object.scale.setScalar(grow);
        particle.object.material.opacity = 0.6 * (1 - particle.age / particle.life);
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
    const dt = performance.now() < this.#frozenUntil ? 0 : realDt;
    this.#round.tick(dt);
    // Chop is a button, so the phase can change between frames: compare with last frame's.
    const kind = this.#round.phase.kind;
    if (kind !== this.#cameraPhase) {
      if (kind === 'chop') this.#enterCloseUp();
      this.#cameraPhase = kind;
    }
    this.#updateTrees();
    this.#updateGuides();
    this.#updateAxe();
    this.#updateParticles(dt);
    this.#updateCamera(realDt);
    this.#updateUi();
    this.#renderer.render(this.#scene, this.#camera);
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
          this.#tip(trunk, faller.step.trunks[index] ?? faller.step.angle, tilt);
          // A tree broken at its notch tips over the stump, then its butt drops to the ground.
          if (visual.brokenAt !== undefined)
            trunk.position.y = visual.brokenAt * (1 - Math.sin(tilt));
        });
      } else if (visual.fallen) {
        visual.stump.visible = visual.brokenAt === undefined;
        const sinking =
          visual.fallen.sinkAt === undefined
            ? 0
            : Math.max(0, (round.now - visual.fallen.sinkAt) / HAUL_SECONDS);
        visual.trunks.forEach((trunk, index) => {
          this.#tip(trunk, visual.fallen?.trunks[index] ?? 0, Math.PI / 2);
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
    const total = el('div', 'w3d-total');
    const perf = el('div', 'w3d-perf');
    const style = el('button', 'w3d-style');
    style.type = 'button';
    style.addEventListener('click', () => {
      this.#setStyle(this.#style === 'kenney' ? 'quaternius' : 'kenney');
    });
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
    const flashes = el('div', 'w3d-flashes');
    const counter = el('div', 'w3d-counter');
    const summary = el('div', 'w3d-summary');
    const summaryTitle = el('div', 'w3d-summary-title', 'Clearing cleared!');
    const summaryText = el('div', 'w3d-summary-text');
    const again = button(
      'New round',
      () => {
        this.stop();
        this.start();
      },
      true,
    );
    summary.append(summaryTitle, summaryText, again);
    summary.hidden = true;
    root.append(total, style, perf, hint, panel, flashes, counter, summary);
    this.#element.append(root);
    return {
      total,
      perf,
      style,
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
      summaryText,
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
      ui.hint.textContent = hints[phase.kind] ?? '';
    }
    ui.total.textContent = `Logs this round: ${round.logs}`;
    ui.style.textContent = `Trees: ${this.#style === 'kenney' ? 'Kenney' : 'Quaternius'}`;
    ui.aim.hidden = phase.kind !== 'aim';
    ui.chop.disabled = !round.canChop;
    ui.chopPanel.hidden = phase.kind !== 'chop';
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

  #flash(message: string, tone: 'perfect' | 'good' | 'glancing'): void {
    const flash = document.createElement('div');
    flash.className = `w3d-flash w3d-${tone}`;
    flash.textContent = message;
    this.#ui.flashes.append(flash);
    setTimeout(() => {
      flash.remove();
    }, 900);
  }

  #showCounter(trees: number): void {
    const counter = this.#ui.counter;
    counter.textContent = `${trees} trees!`;
    // Restart the pop animation.
    counter.classList.remove('w3d-pop');
    counter.getBoundingClientRect();
    counter.classList.add('w3d-pop');
  }

  // Style toggle and logs

  /** The player's pick if they made one; otherwise the detailed trees, watched for slow frames. */
  #savedStyle(): TreeStyle {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STYLE_KEY);
    } catch {
      // No storage: use the default.
    }
    this.#styleChosen = saved === 'kenney' || saved === 'quaternius';
    return saved === 'kenney' ? 'kenney' : 'quaternius';
  }

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
    if (median > FALLBACK_MS) this.#setStyle('kenney', { auto: true, p50: median });
  }

  #setStyle(style: TreeStyle, auto?: { auto: true; p50: number }): void {
    this.#style = style;
    this.#styleChosen = true;
    try {
      localStorage.setItem(STYLE_KEY, style);
    } catch {
      // Not saved; it still applies until the page reloads.
    }
    this.#buildTrees();
    // Mid-chop the notch was rebuilt away with the old trees: cut it again.
    const phase = this.#round.phase;
    if (phase.kind === 'chop' && phase.points > 0) {
      const frame = this.#closeUpFrame(phase.tree, phase.angle);
      if (frame)
        this.#carverFor(phase.tree, frame)?.carve(phase.points / this.#round.feel.chopPoints);
    }
    this.#updateTrees();
    this.#deps.logger.log('woodcutting3d.style', { style, ...auto });
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
    });
  }
}

/**
 * Whether `visual` stands near the line from the camera toward its target (on the ground), within
 * the first `share` of that line and `radius` of it.
 */
function blocks(visual: TreeVisual, pose: CameraPose, share: number, radius: number): boolean {
  const from = new THREE.Vector2(pose.position.x, pose.position.z);
  const to = new THREE.Vector2(pose.target.x, pose.target.z);
  const at = new THREE.Vector2(visual.root.position.x, visual.root.position.z);
  const line = to.clone().sub(from);
  const t = Math.min(Math.max(at.clone().sub(from).dot(line) / line.lengthSq(), 0), share);
  const closest = from.clone().addScaledVector(line, t);
  return at.distanceTo(closest) < radius;
}
