import * as THREE from 'three';
import type { ScreenView } from '../../../app/screen';
import type { Haptics } from '../../../app/haptics';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import type { EventLogger, Game, LiveTuning } from '../../../core';
import type { RivingFeel, RivingLog } from '../../../data';
import { generateLog } from '../logic/generate';
import { DEG, inArc, markArc, openHeads, starsFor, type Plan } from '../logic/pattern';
import { RivingRound, type RivingEvent } from '../logic/round';

export interface Rive3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<RivingFeel>;
  haptics: Haptics;
  /** Leaves the station (the end card's Back to camp). */
  onLeave: () => void;
}

const TAU = Math.PI * 2;
/** One-time flag: the practice log has been riven. */
const TUTORIAL = 'tutorial.riving';
/** The chopping block the log stands on: its height, and how much wider than the log it is. */
const BLOCK_HEIGHT = 0.55;
const BLOCK_SPREAD = 1.25;
/** How far the wedges open while the head is pumped through (world units, at the end). */
const STRAIN_GAP = 0.06;
/** The camera: how far it looks down (radians) and how far back it sits. */
const CAMERA_ELEVATION = 58 * DEG;
const CAMERA_DISTANCE = 9;
/** The splitting head: how high it starts its drop, and how far it sinks into the log. */
const HEAD_DROP = 1.5;
const HEAD_SINK = 0.5;
/** How far the pump handle swings down at the bottom of a stroke (radians). */
const HANDLE_SWING = 50 * DEG;
/** How much of a notch the head gives as the handle goes down, before the stroke clicks it in. */
const HANDLE_GIVE = 0.35;
/** How wide the cut lines are drawn (world units): thin, so you can see where they cross. */
const GUIDE_WIDTH = 0.025;
/** Staves drawn in the burst (past this many, the count says the rest), stacked this many wide. */
const MAX_STAVES_SHOWN = 64;
const HEAP_COLUMNS = 8;
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
const COLORS = {
  sky: 0xb4cfa8,
  ground: 0x6b8f4e,
  block: 0x6b4a2f,
  blockTop: 0x8a6440,
  bark: 0x5b3e27,
  wood: 0xd9b98a,
  stave: 0xe0c08e,
  ringDark: '#c99d64',
  ringLight: '#e2c08c',
  pith: '#8a5d32',
  check: '#3b2415',
  grain: { rot: '#5a4325', silver: '#cfd8dc', gold: '#f2c037' } as Record<string, string>,
  grainEdge: { rot: '#33240f', silver: '#8fa0a8', gold: '#a87a12' } as Record<string, string>,
  knot: '#3b2413',
  cancelled: '#9b9284',
  glowGood: '#7fd65a',
  glowBad: '#ff4a3a',
  steel: 0x9aa3a8,
  steelDark: 0x5d666b,
  handle: 0x8b5a2b,
  guide: 0xf2ead3,
  danger: 0xe0503c,
  good: 0x7fd65a,
  crack: 0x1d120a,
};

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
  spin: THREE.Vector3;
  yaw: number;
}

/**
 * Riving in 3D: a log stood on end on a chopping block, seen from above, split by a splitting
 * head (a star of blades) into staves. Pick a head and turn the cuts, strike to drop the head on,
 * pump the handle to drive it through, and the log bursts into its staves (times its grains).
 * The rules (RivingRound) decide everything; this draws them and feeds them touches.
 */
