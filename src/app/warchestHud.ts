import * as THREE from 'three';
import { Rng, type EventLogger, type Game } from '../core';
import type { GameData, ItemLook } from '../data';
import type { Haptics } from './haptics';
import { loadModel } from './models';
import { warchestRows } from '../camp/warchestRows';
import { Sfx } from './sfx';
import { PANEL_CLOSE_MS, WarchestPanel } from './warchestPanel';
import { releaseContext, restoreContext } from './trouble';
import { splitDeposit } from './warchestPour';

const MODELS = {
  chest: 'models/kenney/chest.glb',
  log: 'models/kenney/log.glb',
  potion: 'models/quaternius/Potion_2.gltf',
};
const SOUNDS = Object.fromEntries(
  [
    'chest-open',
    'chest-close',
    'chest-latch',
    'log-in-1',
    'log-in-2',
    'log-in-3',
    'panel-open',
    'panel-close',
  ].map((name) => [name, `audio/warchest/${name}.mp3`]),
);
interface HudModels {
  chest: THREE.Object3D;
  log: THREE.Object3D;
  potion: THREE.Object3D;
}

async function loadHudModels(): Promise<HudModels> {
  const [chest, log, potion] = await Promise.all([
    loadModel(MODELS.chest),
    loadModel(MODELS.log),
    loadModel(MODELS.potion),
  ]);
  return { chest, log, potion };
}
/** Chest and flying pieces, in CSS pixels. */
const CHEST_SIZE = 46;
const PIECE_LENGTH = 30;
/** How long each look of piece flies, as a share of `PIECE_LENGTH`: a spear is long and thin. */
const PIECE_LENGTHS: Record<ItemLook, number> = {
  round: 1,
  split: 1.15,
  pointed: 1.6,
  bottle: 0.6,
  tuft: 0.55,
  cap: 0.5,
  heap: 0.5,
  leaf: 0.6,
  seed: 0.4,
  pod: 0.45,
  spores: 0.45,
  feather: 0.8,
  arrow: 1.6,
  shaft: 1.6,
  duster: 1.6,
  dowel: 1.5,
  petals: 0.5,
};

/**
 * A piece of an item, as it flies into the chest, its length along z: the log model for a round
 * log, and for a split stave or a pointed spear, a shaft drawn here (no model to load). A potion
 * is Quaternius's bottle when `potion` is given, else a small drawn one. The cauldron's shelf draws
 * its ingredient icons from these too.
 */
