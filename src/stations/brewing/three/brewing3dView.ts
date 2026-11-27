import * as THREE from 'three';
import { groundMesh, wornGround } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import type { ScreenView } from '../../../app/screen';
import { Sfx, type SoundLoop } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { WarchestHud, type Deposit, type ScreenPoint } from '../../../app/warchestHud';
import type { EventLogger, Game, LiveTuning } from '../../../core';
import type { BrewingFeel } from '../../../data';
import { BrewRound, WATER, type BrewEvent, type BrewResult } from '../logic/brew';
import { labToHex, labToRgb, type Lab } from '../logic/color';
import { mapPoint, mapScale } from '../logic/map';

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
/** The map's star rings: the 3-star ring gold, the outer two paler. */
const RING_COLORS = ['#f2c14e', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.5)'];
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

/** A drop on its way from the shelf into the pot. */
interface Falling {
  mesh: THREE.Mesh;
  at: number;
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
  #shelfKey = '';
  #flashText: { text: string; until: number } | undefined;
  /** The map's background for this brew (colours at the target's lightness), drawn once. */
  readonly #mapCells = document.createElement('canvas');

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
    this.#swirlTurn = 0;
    this.#quarterTurns = 0;
    this.#shelfKey = '';
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
    this.#paintMapCells(this.#round);
  }

  // The colour map

  /** The map's background: every a and b at the target's lightness, as the eye would see it. */
  #paintMapCells(round: BrewRound): void {
    const cells = this.#mapCells;
    cells.width = cells.height = MAP_CELLS;
    const context = cells.getContext('2d');
    if (!context) return;
    const image = context.createImageData(MAP_CELLS, MAP_CELLS);
    const { map, target } = round;
    for (let row = 0; row < MAP_CELLS; row++) {
      for (let column = 0; column < MAP_CELLS; column++) {
        const a = map.a - map.half + ((column + 0.5) / MAP_CELLS) * map.half * 2;
        const b = map.b + map.half - ((row + 0.5) / MAP_CELLS) * map.half * 2;
        const [r, g, bl] = labToRgb({ L: target.L, a, b });
        const at = (row * MAP_CELLS + column) * 4;
        image.data[at] = r * 255;
        image.data[at + 1] = g * 255;
        image.data[at + 2] = bl * 255;
        image.data[at + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
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
    // The target's rings.
    const middle = at(target);
    const bands = [rules.stars.three, rules.stars.two, rules.stars.one];
    bands.forEach((band, index) => {
      context.strokeStyle = 'rgba(0,0,0,0.45)';
      context.lineWidth = index === 0 ? 3.5 : 2.5;
      context.beginPath();
      context.arc(middle.x, middle.y, mapScale(map, band) * w, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = RING_COLORS[index] ?? '#fff';
      context.lineWidth = index === 0 ? 2 : 1;
      context.stroke();
    });
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
    // The target's bands, as the rings are on the map.
    const bands = [rules.stars.one, rules.stars.two, rules.stars.three];
    bands.forEach((band, index) => {
      context.fillStyle =
        index === 2 ? 'rgba(242,193,78,0.9)' : `rgba(255,255,255,${String(0.18 + index * 0.12)})`;
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
        this.#play(`steam-${String(1 + Math.floor(Math.random() * 2))}`, 0.15, 600);
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
      if (!round || round.phase !== 'brew' || this.#pointer) return;
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
    mapBox.append(mapRow, mapRing);
    swatches.append(targetBox, mapBox);
    recipe.append(cardName, swatches);
    const hint = el('div', 'br-hint');
    const shelf = el('div', 'br-shelf');
    const controls = el('div', 'br-controls');
    const fill = el('div', 'br-fill');
    const fillBar = el('div', 'br-fill-bar');
    const fillText = el('span', 'br-fill-text');
    fill.append(fillBar, fillText);
    const bottleButton = button('Bottle it', 'fm-button br-bottle-button', () => {
      this.#round?.bottle();
    });
    controls.append(fill, bottleButton);
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
    root.append(recipe, hint, shelf, controls, card);
    this.#element.append(root);
    return {
      button,
      root,
      cardName,
      target,
      map,
      mapBar,
      mapRing,
      hint,
      shelf,
      fillBar,
      fillText,
      controls,
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

  /** The shelf: a jar per ingredient in its colour, with how many are left. Rebuilt on change. */
  #showShelf(round: BrewRound): void {
    const key = round.shelf.map((entry) => `${entry.id}:${String(round.left(entry.id))}`).join(',');
    if (key === this.#shelfKey) return;
    this.#shelfKey = key;
    const ui = this.#ui;
    ui.shelf.replaceChildren(
      ...round.shelf.map((entry) => {
        const left = round.left(entry.id);
        const name = this.#name(entry.id);
        const element = ui.button('', 'br-jar', () => {
          this.#round?.add(entry.id);
        });
        element.dataset.ingredient = entry.id;
        element.dataset.left = Number.isFinite(left) ? String(left) : 'free';
        element.setAttribute('aria-label', `Add ${name.toLowerCase()}`);
        if (left < 1) element.classList.add('br-jar-empty');
        const blob = document.createElement('span');
        blob.className = 'br-jar-blob';
        blob.style.background = entry.hex;
        const label = document.createElement('span');
        label.className = 'br-jar-name';
        label.textContent = name;
        const count = document.createElement('span');
        count.className = 'br-jar-count';
        count.textContent = Number.isFinite(left) ? `×${String(left)}` : '∞';
        element.append(blob, label, count);
        return element;
      }),
    );
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
    this.#showShelf(round);
    this.#drawMap(round);
    const { maxFill } = round.rules;
    ui.fillBar.style.width = `${String((round.fill / maxFill) * 100)}%`;
    ui.fillText.textContent = `Fill ${String(round.fill)} / ${String(maxFill)}`;
    ui.bottleButton.disabled = round.fill === 0;
    const unmixed = round.unmixed;
    const hint =
      round.fill === 0
        ? 'Tap the shelf to add ingredients. Get your pot into the rings on the map'
        : unmixed > 0.15
          ? 'Drag round the pot to stir: the map shows where you are once it’s stirred'
          : round.full
            ? 'The pot is full. Bottle it when you’re happy'
            : 'Too light? Ash darkens. Too dark? Water lightens. Nothing comes back out';
    const flash = this.#flashText;
    ui.hint.textContent =
      flash && performance.now() < flash.until ? flash.text : brewing ? hint : '';
    // For the e2e test.
    this.#element.dataset.fill = String(round.fill);
    this.#element.dataset.unmixed = unmixed.toFixed(2);
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
    lines.push(
      `Match ${String(Math.max(0, Math.round((1 - result.distance / stars.one) * 100)))}% · ${String(result.drops)} drops · ${String(Math.round(result.seconds))} s`,
    );
    ui.cardText.textContent = lines.join('\n');
    ui.card.hidden = false;
    this.#element.dataset.stars = String(result.stars);
  }
}