export class Rive3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Rive3DDeps;
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
  #ui!: ReturnType<Rive3DView['buildUi']>;
  #round: RivingRound | undefined;
  #log: RivingLog | undefined;
  #pieces = new Map<string, PieceVisual>();
  #faceTexture: THREE.CanvasTexture | undefined;
  #faceCanvas: HTMLCanvasElement | undefined;
  /** The head chosen last, kept for the next log. */
  #lastHead: number | undefined;
  /** What the plan last drew (face glow, lines, equation), so it redraws only on change. */
  #planKey = '';
  #head: { root: THREE.Group; yaw: THREE.Group; arm: THREE.Group; count: number } | undefined;
  #guideLines: THREE.Mesh[] = [];
  #cracks: THREE.Mesh[] = [];
  #staves!: THREE.InstancedMesh;
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
  /** The turn last shown, and when it last ticked, for the detent tick on each step. */
  #shownTurn: number | undefined;
  #tickedAt = 0;
  /** The head's depth into the log as drawn (0–1), easing from one notch to the next. */
  #drive = { from: 0, to: 0, at: 0 };
  #shake = 0;
  #frozenUntil = 0;
  #bankedXp: XpDeposit | undefined;
  #lastPhase = '';
  #starsShown = 0;
  /** The staves the chest is holding back until they pour in from the heap. */
  #deposit: ReturnType<WarchestHud['hold']> | undefined;
  /** The finished log, waiting in its heap until it's time to show the card and pour. */
  #heap: { event: Extract<RivingEvent, { type: 'done' }>; at: number } | undefined;

  private constructor(element: HTMLElement, deps: Rive3DDeps, hud: WarchestHud) {
    this.#element = element;
    this.#deps = deps;
    this.#hud = hud;
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'rive');
    this.#skill = station?.skill ?? 'fletching';
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.domElement.className = 'rv-canvas';
    element.append(this.#renderer.domElement);
    this.#buildWorld();
    this.#ui = this.buildUi();
    this.#sfx.load(SOUNDS);
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Rive3DDeps): Promise<Rive3DView> {
    const recipe = deps.game.data.recipes.find(
      (entry) => entry.id === deps.game.data.riving.recipe,
    );
    const item = recipe?.outputs[0]?.item;
    if (!item) throw new Error('The riving recipe makes nothing');
    const hud = await WarchestHud.create(element, { game: deps.game, item, haptics: deps.haptics });
    return new Rive3DView(element, deps, hud);
  }

  // ScreenView

  start(): void {
    this.#resize();
    this.#startLog();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#round?.exit();
    this.#round = undefined;
    this.#hud.settle();
    this.#skillBar.settle();
    this.#bankedXp = undefined;
    this.#heap = undefined;
    this.#deposit = undefined;
    delete document.body.dataset.riving;
    this.#lastPhase = '';
  }

  // Logs

  /** A new log, if there's one in the warchest to rive: the practice log first, then random. */
  #startLog(): void {
    const { game } = this.#deps;
    const rules = game.data.riving;
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
    this.#round = new RivingRound(
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
    this.#shownTurn = undefined;
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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ color: COLORS.ground }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.#scene.add(ground);
    const block = new THREE.Mesh(
      new THREE.CylinderGeometry(BLOCK_SPREAD * 1.05, BLOCK_SPREAD * 1.12, BLOCK_HEIGHT, 28),
      [
        new THREE.MeshLambertMaterial({ color: COLORS.block }),
        new THREE.MeshLambertMaterial({ color: COLORS.blockTop }),
        new THREE.MeshLambertMaterial({ color: COLORS.block }),
      ],
    );
    block.position.y = BLOCK_HEIGHT / 2;
    block.castShadow = block.receiveShadow = true;
    this.#scene.add(block);
    this.#logRoot.position.y = BLOCK_HEIGHT;
    this.#scene.add(this.#logRoot);
    // The burst's staves: one mesh drawn many times, so a big log stays smooth on a phone.
    const stave = new THREE.BoxGeometry(0.09, 0.06, 0.85);
    this.#staves = new THREE.InstancedMesh(
      stave,
      new THREE.MeshLambertMaterial({ color: COLORS.stave }),
      MAX_STAVES_SHOWN,
    );
    this.#staves.castShadow = true;
    this.#staves.count = 0;
    this.#staves.frustumCulled = false;
    this.#scene.add(this.#staves);
  }

  /**
   * The splitting head for a `count`-way split: a steel blade along each cut line from a hub at
   * the pith, a post up from the hub, and a pump handle reaching toward you that swings down with
   * each stroke.
   */
  #buildHead(count: number, radius: number) {
    if (this.#head) this.#logRoot.remove(this.#head.root);
    const root = new THREE.Group();
    const steel = new THREE.MeshLambertMaterial({ color: COLORS.steel });
    const dark = new THREE.MeshLambertMaterial({ color: COLORS.steelDark });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.22, 16), dark);
    hub.position.y = 0.11;
    root.add(hub);
    // Blades sit along the face's angles; their outline runs from the hub to just past the bark.
    for (let index = 0; index < count; index++) {
      const geometry = new THREE.BoxGeometry(radius * 1.02, 0.24, 0.04);
      geometry.translate((radius * 1.02) / 2, 0.12, 0);
      const blade = new THREE.Mesh(geometry, steel);
      blade.rotation.y = (index * TAU) / count;
      root.add(blade);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 10), dark);
    post.position.y = 0.22 + 0.35;
    root.add(post);
    // The handle always reaches out to the right, however the blades are turned, so you see it
    // swing down as you pump.
    const yaw = new THREE.Group();
    yaw.position.y = 0.22 + 0.7;
    const arm = new THREE.Group();
    yaw.add(arm);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8), dark);
    bar.rotation.x = Math.PI / 2;
    bar.position.z = 0.75;
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.32, 10),
      new THREE.MeshLambertMaterial({ color: COLORS.handle }),
    );
    grip.position.set(0, -0.04, 1.5);
    arm.add(bar, grip);
    root.add(yaw);
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
    root.visible = false;
    this.#logRoot.add(root);
    this.#head = { root, yaw, arm, count };
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
  #buildLog(log: RivingLog): void {
    this.#clearLog();
    this.#faceTexture = this.#drawFace(log, [], []);
    this.#addPiece({ id: 'log', start: 0, width: TAU }, new THREE.Vector3(), 0);
  }

  /**
   * The end grain: growth rings round the pith, checks as dark cracks, knots as dark patches,
   * and each grain as a coloured patch over the arc of the face it covers (the arc the rules
   * use), marked with what it's worth. Grains the cuts would run through glow (red for a good
   * one, green for rot); ones a struck head has cut are drawn faded and crossed out.
   */
  #drawFace(
    log: RivingLog,
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
    for (let ring = log.rings; ring >= 1; ring--) {
      context.beginPath();
      context.arc(middle, middle, (radius * ring) / log.rings, 0, Math.PI * 2);
      context.fillStyle = ring % 2 === 0 ? COLORS.ringDark : COLORS.ringLight;
      context.fill();
    }
    context.beginPath();
    context.arc(middle, middle, radius * 0.04, 0, Math.PI * 2);
    context.fillStyle = COLORS.pith;
    context.fill();
    const kinds = this.#deps.game.data.riving.grainKinds;
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
      context.globalAlpha = alive ? 0.92 : 0.35;
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
    context.strokeStyle = COLORS.check;
    context.lineWidth = 5;
    context.lineCap = 'round';
    for (const check of log.checks) {
      const from = at(check * DEG, 0.12);
      const to = at(check * DEG, 0.97);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
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

  /** The log's grains, for its name, repeats counted: "3 Silver ×2 · Rot ×½". */
  #grainNames(log: RivingLog): string {
    const kinds = this.#deps.game.data.riving.grainKinds;
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
    const bark = new THREE.Mesh(
      new THREE.CylinderGeometry(
        radius,
        radius,
        height,
        segments,
        1,
        true,
        arc.start + Math.PI / 2,
        arc.width,
      ),
      new THREE.MeshLambertMaterial({ color: COLORS.bark, side: THREE.DoubleSide }),
    );
    bark.position.y = height / 2;
    root.add(top, bark);
    if (!whole) {
      for (const edge of [arc.start, arc.start + arc.width]) {
        const geometry = new THREE.PlaneGeometry(radius, height);
        geometry.translate(radius / 2, height / 2, 0);
        const face = new THREE.Mesh(
          geometry,
          new THREE.MeshLambertMaterial({ color: COLORS.wood, side: THREE.DoubleSide }),
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

  #onEvent(event: RivingEvent): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    const log = this.#log;
    if (!round || !log) return;
    if (event.type === 'strike') {
      const head = this.#buildHead(round.count, log.radius);
      head.root.rotation.y = round.rotation;
      head.yaw.rotation.y = Math.PI / 2 - round.rotation;
      head.root.visible = true;
      // The struck plan's cut grains are gone for good.
      this.#drawFace(log, [], round.plan.cut);
      this.#play('creak-1', 0.35, 500);
    } else if (event.type === 'landed') {
      this.#play('chop-perfect', 0.9, -250);
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
    this.#play(`chop-${1 + Math.floor(Math.random() * 3)}`, 0.55 + build * 0.35, -150 * stroke);
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
  #burst(event: Extract<RivingEvent, { type: 'done' }>): void {
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
    if (this.#head) this.#head.root.visible = false;
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
    // The staves fly from the log into a neat stack in front of the block, a few at a time.
    const shown = Math.min(event.banked, MAX_STAVES_SHOWN);
    const start = new THREE.Vector3(0, BLOCK_HEIGHT + log.height * 0.8, 0);
    this.#flights = Array.from({ length: shown }, (_, index) => {
      const column = index % HEAP_COLUMNS;
      const layer = Math.floor(index / HEAP_COLUMNS);
      // Each layer sits in the gaps of the one under it.
      const to = new THREE.Vector3(
        (column - (HEAP_COLUMNS - 1) / 2 + (layer % 2) * 0.5) * 0.1 + (Math.random() - 0.5) * 0.02,
        0.035 + layer * 0.055,
        1.75 + (Math.random() - 0.5) * 0.12,
      );
      return {
        from: start.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0)),
        to,
        launchAt: round.now + Math.random() * feel.burstSeconds * 0.25,
        seconds: feel.burstSeconds * (0.5 + Math.random() * 0.25),
        height: 1 + Math.random() * 1.2,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 14,
        ),
        yaw: (Math.random() - 0.5) * 0.16,
      };
    });
    this.#staves.count = shown;
    // Let the heap sit a moment before it pours in (on the round's clock, so hit-stop counts).
    this.#heap = { event, at: round.now + feel.burstSeconds + feel.heapSeconds };
  }

  /** The heap's staves fly into the chest, and the log's XP ticks in with them. */
  #pourStaves(): void {
    const deposit = this.#deposit;
    this.#deposit = undefined;
    if (!deposit) return;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const points: ScreenPoint[] = this.#flights.map((flight) => {
      const projected = flight.to.clone().project(this.#camera);
      return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
    });
    deposit.pour(points);
    this.#clearBurst();
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
    const head = this.#head;
    if (!head) return;
    const pump = phase.kind === 'pump' ? phase.pump : undefined;
    const progress = this.#headDepth();
    if (phase.kind === 'swing') {
      // The head drops, speeding up, and bites in as it lands.
      const t = Math.min((round.now - phase.at) / round.feel.strikeSeconds, 1);
      head.root.position.y = log.height - 0.03 + HEAD_DROP * (1 - t * t);
    } else {
      head.root.position.y = log.height - 0.03 - progress * HEAD_SINK;
    }
    head.arm.rotation.x = (pump?.handle ?? 0) * HANDLE_SWING;
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
    const rules = this.#deps.game.data.riving;
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
      if (t < 0) {
        matrix.compose(flight.from, rotation.identity(), hidden);
      } else {
        const done = Math.min(t, 1);
        const position = flight.from.clone().lerp(flight.to, done);
        position.y += flight.height * 4 * done * (1 - done);
        const tumble = new THREE.Euler(
          done < 1 ? flight.spin.x * done : 0,
          flight.yaw + (done < 1 ? flight.spin.y * done : 0),
          done < 1 ? flight.spin.z * done : 0,
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
    this.#camera.position.copy(target).addScaledVector(back, CAMERA_DISTANCE);
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
      const round = this.#round;
      if (!round || this.#pointer) return;
      canvas.setPointerCapture(event.pointerId);
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
    round: RivingRound,
    recent: readonly { time: number; x: number; y: number; rotation: number }[],
    event: PointerEvent,
  ): void {
    const feel = this.#deps.feel.values;
    const settled = performance.now() - feel.liftMs;
    const before = recent.filter((entry) => entry.time <= settled).at(-1);
    if (!before || before.rotation === round.rotation) return;
    const moved = Math.hypot(event.clientX - before.x, event.clientY - before.y);
    if (moved >= feel.liftPx) return;
    this.#deps.logger.log('riving.liftGuard', {
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
      element.addEventListener('click', onTap);
      return element;
    };
    const root = el('div', 'rv-ui');
    const logName = el('div', 'rv-log-name');
    // The stars this plan would earn, and what each needs.
    const stars = el('div', 'rv-stars');
    const starRow = el('div', 'rv-star-row');
    const starIcons = [0, 1, 2].map(() => el('span', 'rv-star', '★'));
    starRow.append(...starIcons);
    const starText = el('div', 'rv-star-text');
    stars.append(starRow, starText);
    const hint = el('div', 'rv-hint');
    // The plan as a sum: staves × each grain kept (cut ones struck through) = what the log makes.
    const sum = el('div', 'rv-sum');
    const heads = el('div', 'rv-heads');
    heads.setAttribute('role', 'radiogroup');
    heads.setAttribute('aria-label', 'Splitting head');
    const flashes = el('div', 'rv-flashes');
    const controls = el('div', 'rv-controls');
    const left = button('↺', 'rv-button rv-nudge', () => {
      this.#round?.nudge(1);
    });
    const strike = button('Strike', 'rv-button rv-strike', () => {
      this.#round?.strike();
    });
    const right = button('↻', 'rv-button rv-nudge', () => {
      this.#round?.nudge(-1);
    });
    left.setAttribute('aria-label', 'Turn the cuts counter-clockwise');
    right.setAttribute('aria-label', 'Turn the cuts clockwise');
    controls.append(left, strike, right);
    // The turn of the cuts, in degrees.
    const turn = el('div', 'rv-turn');
    turn.setAttribute('aria-label', 'Turn of the cuts');
    const card = el('div', 'rv-card');
    const cardStars = el('div', 'w3d-stars rv-card-stars');
    const cardTitle = el('div', 'rv-card-title');
    const cardText = el('div', 'rv-card-text');
    const cardButtons = el('div', 'rv-card-buttons');
    const leave = button('Back to camp', 'rv-button rv-secondary', () => {
      this.#deps.onLeave();
    });
    const next = button('Next log', 'rv-button', () => {
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
    const rules = this.#deps.game.data.riving;
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
      item.className = `rv-head${needs === undefined ? '' : ' rv-head-locked'}`;
      item.dataset.count = String(count);
      item.setAttribute('role', 'radio');
      item.setAttribute(
        'aria-label',
        needs === undefined
          ? `${String(count)}-way head`
          : `${String(count)}-way head, opens at level ${String(needs)}`,
      );
      item.innerHTML = `${headIcon(count)}<span class="rv-head-label">${
        needs === undefined ? String(count) : `Lv ${String(needs)}`
      }</span>`;
      item.addEventListener('click', () => {
        if (needs !== undefined) {
          this.#flash(`${String(count)}-way opens at Fletching ${String(needs)}`, 'warn');
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
      document.body.dataset.riving = phase;
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
    const practice = this.#log?.id === this.#deps.game.data.riving.tutorialLog.id;
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
    if (planning) this.#showTurn(degrees);
    this.#element.dataset.head = String(round.count);
    this.#element.dataset.turn = String(degrees);
    this.#element.dataset.worth = String(plan.worth);
    this.#element.dataset.progress = pump ? pump.progress.toFixed(2) : '';
  }

  /** The degrees readout, and a detent tick (a tap of vibration) for each step the cuts turn. */
  #showTurn(degrees: number): void {
    if (degrees === this.#shownTurn) return;
    const first = this.#shownTurn === undefined;
    this.#shownTurn = degrees;
    this.#ui.turn.textContent = `${String(degrees)}°`;
    const feel = this.#deps.feel.values;
    const now = performance.now();
    if (first || now - this.#tickedAt < feel.tickGapMs) return;
    this.#tickedAt = now;
    this.#deps.haptics.pulse(feel.buzzTickMs);
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
    for (const item of ui.heads.querySelectorAll<HTMLElement>('.rv-head')) {
      const on = item.dataset.count === String(plan.count);
      if (on && !item.classList.contains('rv-head-on')) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
      item.classList.toggle('rv-head-on', on);
      item.setAttribute('aria-checked', String(on));
    }
    // The sum: kept grains multiply; cut ones are struck through (green for rot, red for good).
    const kinds = this.#deps.game.data.riving.grainKinds;
    const parts: HTMLElement[] = [];
    const span = (className: string, text: string) => {
      const part = document.createElement('span');
      part.className = className;
      part.textContent = text;
      return part;
    };
    parts.push(span('rv-sum-staves', `${String(plan.staves)} staves`));
    const kept = plan.kept.map((entry) => entry.grain);
    log.grains.forEach((grain, index) => {
      const kind = kinds.find((entry) => entry.id === grain.kind);
      if (!kind) return;
      const isCut = plan.cut.includes(index);
      if (!isCut && !kept.includes(index)) return;
      const tone = isCut ? (kind.multiplier < 1 ? ' rv-sum-cut-good' : ' rv-sum-cut-bad') : '';
      parts.push(span(`rv-sum-factor rv-sum-${grain.kind}${tone}`, `×${times(kind.multiplier)}`));
    });
    parts.push(span('rv-sum-equals', '='));
    const total = span('rv-sum-total', String(plan.worth));
    if (worthBefore >= 0 && plan.worth !== worthBefore) {
      total.classList.add(plan.worth > worthBefore ? 'rv-sum-up' : 'rv-sum-down');
    }
    parts.push(total);
    const product = kept.reduce(
      (value, index) =>
        value * (kinds.find((entry) => entry.id === log.grains[index]?.kind)?.multiplier ?? 1),
      1,
    );
    if (product > plan.multiplier) parts.push(span('rv-sum-cap', `cap ×${times(plan.multiplier)}`));
    ui.sum.replaceChildren(...parts);
    // Stars for this plan.
    const stars = starsFor(this.#deps.game.data.riving, plan.worth, round.best.worth);
    ui.starIcons.forEach((icon, index) => {
      const on = index < stars;
      icon.classList.toggle('rv-star-on', on);
      if (on && index >= this.#starsShown) {
        icon.classList.remove('rv-star-pop');
        // Reading the layout restarts the pop.
        icon.getBoundingClientRect();
        icon.classList.add('rv-star-pop');
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
  #showCard(event: Extract<RivingEvent, { type: 'done' }>): void {
    const log = this.#log;
    if (!log) return;
    const ui = this.#ui;
    const { plan, best, stars, bonus, banked } = event;
    const kinds = this.#deps.game.data.riving.grainKinds;
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
    ui.cardText.textContent = 'The warchest has no logs to rive. Fell some at the tree line.';
    ui.next.hidden = true;
    ui.card.hidden = false;
    ui.logName.textContent = '';
  }

  #flash(message: string, tone: 'good' | 'bad' | 'warn'): void {
    const flash = document.createElement('div');
    flash.className = `rv-flash rv-${tone}`;
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
  return `<svg class="rv-head-icon" viewBox="0 0 40 40" aria-hidden="true"><circle class="rv-head-bark" cx="20" cy="20" r="18"/><circle class="rv-head-wood" cx="20" cy="20" r="15.5"/><circle class="rv-head-ring" cx="20" cy="20" r="10"/><g class="rv-head-cuts">${lines}</g><circle class="rv-head-hub" cx="20" cy="20" r="3"/></svg>`;
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