export function pieceModel(
  look: ItemLook,
  log: THREE.Object3D,
  potion?: THREE.Object3D,
): THREE.Object3D {
  if (look === 'round') return log.clone(true);
  const piece = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: look === 'split' ? 0xd9b07a : 0xa47a4a });
  if (look === 'bottle' && potion) {
    // A potion: Quaternius's bottle, stood on its side along z.
    const bottle = potion.clone(true);
    bottle.rotation.x = Math.PI / 2;
    piece.add(bottle);
    return piece;
  }
  if (look === 'bottle') {
    // A small bottle: a green glass body, a neck, a cork (lying along z).
    const glass = new THREE.MeshLambertMaterial({
      color: 0x5fae7a,
      transparent: true,
      opacity: 0.85,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.6, 12), glass);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.25, 10), glass);
    neck.position.y = 0.42;
    const cork = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.12, 8),
      new THREE.MeshLambertMaterial({ color: 0x9a7448 }),
    );
    cork.position.y = 0.6;
    const bottle = new THREE.Group();
    bottle.add(body, neck, cork);
    bottle.rotation.x = Math.PI / 2;
    piece.add(bottle);
    return piece;
  }
  if (look === 'tuft') {
    // A tuft of moss: a few soft green lumps.
    const moss = new THREE.MeshLambertMaterial({ color: 0x7f9e2c, flatShading: true });
    [
      [0, 0, 0, 0.3],
      [0.22, 0.05, 0.12, 0.22],
      [-0.2, 0.02, -0.1, 0.24],
    ].forEach(([x, y, z, r]) => {
      const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), moss);
      lump.position.set(x ?? 0, y ?? 0, z ?? 0);
      lump.scale.y = 0.6;
      piece.add(lump);
    });
    return piece;
  }
  if (look === 'cap') {
    // A red cap mushroom: a white stalk under a red dome.
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.3, 8),
      new THREE.MeshLambertMaterial({ color: 0xf1e8d6 }),
    );
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xd8301e }),
    );
    cap.position.y = 0.12;
    const mushroom = new THREE.Group();
    mushroom.add(stalk, cap);
    mushroom.rotation.x = Math.PI / 2;
    piece.add(mushroom);
    return piece;
  }
  if (look === 'heap') {
    // A little grey heap of ash.
    const heap = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.26, 9),
      new THREE.MeshLambertMaterial({ color: 0x8a8682, flatShading: true }),
    );
    heap.rotation.x = Math.PI / 2;
    piece.add(heap);
    return piece;
  }
  if (look === 'leaf') {
    // A woad leaf: a long, flat, blue-green blade.
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 4),
      new THREE.MeshLambertMaterial({ color: 0x3a5a9a, flatShading: true }),
    );
    leaf.scale.set(0.5, 0.12, 1.4);
    piece.add(leaf);
    return piece;
  }
  if (look === 'seed') {
    // A sunflower seed: a dark, pointed husk with pale stripes down it.
    const husk = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 6),
      new THREE.MeshLambertMaterial({ color: 0x34302c }),
    );
    husk.scale.set(0.55, 0.32, 1);
    piece.add(husk);
    const stripe = new THREE.MeshLambertMaterial({ color: 0xe8e2d2 });
    for (const x of [-0.07, 0.07]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.48), stripe);
      line.position.set(x, 0.01, 0);
      piece.add(line);
    }
    return piece;
  }
  if (look === 'pod') {
    // A woad seed: a flat, dark violet pod, a little stalk at one end.
    const pod = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 6),
      new THREE.MeshLambertMaterial({ color: 0x4b2d52, flatShading: true }),
    );
    pod.scale.set(0.75, 0.22, 1);
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.14, 5),
      new THREE.MeshLambertMaterial({ color: 0x6b5a3a }),
    );
    stalk.rotation.x = Math.PI / 2;
    stalk.position.z = -0.34;
    piece.add(pod, stalk);
    return piece;
  }
  if (look === 'spores') {
    // Mushroom spores: a puff of tan dust round a little brown cloud.
    const dust = new THREE.MeshLambertMaterial({ color: 0xb79a6c, flatShading: true });
    [
      [0, 0, 0, 0.26],
      [0.2, 0.06, 0.14, 0.12],
      [-0.18, -0.04, 0.12, 0.1],
      [0.1, -0.05, -0.22, 0.11],
      [-0.12, 0.08, -0.16, 0.09],
    ].forEach(([x, y, z, r]) => {
      const mote = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), dust);
      mote.position.set(x ?? 0, y ?? 0, z ?? 0);
      piece.add(mote);
    });
    return piece;
  }
  if (look === 'feather') {
    // A feather: a pale, flat vane on a quill.
    const vane = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 4),
      new THREE.MeshLambertMaterial({ color: 0xe9e4d8, side: THREE.DoubleSide }),
    );
    vane.scale.set(0.6, 0.06, 1.3);
    vane.position.z = 0.04;
    const quill = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.012, 0.9, 5),
      new THREE.MeshLambertMaterial({ color: 0x9c8e72 }),
    );
    quill.rotation.x = Math.PI / 2;
    piece.add(vane, quill);
    return piece;
  }
  if (look === 'arrow' || look === 'shaft') {
    piece.add(arrowModel(look === 'arrow'));
    return piece;
  }
  if (look === 'duster') {
    piece.add(dusterModel(14));
    return piece;
  }
  if (look === 'dowel') {
    // An arrow shaft: a thin, pale, round length of wood with nothing on it yet.
    const dowel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.95, 6),
      new THREE.MeshLambertMaterial({ color: 0xe0bd88 }),
    );
    dowel.rotation.x = Math.PI / 2;
    piece.add(dowel);
    return piece;
  }
  if (look === 'petals') {
    // Sunflower petals: a small fan of long yellow petals round a brown middle.
    const petal = new THREE.MeshLambertMaterial({ color: 0xf6c21c, flatShading: true });
    for (let index = 0; index < 6; index++) {
      const blade = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 3), petal);
      const angle = (index / 6) * Math.PI * 2;
      blade.scale.set(0.3, 0.1, 0.8);
      blade.position.set(Math.sin(angle) * 0.2, 0, Math.cos(angle) * 0.2);
      blade.rotation.y = angle;
      piece.add(blade);
    }
    const middle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10),
      new THREE.MeshLambertMaterial({ color: 0x5a3a1c }),
    );
    middle.position.y = 0.03;
    piece.add(middle);
    return piece;
  }
  if (look === 'split') {
    // A split stave: a squared-off length of pale, fresh wood.
    piece.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 1), wood));
    return piece;
  }
  // A spear: a round shaft with an iron point at the front.
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.86, 8), wood);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.07;
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.16, 8),
    new THREE.MeshLambertMaterial({ color: 0x6a7075 }),
  );
  point.rotation.x = Math.PI / 2;
  point.position.z = 0.42;
  piece.add(shaft, point);
  return piece;
}
/**
 * An arrow lying along z, point first (+z), about 1 long: a thin shaft and a stone point, and
 * three red and white feathers at the back if it's fletched (a bare one has none). The bird hunt
 * flies these too.
 */
