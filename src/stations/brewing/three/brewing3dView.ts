import * as THREE from 'three';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import type { ScreenView } from '../../../app/screen';
import { Sfx, type SoundLoop } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { WarchestHud, pieceModel, type Deposit, type ScreenPoint } from '../../../app/warchestHud';
import type { EventLogger, Game, LiveTuning } from '../../../core';
import type { BrewingFeel, ItemLook } from '../../../data';
import { BrewRound, WATER, type BrewEvent, type BrewResult, type ShelfEntry } from '../logic/brew';
import { labToHex, labToRgb, type Lab } from '../logic/color';
import { mapPoint, mapScale } from '../logic/map';
import { reachBar, reachCells, type Reach } from '../logic/reach';

export interface Brewing3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<BrewingFeel>;
  haptics: Haptics;
  /** Leaves the station (the end card's Back to camp). */
  onLeave: () => void;
}

const DEG = Math.PI / 180;
/** The pot: its radius at the rim, and how high the rim sits. */
const POT_RADIUS = 1.05;
const RIM_Y = 1.2;
/** The liquid: from this far below the rim when there's one drop to just under it when full. */
const LIQUID_LOW = 0.55;
const LIQUID_HIGH = 0.12;
/** Pixels across the canvas the liquid's surface is drawn on. */
const SURFACE_PX = 512;
/** The camera: how far it looks down, how far back it sits, where it looks, and its lift. */
const CAMERA_ELEVATION = 58 * DEG;
const CAMERA_DISTANCE = 7.2;
const CAMERA_TARGET = new THREE.Vector3(0, 0.9, 0);
const CAMERA_LIFT = 0.02;
/** The colour map's background is drawn this many cells across (smoothed up to its size). */
const MAP_CELLS = 40;
/** The lightness bar's reach is worked out this many rows down (smoothed up to its size). */
const BAR_ROWS = 48;
/** The map's star rings: the 3-star ring gold, the outer two paler; grey once out of reach. */
const RING_COLORS = ['#f2c14e', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.5)'];
const RING_OUT = 'rgba(70,64,58,0.75)';
/**
 * What the pot can no longer reach: the map's colour pulled toward a dark grey, `half` of the
 * way where only 2 stars can still be had there, `share` of the way past that.
 */
const OUT_OF_REACH = { r: 46, g: 42, b: 38, half: 0.42, share: 0.74 };
/** The shelf's icons: drawn this many pixels square from the warchest's item pieces. */
const ICON_PX = 128;
/** How each look sits in its icon (the pieces lie along z, as they fly into the chest). */
const ICON_POSES: Partial<Record<ItemLook, [number, number, number]>> = {
  cap: [-Math.PI / 2, 0, 0],
  heap: [-Math.PI / 2, 0, 0],
  leaf: [0, Math.PI / 4, 0.3],
};
/** Seconds a dropped ingredient takes to shrink into the pot from the finger. */
const DROP_IN_SECONDS = 0.16;
/** An empty pot's dark iron, and what a drop looks like falling in. */
const EMPTY_POT = '#1d1a17';
const SOUNDS: Record<string, string> = {
  'fire-loop': 'audio/firemaking/fire-loop.mp3',
  'steam-1': 'audio/firemaking/steam-1.mp3',
  'steam-2': 'audio/firemaking/steam-2.mp3',
  'press-click': 'audio/splitting/press-click.mp3',
  'press-clunk': 'audio/splitting/press-clunk.mp3',
  'chop-2': 'audio/woodcutting/chop-2.mp3',
  star: 'audio/woodcutting/star.mp3',
};
const COLORS = {
  sky: 0xb4cfa8,
  iron: 0x2b2b2d,
  rim: 0x4a4a4e,
  stone: 0x8a8680,
  log: 0x6a4a30,
  coal: 0xff5a14,
  spoon: 0xb08354,
};

/** A drop on its way from the shelf into the pot, or a ladleful rising out of it. */
interface Falling {
  mesh: THREE.Mesh;
  at: number;
  up?: boolean;
}

/** A shelf tile: the ingredient's colour behind its icon, its name and how many are left. */
interface Tile {
  element: HTMLButtonElement;
  icon: HTMLImageElement;
  count: HTMLElement;
  key: string;
}

/** An ingredient being dragged off the shelf: lifted once the finger has moved far enough. */
interface Drag {
  id: string;
  pointerId: number;
  tile: Tile;
  from: ScreenPoint;
  ghost: HTMLImageElement | undefined;
  over: boolean;
}

/**
 * The cauldron: a pot over a small fire, a shelf of ingredients below it and the recipe card
 * above. Tap the shelf to drop things in, drag round the pot to stir, bottle when the colour
 * matches the card. The rules live in BrewRound; this draws them.
 */