export function arrowModel(fletched: boolean): THREE.Object3D {
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.88, 6),
    new THREE.MeshLambertMaterial({ color: fletched ? 0xb98a52 : 0xd3ad78 }),
  );
  shaft.rotation.x = Math.PI / 2;
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.14, 6),
    new THREE.MeshLambertMaterial({ color: 0x5d5f63, flatShading: true }),
  );
  point.rotation.x = Math.PI / 2;
  point.position.z = 0.48;
  arrow.add(shaft, point);
  if (fletched) {
    const colors = [0xc8402c, 0xf2ede2, 0xc8402c];
    colors.forEach((color, index) => {
      const vane = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.07, 0.2),
        new THREE.MeshLambertMaterial({ color }),
      );
      const turn = (index / colors.length) * Math.PI * 2;
      vane.position.set(Math.sin(turn) * 0.045, Math.cos(turn) * 0.045, -0.33);
      vane.rotation.z = -turn;
      arrow.add(vane);
    });
  }
  return arrow;
}

/** The feather colours of a duster, a mixed bag from the bucket. */
const DUSTER_COLORS = [0xf2ede2, 0xc8402c, 0x3f7fd0, 0xe9b824, 0x2b2622, 0xd8cdb8];

/**
 * A feather duster of an arrow (Fletching's bucket), lying along z like `arrowModel`, about 1 long:
 * the same shaft and point, and its back third bristling with `feathers` feathers at every angle,
 * tarred black where they stick. Ridiculous on purpose. The same feathers every time.
 */
export function dusterModel(feathers: number): THREE.Object3D {
  const arrow = arrowModel(false);
  const tar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6),
    new THREE.MeshLambertMaterial({ color: 0x1b1612 }),
  );
  tar.rotation.x = Math.PI / 2;
  tar.position.z = -0.29;
  arrow.add(tar);
  const geometry = new THREE.PlaneGeometry(0.07, 0.24);
  // Its base at the shaft, sticking out along +y.
  geometry.translate(0, 0.12, 0);
  const materials = DUSTER_COLORS.map(
    (color) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }),
  );
  const rng = new Rng(17);
  for (let index = 0; index < feathers; index++) {
    const material = materials[index % materials.length] ?? materials[0];
    const feather = new THREE.Mesh(geometry, material);
    // Anywhere along the tarred end, pointing any which way out of it.
    feather.position.z = rng.range(-0.44, -0.14);
    feather.rotation.set(rng.range(-1.2, 1.2), rng.range(0, Math.PI), rng.range(0, Math.PI * 2));
    arrow.add(feather);
  }
  return arrow;
}

/** How far a piece hops up out of where it came from, in pixels. */
const POP_HEIGHT = 28;
/** How far the lid swings open, in radians. */
const LID_OPEN = 1.7;
/** Springs: stiffness and damping. The lid overshoots a little and bounces when it slams; the
 * chest's wobble rings for a moment. */
const LID_SPRING = { stiffness: 220, damping: 16 };
const WOBBLE_SPRING = { stiffness: 380, damping: 6 };
export interface HudDeps {
  game: Game;
  /** The item this station collects, which the chest counts. */
  item: string;
  haptics: Haptics;
  logger: EventLogger;
}

/** A point on the screen, in CSS pixels from the HUD's top-left corner. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Items already in the warchest that the chest holds back from its count until they fly in. */
export interface Deposit {
  /**
   * Sends the items flying into the chest from these points (e.g. each stump on screen), one piece
   * after another. `onLeave` hears each piece set off, with the index of the point it left from,
   * so the station can take that item away right then (e.g. a stave off the top of a heap).
   */
  pour(from: ScreenPoint[], onLeave?: (source: number) => void): void;
}

interface Flight {
  mesh: THREE.Object3D;
  from: THREE.Vector2;
  share: number;
  /** The item it is (the station's own, or another it banked, e.g. moss off a tree). */
  item: string;
  /** Its size when it's in flight at full scale. */
  baseScale: number;
  /** Told each piece's share of its deposit as it lands. */
  onArrive: ((share: number) => void) | undefined;
  amount: number;
  launchAt: number;
  spin: THREE.Vector3;
  /** Which of the pour's points it leaves from, told to `onLeave` once as it sets off. */
  source: number;
  onLeave: ((source: number) => void) | undefined;
  left: boolean;
}

/**
 * The warchest in a station's HUD, top-right: a small 3D chest showing how many of the station's
 * item the warchest holds. Deposits pour in: pieces hop out of where they came from, arc into the
 * chest one after another, the lid opens, each one bumps the chest with a clunk and ticks the
 * count up, then the lid shuts. Tapping the chest pops its lid and opens the warchest panel over
 * the station. Shared by every station; the station says what it collects and where the items
 * come from on screen. Draws on its own transparent layer, only while something moves.
 */
export class WarchestHud {
  readonly #element: HTMLElement;
  readonly #game: Game;
  readonly #item: string;
  readonly #haptics: Haptics;
  readonly #pour: GameData['warchest']['pour'];
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.OrthographicCamera(0, 1, 0, -1, -500, 500);
  readonly #chest: THREE.Object3D;
  readonly #lid: THREE.Object3D | undefined;
  /** A piece model for each item poured so far, sized to fly. */
  readonly #pieces = new Map<string, THREE.Object3D>();
  readonly #log: THREE.Object3D;
  readonly #potion: THREE.Object3D;
  readonly #sfx = new Sfx();
  readonly #anchor: HTMLElement;
  readonly #count: HTMLElement;
  readonly #gain: HTMLElement;
  readonly #panel: WarchestPanel;
  readonly #unsubscribe: () => void;
  /** Items in the warchest the counts don't show yet, by item: they're still on their way in. */
  #held = new Map<string, number>();
  #flights: Flight[] = [];
  #arrived = 0;
  /** A pour is under way: the lid stays open until it finishes. */
  #pouring = false;
  /** The panel is open: the lid stays open too. */
  #open = false;
  #lid0 = 0;
  #lidVelocity = 0;
  #lidTarget = 0;
  #wobble = 0;
  #wobbleVelocity = 0;
  #closeAt: number | undefined;
  #slamTimer: number | undefined;
  #poured = 0;
  #bump = 0;
  #last = 0;
  #running = false;
  readonly #logger: EventLogger;