export class Brewing3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Brewing3DDeps;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #fireSound: SoundLoop;
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #ui: ReturnType<Brewing3DView['buildUi']>;
  #round: BrewRound | undefined;
  /** The liquid's surface: drawn on a canvas each frame (stirred colour and swirls). */
  readonly #surface = document.createElement('canvas');
  readonly #surfaceContext: CanvasRenderingContext2D;
  readonly #surfaceTexture: THREE.CanvasTexture;
  readonly #liquid: THREE.Mesh;
  readonly #spoon = new THREE.Group();
  readonly #coals: THREE.PointLight;
  #falling: Falling[] = [];
  /** Where the swirls have turned to: the stirring, and a slow drift of their own. */
  #swirlTurn = 0;
  #stirDirection = 1;
  /** The finger stirring: its last angle round the pot's middle on screen. */
  #pointer: { id: number; angle: number | undefined } | undefined;
  #spoonAngle = -60 * DEG;
  #quarterTurns = 0;
  #bankedXp: XpDeposit | undefined;
  #deposits: Deposit[] = [];
  #lastPhase = '';
  #flashText: { text: string; until: number } | undefined;
  /**
   * The map's background (colours at the target's lightness, dimmed where the pot can't reach)
   * and the lightness bar's dimming: repainted when the reach changes, which is every drop.
   */
  readonly #mapCells = document.createElement('canvas');
  readonly #barMask = document.createElement('canvas');
  #paintedReach: Reach | undefined;
  /** The shelf's icons by shelf id (data URLs), drawn once. */
  readonly #icons = new Map<string, string>();
  #tiles = new Map<string, Tile>();
  #drag: Drag | undefined;

  private constructor(element: HTMLElement, deps: Brewing3DDeps, hud: WarchestHud) {
    this.#element = element;
    this.#deps = deps;
    this.#hud = hud;
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'brewing');
    this.#skill = station?.skill ?? 'alchemy';
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.domElement.className = 'br-canvas';
    element.append(this.#renderer.domElement);
    this.#surface.width = this.#surface.height = SURFACE_PX;
    const context = this.#surface.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    this.#surfaceContext = context;
    this.#surfaceTexture = new THREE.CanvasTexture(this.#surface);
    this.#surfaceTexture.colorSpace = THREE.SRGBColorSpace;
    // Unlit, so the colour you see is the colour that counts.
    this.#liquid = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.#surfaceTexture }),
    );
    this.#coals = new THREE.PointLight(0xff7a30, 6, 4);
    this.#ui = this.buildUi();
    this.#buildWorld();
    this.#sfx.load(SOUNDS);
    this.#fireSound = this.#sfx.loop('fire-loop');
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Brewing3DDeps): Promise<Brewing3DView> {
    const potion = deps.game.data.brewing.potions[0];
    const recipe = deps.game.data.recipes.find((entry) => entry.id === potion?.recipe);
    const item = recipe?.outputs[0]?.item;
    if (!item) throw new Error('The brewing recipe makes nothing');
    const hud = await WarchestHud.create(element, {
      game: deps.game,
      item,
      haptics: deps.haptics,
      logger: deps.logger,
    });
    return new Brewing3DView(element, deps, hud);
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
    this.#startBrew();
    this.#timer.reset();
    this.#fireSound.setVolume(0.25);
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#round?.exit();
    this.#round = undefined;
    this.#fireSound.setVolume(0);
    this.#hud.sleep();
    this.#skillBar.settle();
    this.#bankedXp = undefined;
    this.#deposits = [];
    this.#clearFalling();
    this.#cancelDrag();
    delete document.body.dataset.brewing;
    this.#lastPhase = '';
    releaseContext(this.#renderer, this.#deps.logger, 'brewing3d');
  }

  // Brews

  #startBrew(): void {
    const { game } = this.#deps;
    const rules = game.data.brewing;
    const potion = rules.potions[0];
    if (!potion) throw new Error('No potions to brew');
    const recipe = game.data.recipes.find((entry) => entry.id === potion.recipe);
    this.#ui.card.hidden = true;
    this.#clearFalling();
    this.#cancelDrag();
    this.#swirlTurn = 0;
    this.#quarterTurns = 0;
    this.#paintedReach = undefined;
    this.#round = new BrewRound(
      rules,
      potion,
      {
        logger: this.#deps.logger,
        feel: () => this.#deps.feel.values,
        stock: (item) => game.inventory.count(item),
        take: (item) => {
          game.removeItems(item, 1);
        },
        bank: (potions, refund) => {
          const before = game.xp(this.#skill);
          const result = game.craft(potion.recipe, { yield: potions, xpYield: 1 });
          if (refund) game.addItems(refund, 1);
          this.#bankedXp = this.#skillBar.hold(game.xp(this.#skill) - before);
          return result.produced.reduce((sum, stack) => sum + stack.count, 0);
        },
        onEvent: (event) => {
          this.#onEvent(event);
        },
      },
      Date.now() >>> 0,
    );
    const name =
      game.data.items.find((item) => item.id === recipe?.outputs[0]?.item)?.name ?? 'Potion';
    this.#ui.cardName.textContent = name;
    this.#ui.target.style.background = labToHex(this.#round.target);
    this.#element.dataset.target = labToHex(this.#round.target);
    this.#buildShelf(this.#round);
  }

  // The colour map

  /**
   * The map's background: every a and b at the target's lightness, as the eye would see it,
   * half dimmed where the nearest pot the pot can still become is only within the 2-star band of
   * it, and dark past that (see src/stations/brewing/logic/reach.ts). The lightness bar's dimming
   * is worked out the same way.
   */
  #paintReach(round: BrewRound): void {
    this.#paintedReach = round.reach;
    const { map, target, rules } = round;
    const { three, two } = rules.stars;
    const within = two;
    const shareAt = (distance: number) =>
      distance <= three ? 0 : distance <= two ? OUT_OF_REACH.half : OUT_OF_REACH.share;
    const cells = this.#mapCells;
    cells.width = cells.height = MAP_CELLS;
    const context = cells.getContext('2d');
    if (!context) return;
    const near = reachCells(map, round.reach.colors, target.L, within, MAP_CELLS);
    const image = context.createImageData(MAP_CELLS, MAP_CELLS);
    for (let row = 0; row < MAP_CELLS; row++) {
      for (let column = 0; column < MAP_CELLS; column++) {
        const a = map.a - map.half + ((column + 0.5) / MAP_CELLS) * map.half * 2;
        const b = map.b + map.half - ((row + 0.5) / MAP_CELLS) * map.half * 2;
        const [r, g, bl] = labToRgb({ L: target.L, a, b });
        const cell = row * MAP_CELLS + column;
        const share = shareAt(near[cell] ?? Infinity);
        const dim = (channel: number, to: number) => channel * 255 * (1 - share) + to * share;
        const at = cell * 4;
        image.data[at] = dim(r, OUT_OF_REACH.r);
        image.data[at + 1] = dim(g, OUT_OF_REACH.g);
        image.data[at + 2] = dim(bl, OUT_OF_REACH.b);
        image.data[at + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const mask = this.#barMask;
    mask.width = 1;
    mask.height = BAR_ROWS;
    const barContext = mask.getContext('2d');
    if (!barContext) return;
    const bar = reachBar(map, round.reach.colors, target.a, target.b, within, BAR_ROWS);
    const rows = barContext.createImageData(1, BAR_ROWS);
    bar.forEach((distance, row) => {
      const at = row * 4;
      rows.data[at] = OUT_OF_REACH.r;
      rows.data[at + 1] = OUT_OF_REACH.g;
      rows.data[at + 2] = OUT_OF_REACH.b;
      rows.data[at + 3] = shareAt(distance) * 255;
    });
    barContext.putImageData(rows, 0, 0);
  }

  /** Sizes a canvas's pixels to its size on screen. Returns its context and size in px. */
  #fit(canvas: HTMLCanvasElement): { context: CanvasRenderingContext2D; w: number; h: number } {
    const ratio = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, w, h };
  }

  /**
   * The map: the target as rings (inside the inner one is 3 stars, then 2, then 1), the shelf's
   * colours round the edge, and the pot as a cloud of its drops that stirring draws in to a crisp
   * dot at its true colour. The bar beside it is lightness: the target's band and the pot's mark.
   */
  #drawMap(round: BrewRound): void {
    const ui = this.#ui;
    const feel = this.#deps.feel.values;
    const { map, target, rules } = round;
    if (round.reach !== this.#paintedReach) this.#paintReach(round);
    const { context, w, h } = this.#fit(ui.map);
    if (w === 0) return;
    context.imageSmoothingEnabled = true;
    context.drawImage(this.#mapCells, 0, 0, w, h);
    const clamp = (value: number) => Math.min(Math.max(value, 0.04), 0.96);
    const at = (color: Lab) => {
      const point = mapPoint(map, color);
      return { x: clamp(point.x) * w, y: clamp(point.y) * h };
    };
    // Grey (no colour at all), where ash and water pull toward.
    const grey = at({ L: target.L, a: 0, b: 0 });
    context.strokeStyle = 'rgba(0,0,0,0.25)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(grey.x - 4, grey.y);
    context.lineTo(grey.x + 4, grey.y);
    context.moveTo(grey.x, grey.y - 4);
    context.lineTo(grey.x, grey.y + 4);
    context.stroke();
    // The shelf's colours: where each drop pulls the pot toward.
    for (const entry of round.shelf) {
      if (Math.hypot(entry.color.a, entry.color.b) < 0.03) continue;
      const point = at(entry.color);
      context.fillStyle = entry.hex;
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(0,0,0,0.7)';
      context.lineWidth = 3.5;
      context.stroke();
      context.strokeStyle = '#fff';
      context.lineWidth = 1.5;
      context.stroke();
    }
    // The target's rings: a ring the pot can no longer get inside goes grey and dashed.
    const middle = at(target);
    const bands = [rules.stars.three, rules.stars.two, rules.stars.one];
    const best = round.reach.best.distance;
    bands.forEach((band, index) => {
      const inReach = best <= band;
      context.setLineDash(inReach ? [] : [3, 3]);
      context.strokeStyle = inReach ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.2)';
      context.lineWidth = index === 0 ? 3.5 : 2.5;
      context.beginPath();
      context.arc(middle.x, middle.y, mapScale(map, band) * w, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = inReach ? (RING_COLORS[index] ?? '#fff') : RING_OUT;
      context.lineWidth = index === 0 ? 2 : 1;
      context.stroke();
    });
    context.setLineDash([]);
    // The pot: a soft white haze over its unstirred drops (white reads on every colour), drawn
    // in to a crisp dot at the true colour as it's stirred.
    const cloud = round.cloud;
    const total = cloud.reduce((sum, point) => sum + point.weight, 0);
    for (const point of cloud) {
      if (point.unmixed <= 0.02) continue;
      const spot = at(point.color);
      const radius = 3 + feel.cloudPx * point.unmixed;
      const glow = context.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, radius);
      const alpha = Math.min(0.4 + (point.weight / Math.max(total, 1e-6)) * 1.5, 0.9);
      glow.addColorStop(0, `rgba(255,255,255,${String(alpha)})`);
      glow.addColorStop(0.6, `rgba(255,255,255,${String(alpha * 0.5)})`);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    const mixed = round.mixed;
    if (mixed && round.unmixed < 0.5) {
      const dot = at(mixed);
      context.globalAlpha = 1 - round.unmixed * 2;
      context.fillStyle = labToHex(mixed);
      context.strokeStyle = '#fff';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(dot.x, dot.y, 4.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.strokeStyle = 'rgba(0,0,0,0.6)';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(dot.x, dot.y, 6, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }
    this.#drawLightness(round);
    ui.mapRing.textContent =
      round.fill === 0
        ? 'Match the rings'
        : !round.revealed
          ? 'Stir to see'
          : round.ring > 0
            ? `${'★'.repeat(round.ring)} ring`
            : 'Outside the rings';
    ui.mapRing.dataset.ring = round.revealed ? String(round.ring) : '';
    this.#element.dataset.ring = round.revealed ? String(round.ring) : '';
    // The moment a star goes out of reach, say so (the ring above goes grey with it).
    const stars = round.bestStars;
    ui.mapBest.textContent =
      round.fill === 0 || stars >= 3
        ? ''
        : stars > 0
          ? `Best still possible: ${'★'.repeat(stars)}`
          : 'Every ring is out of reach';
    ui.mapBest.dataset.best = String(stars);
  }

  /** The lightness bar: dark at the bottom, light at the top, the target's bands and the pot. */
  #drawLightness(round: BrewRound): void {
    const { map, target, rules } = round;
    const { context, w, h } = this.#fit(this.#ui.mapBar);
    if (w === 0) return;
    const y = (L: number) => (1 - Math.min(Math.max(mapPoint(map, { L, a: 0, b: 0 }).l, 0), 1)) * h;
    const shade = context.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, labToHex({ L: map.high, a: target.a, b: target.b }));
    shade.addColorStop(1, labToHex({ L: map.low, a: target.a, b: target.b }));
    context.fillStyle = shade;
    context.fillRect(0, 0, w, h);
    // Dimmed where the pot can't reach, as on the map.
    context.imageSmoothingEnabled = true;
    context.drawImage(this.#barMask, 0, 0, w, h);
    // The target's bands, as the rings are on the map.
    const bands = [rules.stars.one, rules.stars.two, rules.stars.three];
    const best = round.reach.best.distance;
    bands.forEach((band, index) => {
      context.fillStyle =
        best > band
          ? 'rgba(70,64,58,0.35)'
          : index === 2
            ? 'rgba(242,193,78,0.9)'
            : `rgba(255,255,255,${String(0.18 + index * 0.12)})`;
      const top = y(target.L + band);
      context.fillRect(0, top, w, y(target.L - band) - top);
    });
    context.fillStyle = '#000';
    context.fillRect(0, y(target.L) - 1, w, 2);
    // The pot: a smudge per unstirred drop, a crisp notch once stirred.
    for (const point of round.cloud) {
      if (point.unmixed <= 0.02) continue;
      context.fillStyle = `rgba(255,255,255,${String(0.25 + 0.4 * point.unmixed)})`;
      const spread = 1 + 6 * point.unmixed;
      context.fillRect(-1, y(point.color.L) - spread / 2, w + 2, spread);
    }
    const mixed = round.mixed;
    if (mixed && round.unmixed < 0.5) {
      const notch = y(mixed.L);
      context.fillStyle = '#fff';
      context.strokeStyle = '#000';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, notch - 4);
      context.lineTo(w, notch);
      context.lineTo(0, notch + 4);
      context.closePath();
      context.fill();
      context.stroke();
    }
  }

  #onEvent(event: BrewEvent): void {
    const feel = this.#deps.feel.values;
    if (event.type === 'drop') {
      this.#dropIn(event.drop.id);
      this.#deps.haptics.pulse(feel.buzzDropMs);
      this.#play('press-click', 0.3, 300);
    } else if (event.type === 'full') {
      this.#flash('The pot is full: stir it and bottle it');
      this.#play('chop-2', 0.25, -300);
    } else if (event.type === 'empty') {
      this.#flash(`No ${this.#name(event.id).toLowerCase()} left in the warchest`);
      this.#play('chop-2', 0.25, -300);
    } else if (event.type === 'ladle') {
      this.#scoopOut();
      this.#deps.haptics.pulse(feel.buzzDropMs);
      this.#play('press-click', 0.3, -500);
      this.#play('steam-1', 0.2, 300);
      this.#flash(`Scooped out ${formatFill(event.scooped)}: room for more`);
    } else if (event.type === 'reach') {
      const round = this.#round;
      if (event.stars < event.was) {
        const lost = event.stars > 0 ? `${'★'.repeat(event.was)} is` : 'Every ring is';
        const ladle = round?.canLadle ? ': the ladle frees room' : '';
        this.#flash(`${lost} out of reach now${ladle}`);
        this.#play('chop-2', 0.2, -700);
      } else {
        this.#flash(`${'★'.repeat(event.stars)} is back in reach`);
        this.#play('star', 0.3);
      }
    } else {
      this.#bottled(event);
    }
  }

  /** A drop falls from above the rim into the pot, in its own colour. */
  #dropIn(id: string): void {
    const round = this.#round;
    if (!round) return;
    const entry = round.entry(id);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(entry.hex) }),
    );
    mesh.position.set(0, RIM_Y + 1.4, 0);
    this.#scene.add(mesh);
    this.#falling.push({ mesh, at: round.now });
  }

  /** A ladleful lifts out of the pot in its colour (what's scooped is lost). */
  #scoopOut(): void {
    const round = this.#round;
    const mixed = round?.mixed;
    if (!round || !mixed) return;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(labToHex(mixed)), transparent: true }),
    );
    mesh.position.copy(this.#liquid.position);
    this.#scene.add(mesh);
    this.#falling.push({ mesh, at: round.now, up: true });
  }

  #clearFalling(): void {
    for (const falling of this.#falling) this.#scene.remove(falling.mesh);
    this.#falling = [];
  }

  /** Bottled: the potions and anything given back pour into the chest from the pot. */
  #bottled(result: BrewResult): void {
    const feel = this.#deps.feel.values;
    this.#deps.haptics.pulse(feel.buzzBottleMs);
    this.#play('press-clunk', 0.5, 200);
    this.#play(`steam-${String(1 + Math.floor(Math.random() * 2))}`, 0.4);
    const xp = this.#bankedXp;
    this.#bankedXp = undefined;
    this.#deposits = [];
    if (result.banked > 0)
      this.#deposits.push(this.#hud.hold(result.banked, (share) => xp?.arrive(share)));
    else xp?.arrive(1);
    if (result.refund) this.#deposits.push(this.#hud.hold(1, undefined, result.refund));
    this.#showCard(result);
    const from = [this.#potOnScreen()];
    for (const deposit of this.#deposits) deposit.pour(from);
    this.#deposits = [];
  }

  // World

  #buildWorld(): void {
    const rules = this.#deps.game.data.brewing;
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sun.position.set(3, 8, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.#scene.add(sun);
    this.#scene.add(groundMesh('meadowGrass', 40, 40));
    const yard = rules.yard.radius * 2;
    const worn = wornGround('troddenDirt', yard, yard, {
      cover: rules.yard.wear,
      round: true,
      seed: 11,
    });
    worn.position.y = 0.004;
    this.#scene.add(worn);
    // The pot: an iron bowl (a lathe, round-bellied) on three stones over a little fire.
    const profile = [
      new THREE.Vector2(0.001, 0.12),
      new THREE.Vector2(0.55, 0.14),
      new THREE.Vector2(0.95, 0.4),
      new THREE.Vector2(1.12, 0.8),
      new THREE.Vector2(POT_RADIUS + 0.04, RIM_Y - 0.06),
      new THREE.Vector2(POT_RADIUS + 0.1, RIM_Y),
      new THREE.Vector2(POT_RADIUS - 0.02, RIM_Y + 0.02),
      new THREE.Vector2(POT_RADIUS - 0.06, RIM_Y - 0.08),
      new THREE.Vector2(1.04, 0.8),
      new THREE.Vector2(0.88, 0.42),
      new THREE.Vector2(0.5, 0.2),
      new THREE.Vector2(0.001, 0.18),
    ];
    const pot = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 40),
      new THREE.MeshStandardMaterial({ color: COLORS.iron, roughness: 0.6, metalness: 0.5 }),
    );
    pot.castShadow = true;
    pot.position.y = 0.25;
    this.#scene.add(pot);
    const stone = new THREE.MeshLambertMaterial({ color: COLORS.stone, flatShading: true });
    for (let index = 0; index < 3; index++) {
      const around = (index / 3) * Math.PI * 2 + 0.4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), stone);
      rock.position.set(Math.cos(around) * 0.75, 0.15, Math.sin(around) * 0.75);
      rock.castShadow = true;
      this.#scene.add(rock);
    }
    const wood = new THREE.MeshLambertMaterial({ color: COLORS.log });
    for (let index = 0; index < 3; index++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8), wood);
      log.rotation.set(Math.PI / 2, 0, (index / 3) * Math.PI);
      log.position.y = 0.09;
      this.#scene.add(log);
    }
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLORS.coal, transparent: true, opacity: 0.8 }),
    );
    glow.position.y = 0.02;
    this.#scene.add(glow);
    this.#coals.position.set(0, 0.3, 0);
    this.#scene.add(this.#coals);
    this.#liquid.position.y = 0.25 + RIM_Y - LIQUID_LOW;
    this.#liquid.visible = false;
    this.#scene.add(this.#liquid);
    // The spoon: a wooden paddle dipped in the pot, following the stirring finger.
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.04, 1.1, 8),
      new THREE.MeshLambertMaterial({ color: COLORS.spoon }),
    );
    handle.position.y = 0.55;
    handle.castShadow = true;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.3, 0.04),
      new THREE.MeshLambertMaterial({ color: COLORS.spoon }),
    );
    blade.position.y = 0.05;
    const tilted = new THREE.Group();
    tilted.add(handle, blade);
    tilted.rotation.z = -14 * DEG;
    this.#spoon.add(tilted);
    this.#scene.add(this.#spoon);
  }

  // Loop

  #loop(time: number): void {
    this.#timer.update(time);
    const dt = Math.min(this.#timer.getDelta(), 0.05);
    const round = this.#round;
    const feel = this.#deps.feel.values;
    if (round) {
      const before = round.stirTurns;
      round.tick(dt);
      const stirred = round.stirTurns - before;
      this.#swirlTurn += stirred * this.#stirDirection + feel.swirlDrift * dt;
      // A buzz each quarter turn of the spoon.
      const quarters = Math.floor(round.stirTurns * 4);
      if (quarters > this.#quarterTurns) {
        this.#quarterTurns = quarters;
        this.#deps.haptics.pulse(feel.buzzStirMs);
      }
    }
    this.#updateFalling(feel);
    this.#drawSurface(feel);
    this.#updateSpoon(dt);
    this.#coals.intensity = 5 + Math.sin(time / 180) * 0.8 + Math.sin(time / 67) * 0.5;
    this.#updateUi();
    this.#updateCamera();
    this.#renderer.render(this.#scene, this.#camera);
  }

  #updateFalling(feel: BrewingFeel): void {
    const round = this.#round;
    const now = round?.now ?? 0;
    for (const falling of [...this.#falling]) {
      const t = (now - falling.at) / feel.dropSeconds;
      if (t >= 1) {
        this.#scene.remove(falling.mesh);
        this.#falling = this.#falling.filter((other) => other !== falling);
        if (!falling.up) {
          this.#play(`steam-${String(1 + Math.floor(Math.random() * 2))}`, 0.15, 600);
        }
        continue;
      }
      if (falling.up) {
        // Out of the pot and away, fading.
        falling.mesh.position.y = this.#liquid.position.y + 1.6 * (1 - (1 - t) * (1 - t));
        const material = falling.mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 1 - t;
        continue;
      }
      falling.mesh.position.y = RIM_Y + 1.4 - (1.4 + 0.2) * t * t;
    }
  }

  /** The liquid's level, and its surface: the stirred colour with each unstirred drop swirling. */
  #drawSurface(feel: BrewingFeel): void {
    const round = this.#round;
    const fill = round?.fill ?? 0;
    this.#liquid.visible = fill > 0;
    if (!round || fill === 0) return;
    const level = fill / round.rules.maxFill;
    const below = LIQUID_LOW + (LIQUID_HIGH - LIQUID_LOW) * level;
    this.#liquid.position.y = 0.25 + RIM_Y - below;
    // The pot narrows a little below the rim.
    this.#liquid.scale.setScalar(POT_RADIUS * (0.98 - below * 0.12));
    const context = this.#surfaceContext;
    const size = SURFACE_PX;
    const middle = size / 2;
    context.fillStyle = round.shown ? labToHex(round.shown) : EMPTY_POT;
    context.fillRect(0, 0, size, size);
    context.lineCap = 'round';
    const turn = this.#swirlTurn * Math.PI * 2;
    round.drops.forEach((drop, index) => {
      // Still falling in.
      if (round.now - drop.at < feel.dropSeconds || drop.unmixed <= 0.002) return;
      const entry = round.entry(drop.id);
      context.strokeStyle = entry.hex;
      context.globalAlpha = Math.min(drop.unmixed * 1.1, 1);
      // A spiral arm from where it landed, curling round as it's stirred.
      const start = index * 2.399 + turn;
      const reach = middle * (0.25 + 0.6 * ((index * 0.37) % 1));
      const curl = 1.2 + (1 - drop.unmixed) * 3;
      context.lineWidth = 10 + entry.strength * 10 * drop.unmixed;
      context.beginPath();
      for (let step = 0; step <= 40; step++) {
        const t = step / 40;
        const angle = start + t * curl;
        const radius = reach * (0.25 + t * 0.85);
        const x = middle + Math.cos(angle) * radius;
        const y = middle + Math.sin(angle) * radius;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      // A blob where it went in, fading first.
      context.globalAlpha = Math.max(drop.unmixed * 1.4 - 0.4, 0);
      context.fillStyle = entry.hex;
      context.beginPath();
      context.arc(
        middle + Math.cos(start) * reach * 0.25,
        middle + Math.sin(start) * reach * 0.25,
        14 + entry.strength * 8,
        0,
        Math.PI * 2,
      );
      context.fill();
    });
    context.globalAlpha = 1;
    // A soft sheen and a dark edge, so it reads as liquid in a pot (the colour stays true).
    const edge = context.createRadialGradient(
      middle,
      middle,
      middle * 0.75,
      middle,
      middle,
      middle,
    );
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.35)');
    context.fillStyle = edge;
    context.fillRect(0, 0, size, size);
    this.#surfaceTexture.needsUpdate = true;
  }

  #updateSpoon(dt: number): void {
    const round = this.#round;
    const show = round !== undefined && round.phase === 'brew' && round.fill > 0;
    this.#spoon.visible = show;
    if (!show) return;
    // At rest it drifts back round to the side of the pot.
    if (!this.#pointer) this.#spoonAngle += (-60 * DEG - this.#spoonAngle) * Math.min(dt * 0.5, 1);
    const radius = POT_RADIUS * 0.55;
    this.#spoon.position.set(
      Math.cos(this.#spoonAngle) * radius,
      this.#liquid.position.y - 0.1,
      Math.sin(this.#spoonAngle) * radius,
    );
    this.#spoon.rotation.y = -this.#spoonAngle;
  }

  #updateCamera(): void {
    const back = new THREE.Vector3(0, Math.sin(CAMERA_ELEVATION), Math.cos(CAMERA_ELEVATION));
    this.#camera.position.copy(CAMERA_TARGET).addScaledVector(back, CAMERA_DISTANCE);
    this.#camera.lookAt(CAMERA_TARGET);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    // Narrow portrait screens: widen the view so the pot fits across.
    this.#camera.fov = width / height < 0.6 ? 52 : 42;
    this.#camera.setViewOffset(width, height, 0, height * CAMERA_LIFT, width, height);
    this.#camera.updateProjectionMatrix();
  }

  #play(name: string, volume: number, detune = 0): void {
    this.#sfx.play(name, volume, detune + (Math.random() - 0.5) * 80);
  }

  /** The middle of the pot's surface on screen, in pixels from the screen's top-left. */
  #potOnScreen(): ScreenPoint {
    const { clientWidth: width, clientHeight: height } = this.#element;
    this.#updateCamera();
    this.#camera.updateMatrixWorld();
    const projected = this.#liquid.getWorldPosition(new THREE.Vector3()).project(this.#camera);
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
  }

  // Input: drag round the pot to stir.

  #listen(): void {
    const canvas = this.#renderer.domElement;
    const angleAt = (event: PointerEvent): number | undefined => {
      const rect = canvas.getBoundingClientRect();
      const pot = this.#potOnScreen();
      const x = event.clientX - rect.left - pot.x;
      const y = event.clientY - rect.top - pot.y;
      if (Math.hypot(x, y) < this.#deps.feel.values.stirDeadPx) return undefined;
      return Math.atan2(y, x);
    };
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      const round = this.#round;
      // Not while an ingredient is being dragged: a drag is never a stir.
      if (!round || round.phase !== 'brew' || this.#pointer || this.#drag) return;
      canvas.setPointerCapture(event.pointerId);
      this.#pointer = { id: event.pointerId, angle: angleAt(event) };
    });
    canvas.addEventListener('pointermove', (event) => {
      const pointer = this.#pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      const angle = angleAt(event);
      if (angle === undefined) return;
      if (pointer.angle !== undefined) {
        let delta = angle - pointer.angle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        this.#round?.stir(delta);
        if (Math.abs(delta) > 0.001) this.#stirDirection = delta > 0 ? 1 : -1;
        // The spoon follows the finger (screen y runs down, the pot's z toward the camera).
        this.#spoonAngle = angle;
      }
      pointer.angle = angle;
    });
    const release = (event: PointerEvent) => {
      if (this.#pointer?.id !== event.pointerId) return;
      this.#pointer = undefined;
      this.#round?.endStir();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  // UI

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
    const root = el('div', 'br-ui');
    // The recipe card: the potion's name and a bottle whose label is the colour to match, beside
    // the pot's colour as it stands (stirred).
    const recipe = el('div', 'br-recipe');
    const cardName = el('div', 'br-recipe-name');
    const swatches = el('div', 'br-swatches');
    const targetBox = el('div', 'br-swatch-box');
    const bottle = el('div', 'br-bottle');
    const target = el('div', 'br-label');
    target.setAttribute('aria-label', 'Target colour');
    bottle.append(target);
    targetBox.append(bottle, el('div', 'br-swatch-name', 'Recipe'));
    // The colour map: where the pot is against the target's star rings, and lightness beside it.
    const mapBox = el('div', 'br-map-box');
    const mapRow = el('div', 'br-map-row');
    const map = el('canvas', 'br-map');
    map.setAttribute('aria-label', 'Colour map');
    const mapBar = el('canvas', 'br-map-bar');
    mapBar.setAttribute('aria-label', 'Lightness');
    mapRow.append(map, mapBar);
    const mapRing = el('div', 'br-swatch-name br-map-ring');
    const mapBest = el('div', 'br-swatch-name br-map-best');
    mapBox.append(mapRow, mapRing, mapBest);
    swatches.append(targetBox, mapBox);
    recipe.append(cardName, swatches);
    const hint = el('div', 'br-hint');
    // Where a dragged ingredient goes in: the pot on screen, shown while dragging.
    const zone = el('div', 'br-zone');
    zone.hidden = true;
    const shelf = el('div', 'br-shelf');
    const controls = el('div', 'br-controls');
    const fill = el('div', 'br-fill');
    const fillBar = el('div', 'br-fill-bar');
    const fillText = el('span', 'br-fill-text');
    fill.append(fillBar, fillText);
    const ladleButton = button('', 'fm-button fm-secondary br-ladle-button', () => {
      this.#round?.ladle();
    });
    ladleButton.setAttribute('aria-label', 'Ladle some out');
    const ladleCount = el('span', 'br-ladle-count');
    ladleButton.append('Ladle', ladleCount);
    const bottleButton = button('Bottle it', 'fm-button br-bottle-button', () => {
      this.#round?.bottle();
    });
    controls.append(fill, ladleButton, bottleButton);
    const card = el('div', 'fm-card br-card');
    const cardStars = el('div', 'w3d-stars fm-card-stars');
    const cardTitle = el('div', 'fm-card-title');
    const cardSwatches = el('div', 'br-card-swatches');
    const cardText = el('div', 'fm-card-text');
    const cardButtons = el('div', 'fm-card-buttons');
    const leave = button('Back to camp', 'fm-button fm-secondary', () => {
      this.#deps.onLeave();
    });
    const next = button('Brew again', 'fm-button', () => {
      this.#hud.settle();
      this.#skillBar.settle();
      this.#startBrew();
    });
    cardButtons.append(leave, next);
    card.append(cardStars, cardTitle, cardSwatches, cardText, cardButtons);
    card.hidden = true;
    root.append(recipe, zone, hint, shelf, controls, card);
    this.#element.append(root);
    return {
      button,
      root,
      cardName,
      target,
      map,
      mapBar,
      mapRing,
      mapBest,
      hint,
      zone,
      shelf,
      fillBar,
      fillText,
      controls,
      ladleButton,
      ladleCount,
      bottleButton,
      card,
      cardStars,
      cardTitle,
      cardSwatches,
      cardText,
    };
  }

  #name(id: string): string {
    if (id === WATER) return this.#deps.game.data.brewing.water.name;
    return this.#deps.game.data.items.find((item) => item.id === id)?.name ?? id;
  }

  // The shelf: drag an ingredient onto the pot to add a drop.

  /**
   * A tile per shelf entry: its colour (what it adds to the pot) behind its icon, its name and
   * how many are left. Built once a brew; `#updateShelf` keeps the counts.
   */
  #buildShelf(round: BrewRound): void {
    const ui = this.#ui;
    this.#tiles = new Map();
    ui.shelf.replaceChildren(
      ...round.shelf.map((entry) => {
        const name = this.#name(entry.id);
        const element = ui.button('', 'br-jar', () => undefined);
        element.style.background = entry.hex;
        element.dataset.ingredient = entry.id;
        element.setAttribute('aria-label', `Add ${name.toLowerCase()}`);
        const icon = document.createElement('img');
        icon.className = 'br-jar-icon';
        icon.alt = '';
        icon.draggable = false;
        icon.src = this.#iconFor(entry);
        const label = document.createElement('span');
        label.className = 'br-jar-name';
        label.textContent = name;
        const count = document.createElement('span');
        count.className = 'br-jar-count';
        element.append(icon, label, count);
        const tile: Tile = { element, icon, count, key: '' };
        this.#tiles.set(entry.id, tile);
        this.#listenTile(entry.id, tile);
        return element;
      }),
    );
    this.#updateShelf(round);
  }

  /** Counts on the tiles; a tile with none left greys out (its count stays). */
  #updateShelf(round: BrewRound): void {
    for (const [id, tile] of this.#tiles) {
      const left = round.left(id);
      const key = String(left);
      if (key === tile.key) continue;
      tile.key = key;
      tile.element.dataset.left = Number.isFinite(left) ? String(left) : 'free';
      tile.count.textContent = Number.isFinite(left) ? `×${String(left)}` : '∞';
      tile.element.classList.toggle('br-jar-empty', left < 1);
    }
  }

  /**
   * An ingredient's icon: its piece from the warchest (the one that flies into the chest), or a
   * drop for water, drawn once with this view's renderer into a picture.
   */
  #iconFor(entry: ShelfEntry): string {
    const cached = this.#icons.get(entry.id);
    if (cached) return cached;
    const look =
      entry.id === WATER
        ? undefined
        : this.#deps.game.data.items.find((item) => item.id === entry.id)?.look;
    const model = look ? pieceModel(look, new THREE.Object3D()) : waterDrop();
    const posed = new THREE.Group();
    posed.add(model);
    const pose = look ? ICON_POSES[look] : undefined;
    if (pose) posed.rotation.set(...pose);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 4, 3);
    scene.add(sun, posed);
    const sphere = new THREE.Box3().setFromObject(posed).getBoundingSphere(new THREE.Sphere());
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const back = new THREE.Vector3(0, Math.sin(30 * DEG), Math.cos(30 * DEG));
    camera.position
      .copy(sphere.center)
      .addScaledVector(back, (sphere.radius / Math.sin(15 * DEG)) * 1.05);
    camera.lookAt(sphere.center);
    const target = new THREE.WebGLRenderTarget(ICON_PX, ICON_PX);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const renderer = this.#renderer;
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(ICON_PX * ICON_PX * 4);
    renderer.readRenderTargetPixels(target, 0, 0, ICON_PX, ICON_PX, pixels);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, clearAlpha);
    target.dispose();
    posed.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        (object.geometry as THREE.BufferGeometry).dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ICON_PX;
    const context = canvas.getContext('2d');
    if (!context) return '';
    const image = context.createImageData(ICON_PX, ICON_PX);
    // WebGL reads bottom row first.
    for (let row = 0; row < ICON_PX; row++) {
      const from = (ICON_PX - 1 - row) * ICON_PX * 4;
      image.data.set(pixels.subarray(from, from + ICON_PX * 4), row * ICON_PX * 4);
    }
    context.putImageData(image, 0, 0);
    const url = canvas.toDataURL();
    this.#icons.set(entry.id, url);
    return url;
  }

  /** Drag from a tile onto the pot: lifts after `dragStartPx`, and a tap does nothing. */
  #listenTile(id: string, tile: Tile): void {
    const { element } = tile;
    element.addEventListener('pointerdown', (event) => {
      const round = this.#round;
      // One thing at a time: not while stirring or dragging something else.
      if (!round || round.phase !== 'brew' || this.#pointer || this.#drag) return;
      if (round.left(id) < 1) {
        this.#flash(`No ${this.#name(id).toLowerCase()} left in the warchest`);
        return;
      }
      element.setPointerCapture(event.pointerId);
      this.#drag = {
        id,
        pointerId: event.pointerId,
        tile,
        from: this.#local(event),
        ghost: undefined,
        over: false,
      };
    });
    element.addEventListener('pointermove', (event) => {
      const drag = this.#drag;
      if (drag?.pointerId !== event.pointerId) return;
      const at = this.#local(event);
      if (!drag.ghost) {
        const moved = Math.hypot(at.x - drag.from.x, at.y - drag.from.y);
        if (moved < this.#deps.feel.values.dragStartPx) return;
        this.#lift(drag);
      }
      this.#moveGhost(drag, at);
    });
    element.addEventListener('pointerup', (event) => {
      const drag = this.#drag;
      if (drag?.pointerId !== event.pointerId) return;
      this.#drag = undefined;
      this.#ui.zone.hidden = true;
      if (!drag.ghost) {
        this.#flash('Drag it into the pot');
        return;
      }
      const at = this.#local(event);
      if (this.#overPot(at) && this.#round?.add(id)) this.#dropGhost(drag);
      else this.#snapBack(drag);
    });
    const cancel = (event: PointerEvent) => {
      const drag = this.#drag;
      if (drag?.pointerId !== event.pointerId) return;
      this.#drag = undefined;
      this.#ui.zone.hidden = true;
      if (drag.ghost) this.#snapBack(drag);
    };
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('lostpointercapture', cancel);
    // A keyboard (or a screen reader's) press adds a drop; a finger has to drag.
    element.addEventListener('click', (event) => {
      if (event.detail === 0) this.#round?.add(id);
    });
  }

  /** A point on screen in this view's pixels. */
  #local(event: PointerEvent): ScreenPoint {
    const rect = this.#element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** The ingredient leaves its tile and follows the finger; the pot shows where it goes. */
  #lift(drag: Drag): void {
    const ghost = document.createElement('img');
    ghost.className = 'br-ghost';
    ghost.alt = '';
    ghost.src = drag.tile.icon.src;
    this.#ui.root.append(ghost);
    drag.ghost = ghost;
    drag.tile.element.classList.add('br-jar-lifted');
    const zone = this.#potZone();
    const style = this.#ui.zone.style;
    style.left = `${String(zone.x - zone.rx)}px`;
    style.top = `${String(zone.y - zone.ry)}px`;
    style.width = `${String(zone.rx * 2)}px`;
    style.height = `${String(zone.ry * 2)}px`;
    this.#ui.zone.hidden = false;
    this.#deps.haptics.pulse(this.#deps.feel.values.buzzStirMs);
  }

  #moveGhost(drag: Drag, at: ScreenPoint): void {
    const ghost = drag.ghost;
    if (!ghost) return;
    const over = this.#overPot(at);
    ghost.style.transform = ghostAt(at, over ? 1.3 : 1.1);
    if (over !== drag.over) {
      drag.over = over;
      ghost.classList.toggle('br-ghost-over', over);
      this.#ui.zone.classList.toggle('br-zone-over', over);
    }
  }

  /** In: the ingredient shrinks into the pot, and a fresh one sits on its tile if any are left. */
  #dropGhost(drag: Drag): void {
    const ghost = drag.ghost;
    drag.tile.element.classList.remove('br-jar-lifted');
    this.#ui.zone.classList.remove('br-zone-over');
    if (!ghost) return;
    const pot = this.#potOnScreen();
    ghost.style.transition = `transform ${String(DROP_IN_SECONDS)}s ease-in, opacity ${String(DROP_IN_SECONDS)}s ease-in`;
    ghost.style.transform = ghostAt(pot, 0.3);
    ghost.style.opacity = '0';
    window.setTimeout(() => {
      ghost.remove();
    }, DROP_IN_SECONDS * 1000);
  }

  /** A miss: it slides back to its tile and nothing goes in. */
  #snapBack(drag: Drag): void {
    const ghost = drag.ghost;
    this.#ui.zone.classList.remove('br-zone-over');
    if (!ghost) {
      drag.tile.element.classList.remove('br-jar-lifted');
      return;
    }
    const seconds = this.#deps.feel.values.snapBackSeconds;
    const home = this.#ui.root.getBoundingClientRect();
    const icon = drag.tile.icon.getBoundingClientRect();
    ghost.style.transition = `transform ${String(seconds)}s ease-out`;
    ghost.style.transform = ghostAt(
      { x: icon.left + icon.width / 2 - home.left, y: icon.top + icon.height / 2 - home.top },
      1,
    );
    window.setTimeout(() => {
      ghost.remove();
      drag.tile.element.classList.remove('br-jar-lifted');
    }, seconds * 1000);
  }

  #cancelDrag(): void {
    const drag = this.#drag;
    this.#drag = undefined;
    this.#ui.zone.hidden = true;
    drag?.ghost?.remove();
    drag?.tile.element.classList.remove('br-jar-lifted');
  }

  /**
   * Where a dragged ingredient goes in: an ellipse round the pot as it sits on screen (rim,
   * belly and base), `dropPadPx` past it for thumbs.
   */
  #potZone(): { x: number; y: number; rx: number; ry: number } {
    const { clientWidth: width, clientHeight: height } = this.#element;
    this.#updateCamera();
    this.#camera.updateMatrixWorld();
    const base = 0.25;
    const rings: [number, number][] = [
      [POT_RADIUS + 0.1, base + RIM_Y],
      [1.12, base + 0.8],
      [0.55, base + 0.14],
    ];
    let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [radius, y] of rings) {
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2;
        const point = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        point.project(this.#camera);
        const x = ((point.x + 1) / 2) * width;
        const screenY = ((1 - point.y) / 2) * height;
        [left, right] = [Math.min(left, x), Math.max(right, x)];
        [top, bottom] = [Math.min(top, screenY), Math.max(bottom, screenY)];
      }
    }
    const pad = this.#deps.feel.values.dropPadPx;
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      rx: (right - left) / 2 + pad,
      ry: (bottom - top) / 2 + pad,
    };
  }

  /** Over the pot (and not back over the shelf, which the padding may reach). */
  #overPot(at: ScreenPoint): boolean {
    const zone = this.#potZone();
    const inside = ((at.x - zone.x) / zone.rx) ** 2 + ((at.y - zone.y) / zone.ry) ** 2 <= 1;
    if (!inside) return false;
    const home = this.#ui.root.getBoundingClientRect();
    const shelf = this.#ui.shelf.getBoundingClientRect();
    return at.y + home.top < shelf.top;
  }

  /** A short note in place of the hint for a moment. */
  #flash(text: string): void {
    this.#flashText = { text, until: performance.now() + 1800 };
  }

  #updateUi(): void {
    const ui = this.#ui;
    const round = this.#round;
    const phase = round?.phase ?? 'none';
    if (phase !== this.#lastPhase) {
      this.#lastPhase = phase;
      // Lets the e2e test follow along.
      document.body.dataset.brewing = phase;
    }
    if (!round) return;
    const brewing = phase === 'brew';
    ui.shelf.hidden = !brewing;
    ui.controls.hidden = !brewing;
    this.#updateShelf(round);
    this.#drawMap(round);
    const { maxFill } = round.rules;
    ui.fillBar.style.width = `${String((round.fill / maxFill) * 100)}%`;
    ui.fillText.textContent = `Fill ${formatFill(round.fill)} / ${String(maxFill)}`;
    ui.bottleButton.disabled = round.fill === 0;
    ui.ladleButton.disabled = !round.canLadle;
    ui.ladleCount.textContent = ` ×${String(round.ladlesLeft)}`;
    const unmixed = round.unmixed;
    const best = round.bestStars;
    const hint =
      round.fill === 0
        ? 'Drag ingredients from the shelf into the pot. Get your pot into the rings on the map'
        : unmixed > 0.15
          ? 'Drag round the pot to stir: the map shows where you are once it’s stirred'
          : best < 3 && round.canLadle
            ? `${best > 0 ? `Only ${'★'.repeat(best)} left in reach` : 'The rings are out of reach'}. The ladle scoops some out to make room`
            : round.full
              ? 'The pot is full. Bottle it when you’re happy'
              : 'Too light? Ash darkens. Too dark? Water lightens. The map’s dim parts are out of reach';
    const flash = this.#flashText;
    ui.hint.textContent =
      flash && performance.now() < flash.until ? flash.text : brewing ? hint : '';
    // For the e2e test.
    this.#element.dataset.fill = formatFill(round.fill);
    this.#element.dataset.unmixed = unmixed.toFixed(2);
    this.#element.dataset.best = String(best);
    this.#element.dataset.ladles = String(round.ladlesLeft);
    const pot = this.#potOnScreen();
    this.#element.dataset.potX = String(Math.round(pot.x));
    this.#element.dataset.potY = String(Math.round(pot.y));
  }

  /** The end card: stars, potions, the two colours side by side, and anything given back. */
  #showCard(result: BrewResult): void {
    const ui = this.#ui;
    const round = this.#round;
    ui.cardStars.replaceChildren(
      ...[0, 1, 2].map((index) => {
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
    const potion = this.#ui.cardName.textContent || 'potion';
    ui.cardTitle.textContent =
      result.banked > 0
        ? `${String(result.banked)} ${potion}${result.banked === 1 ? '' : 's'}`
        : 'Spoiled';
    const swatch = (lab: Lab | undefined, label: string) => {
      const box = document.createElement('div');
      box.className = 'br-swatch-box';
      const color = document.createElement('div');
      color.className = 'br-pot';
      color.style.background = lab ? labToHex(lab) : EMPTY_POT;
      const name = document.createElement('div');
      name.className = 'br-swatch-name';
      name.textContent = label;
      box.append(color, name);
      return box;
    };
    ui.cardSwatches.replaceChildren(swatch(round?.target, 'Recipe'), swatch(result.color, 'Yours'));
    const { stars } = this.#deps.game.data.brewing;
    const lines = [
      result.stars >= 3
        ? 'A perfect match'
        : result.stars === 2
          ? 'Close: a shade off'
          : result.stars === 1
            ? 'Drinkable, but well off the colour'
            : 'Too far off the colour: it spoiled',
    ];
    if (result.refund) lines.push(`${this.#name(result.refund)} given back`);
    const ladled =
      result.ladles > 0 ? ` · ${String(result.ladles)} ladle${result.ladles === 1 ? '' : 's'}` : '';
    lines.push(
      `Match ${String(Math.max(0, Math.round((1 - result.distance / stars.one) * 100)))}% · ${String(result.drops)} drops${ladled} · ${String(Math.round(result.seconds))} s`,
    );
    ui.cardText.textContent = lines.join('\n');
    ui.card.hidden = false;
    this.#element.dataset.stars = String(result.stars);
  }
}

/** A fill in drops: whole, or to one place once the ladle has made it a fraction. */
function formatFill(fill: number): string {
  const rounded = Math.round(fill * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A dragged ingredient's transform: centred on `at`, at `scale`. */
function ghostAt(at: ScreenPoint, scale: number): string {
  return `translate(${String(at.x)}px, ${String(at.y)}px) translate(-50%, -50%) scale(${String(scale)})`;
}

/** Water's icon (it isn't an item, so it has no piece): a pale blue drop. */
function waterDrop(): THREE.Object3D {
  const material = new THREE.MeshLambertMaterial({ color: 0x9cc9e0 });
  const drop = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), material);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.255, 0.42, 16, 1, true), material);
  tip.position.y = 0.33;
  const shine = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  shine.position.set(-0.12, 0.1, 0.24);
  drop.add(body, tip, shine);
  return drop;
}