  private constructor(element: HTMLElement, deps: HudDeps, models: HudModels) {
    this.#element = element;
    this.#game = deps.game;
    this.#item = deps.item;
    this.#haptics = deps.haptics;
    this.#logger = deps.logger;
    this.#pour = deps.game.data.warchest.pour;
    this.#sfx.load(SOUNDS);

    this.#renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.domElement.className = 'warchest-layer';
    element.append(this.#renderer.domElement);
    // Given back while the station's hidden; once it's back, draw the chest again.
    this.#renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.#resize();
    });
    this.#scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a3a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 2, 3);
    this.#scene.add(sun);

    // The chest, seen from a little above and to the side, fitted and centred in its HUD box.
    const chest = new THREE.Group();
    const model = models.chest.clone(true);
    model.rotation.set(0.45, -0.55, 0);
    const turned = new THREE.Group();
    turned.add(model);
    turned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(turned);
    const size = box.getSize(new THREE.Vector3());
    const fit = CHEST_SIZE / Math.max(size.x, size.y, 0.001);
    const center = box.getCenter(new THREE.Vector3());
    turned.scale.setScalar(fit);
    turned.position.set(-center.x * fit, -center.y * fit, 0);
    chest.add(turned);
    this.#chest = chest;
    this.#lid = model.getObjectByName('lid');
    this.#scene.add(chest);
    this.#log = models.log;
    this.#potion = models.potion;

    this.#anchor = document.createElement('div');
    this.#anchor.className = 'warchest-hud';
    this.#anchor.setAttribute('role', 'button');
    this.#anchor.setAttribute('aria-label', 'Open the warchest');
    this.#count = document.createElement('div');
    this.#count.className = 'warchest-count';
    this.#gain = document.createElement('div');
    this.#gain.className = 'warchest-gain';
    this.#anchor.append(this.#count, this.#gain);
    this.#panel = new WarchestPanel(element, {
      highlight: this.#item,
      onClose: () => {
        this.#closePanel();
      },
    });
    element.append(this.#anchor);

    element.addEventListener('pointerdown', () => {
      this.#sfx.unlock();
    });
    // Press: the chest squashes under your finger. Tap: it opens, or closes if already open.
    this.#anchor.addEventListener('pointerdown', () => {
      this.#bump = Math.max(this.#bump, 0.5);
      this.#start();
    });
    this.#anchor.addEventListener('click', () => {
      if (this.#open) this.#closePanel();
      else this.#openPanel();
    });
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
    this.#unsubscribe = this.#game.onChange(() => {
      this.#showCount();
    });
    this.#resize();
  }

  static async create(element: HTMLElement, deps: HudDeps) {
    return new WarchestHud(element, deps, await loadHudModels());
  }

  /** Loads the models ahead of time (e.g. at the camp), so `create` doesn't wait for them. */
  static async preload(): Promise<void> {
    await loadHudModels();
  }

  /**
   * Call when `amount` items have just gone into the warchest: the count holds them back until
   * `pour` sends them in, so the player watches them arrive. `onArrive` hears each piece land,
   * with its share of the deposit (e.g. to tick in the XP the items earned).
   */
  hold(amount: number, onArrive?: (share: number) => void, item = this.#item): Deposit {
    this.#held.set(item, this.#heldOf(item) + amount);
    this.#showCount();
    let poured = false;
    return {
      pour: (from, onLeave) => {
        if (poured) return;
        poured = true;
        this.#startPour(item, amount, from, onArrive, onLeave);
      },
    };
  }

  /** Nothing on its way in: every deposit has landed. */
  get settled(): boolean {
    return this.#heldTotal() === 0 && this.#flights.length === 0;
  }

  #heldOf(item: string): number {
    return this.#held.get(item) ?? 0;
  }

  #heldTotal(): number {
    return [...this.#held.values()].reduce((sum, count) => sum + count, 0);
  }

  /** The item as it flies in (a log, a stave, a spear, moss …), sized by its look. */
  #pieceFor(item: string): THREE.Object3D {
    let piece = this.#pieces.get(item);
    if (piece) return piece;
    const look = this.#game.data.items.find((entry) => entry.id === item)?.look ?? 'round';
    piece = pieceModel(look, this.#log, this.#potion);
    const size = new THREE.Box3().setFromObject(piece).getSize(new THREE.Vector3());
    piece.scale.setScalar((PIECE_LENGTH * PIECE_LENGTHS[look]) / Math.max(size.z, size.x, 0.001));
    this.#pieces.set(item, piece);
    return piece;
  }

  /** Finishes any pour at once and shuts the panel (e.g. leaving the station). */
  settle(): void {
    for (const flight of this.#flights) this.#scene.remove(flight.mesh);
    this.#flights = [];
    this.#held.clear();
    this.#pouring = this.#open = false;
    this.#panel.hide();
    window.clearTimeout(this.#slamTimer);
    this.#lid0 = this.#lidTarget = this.#lidVelocity = 0;
    this.#wobble = this.#wobbleVelocity = this.#bump = 0;
    this.#closeAt = undefined;
    this.#applyLid();
    this.#showCount();
    this.#stop();
    this.#render();
  }

  /** The station's hidden: settle, and give the chest's WebGL context back to the browser. */
  sleep(): void {
    this.settle();
    releaseContext(this.#renderer, this.#logger, 'hud');
  }

  /** The station's shown again: ask for the context back (the chest draws once it's back). */
  wake(): void {
    restoreContext(this.#renderer);
  }

  dispose(): void {
    this.#unsubscribe();
    window.clearTimeout(this.#slamTimer);
    this.#stop();
    this.#renderer.dispose();
  }

  #startPour(
    item: string,
    amount: number,
    from: ScreenPoint[],
    onArrive: ((share: number) => void) | undefined,
    onLeave: ((source: number) => void) | undefined,
  ): void {
    const sources = from.length > 0 ? from : [this.#chestPoint()];
    const pieces = splitDeposit(amount, sources.length, this.#pour.maxPieces, this.#pour.stagger);
    const now = performance.now() / 1000;
    for (const piece of pieces) {
      const source = sources[piece.from] ?? this.#chestPoint();
      const model = this.#pieceFor(item);
      const mesh = model.clone(true);
      mesh.visible = false;
      this.#scene.add(mesh);
      this.#flights.push({
        mesh,
        from: new THREE.Vector2(source.x, source.y),
        item,
        baseScale: model.scale.x || 1,
        share: piece.share,
        onArrive,
        amount,
        launchAt: now + piece.delay,
        source: piece.from,
        onLeave,
        left: false,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(6 + Math.random() * 4),
      });
    }
    this.#arrived = 0;
    // The gain counts the station's own item: the chest's count is of that.
    if (item === this.#item) this.#poured += amount;
    this.#closeAt = undefined;
    this.#pouring = true;
    this.#updateLid();
    this.#start();
  }

  #openPanel(): void {
    this.#open = true;
    window.clearTimeout(this.#slamTimer);
    // The latch clicks, the lid springs open, the chest hops and rocks, and the panel bursts out.
    this.#sfx.play('chest-latch', 0.6, (Math.random() - 0.5) * 120);
    this.#updateLid();
    this.#lidVelocity += 4;
    this.#bump = 1.2;
    this.#kick(9);
    this.#haptics.pulse(this.#game.data.warchest.haptics.openMs);
    this.#panel.open(this.#rows(), this.#chestPoint());
    this.#sfx.play('panel-open', 0.5);
    this.#anchor.dataset.open = 'true';
    this.#start();
  }

  #closePanel(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#panel.close();
    this.#sfx.play('panel-close', 0.45);
    this.#anchor.dataset.open = 'false';
    // The lid slams once the panel has folded back in.
    window.clearTimeout(this.#slamTimer);
    this.#slamTimer = window.setTimeout(() => {
      this.#updateLid();
    }, PANEL_CLOSE_MS);
  }

  /** Opens or shuts the lid to match: open while pouring or while the panel is up. */
  #updateLid(): void {
    const target = this.#pouring || this.#open ? 1 : 0;
    if (target === this.#lidTarget) return;
    this.#lidTarget = target;
    if (target === 1) {
      this.#sfx.play('chest-open', 0.55);
    } else {
      this.#sfx.play('chest-close', 0.6);
      this.#bump = 1.4;
      this.#kick(4);
      this.#haptics.pulse(this.#game.data.warchest.haptics.slamMs);
    }
    this.#start();
  }

  /** Rocks the chest one way or the other, by up to `strength`. */
  #kick(strength: number): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    this.#wobbleVelocity += side * strength * (0.6 + Math.random() * 0.4);
  }

  /** The warchest's rows, holding back items still on their way in. */
  #rows() {
    const { inventory } = this.#game;
    return warchestRows(this.#game.data, {
      count: (item) => Math.max(inventory.count(item) - this.#heldOf(item), 0),
    });
  }

  #frame(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.#last, 0.05);
    this.#last = now;
    const { popSeconds, flightSeconds, arcHeight, closeDelay } = this.#pour;
    // Into the open mouth, just above the chest's middle.
    const target = this.#chestPoint();
    target.y -= 6;
    for (const flight of [...this.#flights]) {
      const t = now - flight.launchAt;
      if (t < 0) continue;
      if (!flight.left) {
        flight.left = true;
        flight.onLeave?.(flight.source);
      }
      const mesh = flight.mesh;
      mesh.visible = true;
      let x: number;
      let y: number;
      let scale: number;
      const hopTop = { x: flight.from.x, y: flight.from.y - POP_HEIGHT };
      if (t < popSeconds) {
        // Hop out of the source, growing in.
        const p = t / popSeconds;
        const eased = 1 - (1 - p) ** 2;
        x = flight.from.x;
        y = flight.from.y - POP_HEIGHT * eased;
        scale = 0.3 + 0.7 * eased;
      } else {
        // Arc into the chest, speeding up as it goes in.
        const p = Math.min((t - popSeconds) / flightSeconds, 1);
        const eased = p ** 1.7;
        const control = {
          x: (hopTop.x + target.x) / 2,
          y:
            Math.min(hopTop.y, target.y) -
            Math.hypot(target.x - hopTop.x, target.y - hopTop.y) * arcHeight,
        };
        const a = 1 - eased;
        x = a * a * hopTop.x + 2 * a * eased * control.x + eased * eased * target.x;
        y = a * a * hopTop.y + 2 * a * eased * control.y + eased * eased * target.y;
        scale = 1 - 0.35 * eased;
        if (p >= 1) {
          this.#land(flight);
          continue;
        }
      }
      mesh.position.set(x, -y, 50);
      mesh.scale.setScalar(flight.baseScale * scale);
      mesh.rotation.x += flight.spin.x * dt;
      mesh.rotation.y += flight.spin.y * dt;
      mesh.rotation.z += flight.spin.z * dt;
    }
    if (this.#flights.length === 0 && this.#pouring) {
      this.#closeAt ??= now + closeDelay;
      if (now >= this.#closeAt) this.#finishPour();
    }
    this.#lidVelocity +=
      (LID_SPRING.stiffness * (this.#lidTarget - this.#lid0) -
        LID_SPRING.damping * this.#lidVelocity) *
      dt;
    this.#lid0 += this.#lidVelocity * dt;
    if (this.#lid0 < 0) {
      // Slammed shut: bounce off the chest a little.
      this.#lid0 = 0;
      if (this.#lidVelocity < 0) this.#lidVelocity *= -0.3;
    }
    this.#wobbleVelocity +=
      (-WOBBLE_SPRING.stiffness * this.#wobble - WOBBLE_SPRING.damping * this.#wobbleVelocity) * dt;
    this.#wobble += this.#wobbleVelocity * dt;
    this.#bump *= Math.exp(-9 * dt);
    this.#applyLid();
    this.#render();
    const settled =
      this.#flights.length === 0 &&
      !this.#pouring &&
      Math.abs(this.#lidTarget - this.#lid0) < 0.01 &&
      Math.abs(this.#lidVelocity) < 0.05 &&
      Math.abs(this.#wobble) < 0.002 &&
      Math.abs(this.#wobbleVelocity) < 0.02 &&
      this.#bump < 0.01;
    if (settled) this.#stop();
  }

  #land(flight: Flight): void {
    this.#scene.remove(flight.mesh);
    this.#flights = this.#flights.filter((other) => other !== flight);
    this.#held.set(flight.item, Math.max(this.#heldOf(flight.item) - flight.share, 0));
    this.#arrived += 1;
    flight.onArrive?.(flight.share / flight.amount);
    this.#bump = 1;
    this.#kick(2.5);
    this.#showCount();
    // Each piece lands a little higher in pitch, so a long pour climbs.
    this.#sfx.play(
      `log-in-${1 + Math.floor(Math.random() * 3)}`,
      0.55,
      Math.min(this.#arrived * 35, 700) + (Math.random() - 0.5) * 80,
    );
  }

  /** The last piece is in: show the gain, and shut the lid unless the panel is open. */
  #finishPour(): void {
    this.#pouring = false;
    this.#closeAt = undefined;
    this.#updateLid();
    this.#gain.textContent = this.#poured > 0 ? `+${String(this.#poured)}` : '';
    this.#poured = 0;
    // Restart the gain and glow animations.
    for (const [element, name] of [
      [this.#gain, 'warchest-gain-show'],
      [this.#count, 'warchest-count-glow'],
    ] as const) {
      element.classList.remove(name);
      element.getBoundingClientRect();
      element.classList.add(name);
    }
  }

  #applyLid(): void {
    if (this.#lid) this.#lid.rotation.x = -LID_OPEN * this.#lid0;
    const squash = this.#bump;
    this.#chest.scale.set(1 + 0.12 * squash, 1 - 0.16 * squash, 1 + 0.12 * squash);
    this.#chest.rotation.z = this.#wobble;
  }

  #showCount(): void {
    const shown = Math.max(this.#game.inventory.count(this.#item) - this.#heldOf(this.#item), 0);
    this.#count.textContent = String(shown);
    this.#anchor.dataset.count = String(shown);
    this.#anchor.dataset.settled = String(this.settled);
    this.#panel.update(this.#rows());
  }

  /** Centre of the chest on screen: wherever the CSS puts the HUD anchor. */
  #chestPoint(): ScreenPoint {
    const box = this.#anchor.getBoundingClientRect();
    const parent = this.#element.getBoundingClientRect();
    return {
      x: box.right - parent.left - CHEST_SIZE / 2,
      y: (box.top + box.bottom) / 2 - parent.top,
    };
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    Object.assign(this.#camera, { left: 0, right: width, top: 0, bottom: -height });
    this.#camera.updateProjectionMatrix();
    const at = this.#chestPoint();
    this.#chest.position.set(at.x, -at.y, 0);
    this.#showCount();
    this.#render();
  }

  #render(): void {
    this.#renderer.render(this.#scene, this.#camera);
  }

  #start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#last = performance.now() / 1000;
    this.#renderer.setAnimationLoop(() => {
      this.#frame();
    });
  }

  #stop(): void {
    this.#running = false;
    this.#renderer.setAnimationLoop(null);
  }
}
