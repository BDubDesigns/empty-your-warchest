import * as THREE from 'three';
import type { ScreenView } from '../../../app/screen';
import type { Haptics } from '../../../app/haptics';
import { Sfx } from '../../../app/sfx';
import { SkillBar, type XpDeposit } from '../../../app/skillBar';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import type { EventLogger, Game, LiveTuning } from '../../../core';
import type { RivingFeel, RivingLog } from '../../../data';
import { generateLog } from '../logic/generate';
import {
  DEG,
  isWhole,
  normalize,
  splitLines,
  splitPiece,
  thinSide,
  type Fate,
  type Piece,
} from '../logic/pieces';
import { RivingRound, type AimPreview, type RivingEvent } from '../logic/round';

export interface Rive3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<RivingFeel>;
  haptics: Haptics;
  /** Leaves the station (the end card's Back to camp). */
  onLeave: () => void;
}

/** One-time flag: the practice log (no grains) has been riven. */
const TUTORIAL = 'tutorial.riving';
/** The chopping block the log stands on: its height, and how much wider than the log it is. */
const BLOCK_HEIGHT = 0.55;
const BLOCK_SPREAD = 1.25;
/** How far apart pieces stand after each split (world units per split), so the cracks show. */
const PIECE_GAP = 0.07;
/** Finished pieces shrink as they go to the pile, so it stays out of the way. */
const PILE_SCALE = 0.4;
/** How high the piece being worked on is lifted, so it stands out. */
const LIFT = 0.06;
/** The camera: how far it looks down (radians) and how far back it sits. */
const CAMERA_ELEVATION = 58 * DEG;
const CAMERA_DISTANCE = 9;
/** While the crack drifts: how often it creaks and buzzes (seconds). */
const STRAIN_TICK = 0.11;
/** How far the froe's handle tips over by the end of a lever (radians). */
const LEVER_TIP = 70 * DEG;
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
  ringDark: '#c99d64',
  ringLight: '#e2c08c',
  pith: '#8a5d32',
  check: '#3b2415',
  grain: { rot: '#4b3a1f', silver: '#cfd8dc', gold: '#f2c037' } as Record<string, string>,
  grainEdge: { rot: '#2c2112', silver: '#8fa0a8', gold: '#a87a12' } as Record<string, string>,
  cancelled: '#9b9284',
  glowGood: '#7fd65a',
  glowBad: '#ff4a3a',
  froe: 0x9aa3a8,
  handle: 0x8b5a2b,
  mallet: 0x7a5232,
  guide: 0xf2ead3,
  danger: 0xe0503c,
  gold: 0xf0cd5c,
  crack: 0x1d120a,
  strain: 0xe0503c,
  pull: [0xf2ead3, 0xf0cd5c, 0xf09a3c, 0xe0503c],
  good: 0x7fd65a,
  spoiled: 0x7c7468,
};

interface PieceVisual {
  piece: Piece;
  mesh: THREE.Group;
  /** Where it's easing from and to, and when it set off. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromTilt: number;
  toTilt: number;
  fromScale: number;
  toScale: number;
  movedAt: number;
  fate?: Fate;
}

/**
 * Riving in 3D: a log stood on end on a chopping block, seen from above, split with a froe and a
 * mallet into staves. The rules (RivingRound) decide everything; this draws them and feeds them
 * touches. Each piece is a wedge of the log whose top shows its part of the end grain (rings,
 * checks, grains), drawn from the same data the rules use.
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
  /** The grains the aim would cut, as last drawn (glowing) and shown as chips. */
  #aimedKey = '';
  #froe!: { root: THREE.Group; blade: THREE.Mesh; handle: THREE.Group };
  #mallet!: THREE.Group;
  #guide!: { lines: THREE.Mesh[] };
  #cracks: THREE.Mesh[] = [];
  #pointer:
    { id: number; startX: number; startY: number; base: number; aiming: boolean } | undefined;
  /** Total handle drag (pixels) this lever, carried across finger lifts. */
  #leverPixels = 0;
  #strainTickAt = 0;
  /** Which way the thin side looks on screen this lever: +1 right, −1 left (for leaning). */
  #thinSign = 1;
  #sideLabels: HTMLElement[] = [];
  #shake = 0;
  #frozenUntil = 0;
  #bankedXp: XpDeposit | undefined;
  #lastPhase = '';
  #stavesShown = 0;

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
    delete document.body.dataset.riving;
    this.#lastPhase = '';
  }

  // Logs

  /** The next hand-made log in turn, if there's a log in the warchest to rive. */
  #startLog(): void {
    const { game } = this.#deps;
    const rules = game.data.riving;
    const recipe = game.data.recipes.find((entry) => entry.id === rules.recipe);
    const input = recipe?.inputs[0];
    this.#ui.card.hidden = true;
    if (input && !game.inventory.has(input.item, input.count)) {
      this.#round = undefined;
      this.#clearLog();
      this.#showNoLogs();
      return;
    }
    // The first log ever is the practice one; after that every log is new.
    const tutorial = !game.hasDone(TUTORIAL);
    const seed = Date.now() >>> 0;
    const log = tutorial ? rules.tutorialLog : generateLog(rules, seed);
    this.#log = log;
    this.#round = new RivingRound(
      log,
      {
        logger: this.#deps.logger,
        feel: () => this.#deps.feel.values,
        rules,
        bank: (worth, staves) => {
          const before = game.xp(this.#skill);
          // XP on the staves split; the grains multiply what goes into the warchest.
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
    );
    this.#stavesShown = 0;
    this.#leverPixels = 0;
    this.#aimedKey = '';
    this.#buildLog(log);
    this.#ui.logName.textContent = tutorial ? 'Practice log' : this.#grainNames(log);
  }

  #clearLog(): void {
    for (const visual of this.#pieces.values()) this.#logRoot.remove(visual.mesh);
    this.#pieces.clear();
    this.#faceTexture?.dispose();
    this.#faceTexture = undefined;
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
    this.#froe = this.#buildFroe();
    this.#mallet = this.#buildMallet();
    this.#guide = this.#buildGuide();
  }

  /** The froe: a flat blade laid along the split line, its handle standing up from the outer end. */
  #buildFroe() {
    const root = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.07, 0.05),
      new THREE.MeshLambertMaterial({ color: COLORS.froe }),
    );
    blade.castShadow = true;
    root.add(blade);
    const handle = new THREE.Group();
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.055, 0.9, 10),
      new THREE.MeshLambertMaterial({ color: COLORS.handle }),
    );
    grip.position.y = 0.45;
    grip.castShadow = true;
    handle.add(grip);
    root.add(handle);
    root.visible = false;
    this.#logRoot.add(root);
    return { root, blade, handle };
  }

  /** The mallet: a short club that comes down on the froe's back. */
  #buildMallet(): THREE.Group {
    const mallet = new THREE.Group();
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.32, 14),
      new THREE.MeshLambertMaterial({ color: COLORS.mallet }),
    );
    head.rotation.z = Math.PI / 2;
    head.position.set(0, 0.62, 0);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, 0.62, 8),
      new THREE.MeshLambertMaterial({ color: COLORS.handle }),
    );
    shaft.position.y = 0.31;
    for (const part of [head, shaft]) part.castShadow = true;
    mallet.add(head, shaft);
    mallet.visible = false;
    this.#logRoot.add(mallet);
    return mallet;
  }

  /** The aim guide: a line along each end of the split, drawn over everything. */
  #buildGuide() {
    const lines = [0, 1].map(() => {
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.translate(0.5, 0, 0);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: COLORS.guide,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 10;
      mesh.visible = false;
      this.#logRoot.add(mesh);
      return mesh;
    });
    return { lines };
  }

  /** The log as one piece (the whole end face), its end grain drawn from data. */
  #buildLog(log: RivingLog): void {
    this.#clearLog();
    const round = this.#round;
    if (!round) return;
    this.#faceTexture = this.#drawFace(log, round.live);
    for (const piece of round.pieces) this.#addPiece(piece, new THREE.Vector3(), 0);
  }

  /**
   * The end grain: growth rings round the pith, checks as dark cracks, and each grain as a
   * coloured patch over the arc of the face it covers (the arc the rules use), marked with what
   * it's worth. A grain a split has cut through is drawn faded and crossed out.
   */
  #drawFace(
    log: RivingLog,
    live: ReadonlySet<number>,
    /** Grains the current aim would cut: they glow, green for bad ones, red for good ones. */
    aimed: readonly number[] = [],
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
    log.grains.forEach((grain, index) => {
      const alive = live.has(index);
      // Canvas angles run clockwise, so the face's angles are negated.
      const from = -(grain.angle + grain.width / 2) * DEG;
      const to = -(grain.angle - grain.width / 2) * DEG;
      context.beginPath();
      context.arc(middle, middle, radius * 0.93, from, to);
      context.arc(middle, middle, radius * 0.16, to, from, true);
      context.closePath();
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

  /** The log's grains, for its name: "Gold ×3 · Rot ×½". */
  #grainNames(log: RivingLog): string {
    const kinds = this.#deps.game.data.riving.grainKinds;
    const names = log.grains.map((grain) => {
      const kind = kinds.find((entry) => entry.id === grain.kind);
      return kind ? `${kind.name} ×${times(kind.multiplier)}` : grain.kind;
    });
    return names.length > 0 ? names.join(' · ') : 'Plain log';
  }

  /**
   * A piece as a solid wedge standing on the block: bark round the outside, fresh wood on the
   * faces a split opened, and its top showing its part of the end grain.
   */
  #addPiece(piece: Piece, at: THREE.Vector3, movedAt: number): PieceVisual {
    const log = this.#log;
    if (!log) throw new Error('No log');
    const { radius, height } = log;
    const root = new THREE.Group();
    const segments = Math.max(4, Math.ceil((piece.width / (Math.PI * 2)) * 48));
    // The top: the piece's outline, its UVs in world units to show its part of the end face.
    const shape = new THREE.Shape();
    if (isWhole(piece)) {
      shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    } else {
      shape.moveTo(0, 0);
      shape.absarc(0, 0, radius, piece.start, piece.start + piece.width, false);
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
        piece.start + Math.PI / 2,
        piece.width,
      ),
      new THREE.MeshLambertMaterial({ color: COLORS.bark, side: THREE.DoubleSide }),
    );
    bark.position.y = height / 2;
    root.add(top, bark);
    // The split faces, from the pith out along each edge.
    if (!isWhole(piece)) {
      for (const edge of [piece.start, piece.start + piece.width]) {
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
      if (child instanceof THREE.Mesh) {
        child.castShadow = child.receiveShadow = true;
        child.userData.piece = piece.id;
      }
    });
    root.position.copy(at);
    this.#logRoot.add(root);
    const visual: PieceVisual = {
      piece,
      mesh: root,
      from: at.clone(),
      to: at.clone(),
      fromTilt: 0,
      toTilt: 0,
      fromScale: 1,
      toScale: 1,
      movedAt,
    };
    this.#pieces.set(piece.id, visual);
    return visual;
  }

  /** Where a piece stands: pushed out from the pith along its middle, more the more it's split. */
  #restingPlace(piece: Piece): THREE.Vector3 {
    if (isWhole(piece)) return new THREE.Vector3();
    const angle = piece.start + piece.width / 2;
    return this.#direction(angle).multiplyScalar(PIECE_GAP * piece.depth);
  }

  /** The face's angle as a direction on the block (the face's y runs away from the camera). */
  #direction(angle: number): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
  }

  /**
   * Where a finished piece goes: staves lie in a row in front of the block, spoiled and wasted
   * pieces to the back, out of the way.
   */
  #finishedPlace(fate: Fate, index: number): THREE.Vector3 {
    if (fate === 'stave') return new THREE.Vector3(-1.3 + index * 0.17, -BLOCK_HEIGHT, 1.5);
    return new THREE.Vector3(-1.5 + index * 0.25, -BLOCK_HEIGHT, -1.6);
  }

  #move(visual: PieceVisual, to: THREE.Vector3, tilt: number, scale = 1): void {
    const round = this.#round;
    visual.from.copy(visual.mesh.position);
    visual.fromTilt = visual.mesh.rotation.z;
    visual.fromScale = visual.mesh.scale.x;
    visual.to.copy(to);
    visual.toTilt = tilt;
    visual.toScale = scale;
    visual.movedAt = round?.now ?? 0;
  }

  // Events

  #onEvent(event: RivingEvent): void {
    const feel = this.#deps.feel.values;
    const round = this.#round;
    if (!round) return;
    if (event.type === 'strike') {
      // The mallet lands as the swing ends; the thock plays then (see the loop).
      this.#mallet.visible = true;
    } else if (event.type === 'split') {
      const parent = this.#pieces.get(event.piece.id);
      if (parent) {
        this.#logRoot.remove(parent.mesh);
        this.#pieces.delete(event.piece.id);
      }
      for (const child of event.children) {
        const visual = this.#addPiece(
          child,
          parent?.mesh.position.clone() ?? new THREE.Vector3(),
          round.now,
        );
        this.#move(visual, this.#restingPlace(child), 0);
      }
      const log = this.#log;
      if (log && event.cut.length > 0) this.#drawFace(log, round.live);
      // The next aim redraws its glow and chips.
      this.#aimedKey = '';
      if (event.result !== 'clean') {
        this.#play('crash-wood', 0.8, -300);
        this.#play(`creak-${1 + Math.floor(Math.random() * 3)}`, 0.7, -500);
        this.#deps.haptics.pulse(feel.buzzRunoutMs);
        this.#shake = 0.12 * feel.shakeStrength;
        const degrees = Math.round((event.lost?.width ?? 0) / DEG);
        this.#flash(
          `${event.result === 'thin' ? 'Ran out to the thin side' : 'Leaned too far'}! −${String(degrees)}°`,
          'bad',
        );
      } else {
        this.#play('chop-perfect', 0.8, 200);
        this.#play(`land-${1 + Math.floor(Math.random() * 3)}`, 0.5, 300);
        this.#deps.haptics.pulse(feel.buzzCleanMs);
        this.#flash('Clean split!', 'good');
      }
      const kinds = this.#deps.game.data.riving.grainKinds;
      for (const index of event.cut) {
        const kind = kinds.find((entry) => entry.id === log?.grains[index]?.kind);
        if (!kind) continue;
        const bad = kind.multiplier < 1;
        window.setTimeout(() => {
          this.#flash(
            bad ? `${kind.name} cut out!` : `${kind.name} cut: ×${times(kind.multiplier)} gone`,
            bad ? 'good' : 'warn',
          );
        }, 450);
      }
    } else if (event.type === 'finished') {
      const visual = this.#pieces.get(event.piece.id);
      if (!visual) return;
      visual.fate = event.fate;
      const done = round.finished.filter(
        (entry) => (entry.fate === 'stave') === (event.fate === 'stave'),
      );
      const place = this.#finishedPlace(event.fate, done.length - 1);
      this.#move(visual, place, event.fate === 'stave' ? Math.PI / 2 : Math.PI / 2.4, PILE_SCALE);
      if (event.fate !== 'stave') {
        visual.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
            child.material.color.setHex(COLORS.spoiled);
            child.material.map = null;
          }
        });
      } else {
        this.#stavesShown += 1;
        this.#sfx.play('star', 0.35, 300 + this.#stavesShown * 120);
      }
    } else {
      this.#showCard(event.staves, event.kept, event.multiplier, event.worth);
      window.setTimeout(() => {
        this.#pourStaves(event.banked);
      }, 450);
    }
  }

  /** The finished log's staves fly from the pile into the chest, and its XP ticks in with them. */
  #pourStaves(staves: number): void {
    const xp = this.#bankedXp;
    this.#bankedXp = undefined;
    if (staves <= 0) return;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const points: ScreenPoint[] = [...this.#pieces.values()]
      .filter((visual) => visual.fate === 'stave')
      .map((visual) => {
        const projected = visual.mesh.getWorldPosition(new THREE.Vector3()).project(this.#camera);
        return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
      });
    this.#hud.hold(staves, (share) => xp?.arrive(share)).pour(points);
  }

  // Loop

  #loop(time: number): void {
    this.#timer.update(time);
    const realDt = Math.min(this.#timer.getDelta(), 0.05);
    const round = this.#round;
    const frozen = performance.now() < this.#frozenUntil;
    if (round && !frozen) {
      const before = round.phase.kind;
      round.tick(realDt);
      // Read again: the tick moves the round on.
      const after: string = round.phase.kind;
      if (before === 'swing' && after === 'lever') {
        this.#strikeLanded();
        this.#findThinSide();
      }
    }
    this.#updatePieces();
    this.#updateTools();
    this.#updateUi();
    this.#updateCamera(realDt);
    this.#renderer.render(this.#scene, this.#camera);
  }

  #strikeLanded(): void {
    const feel = this.#deps.feel.values;
    this.#play('chop-perfect', 0.9, -200);
    this.#play(`chop-${1 + Math.floor(Math.random() * 3)}`, 0.5);
    this.#deps.haptics.pulse(feel.buzzStrikeMs);
    this.#shake = 0.06 * feel.shakeStrength;
    this.#frozenUntil = performance.now() + feel.hitStopMs;
    this.#leverPixels = 0;
  }

  #updatePieces(): void {
    const round = this.#round;
    if (!round) return;
    const seconds = this.#deps.feel.values.pieceSeconds;
    const current = round.current;
    for (const visual of this.#pieces.values()) {
      const t = Math.min(Math.max((round.now - visual.movedAt) / seconds, 0), 1);
      const eased = 1 - (1 - t) ** 3;
      const position = visual.from.clone().lerp(visual.to, eased);
      // Finished pieces hop as they go to the pile.
      if (visual.fate) position.y += Math.sin(eased * Math.PI) * 0.5;
      if (!visual.fate && current?.id === visual.piece.id && round.phase.kind === 'aim') {
        position.y += LIFT;
      }
      visual.mesh.position.copy(position);
      visual.mesh.rotation.z = visual.fromTilt + (visual.toTilt - visual.fromTilt) * eased;
      visual.mesh.scale.setScalar(visual.fromScale + (visual.toScale - visual.fromScale) * eased);
    }
  }

  /** The froe on the aim line, the mallet coming down on it, the guide and the crack. */
  #updateTools(): void {
    const round = this.#round;
    const log = this.#log;
    const phase = round?.phase;
    const piece = round?.current;
    const { root, blade, handle } = this.#froe;
    for (const line of this.#guide.lines) line.visible = false;
    for (const crack of this.#cracks) crack.visible = false;
    if (!round || !log || !phase || phase.kind === 'done' || !piece) {
      root.visible = this.#mallet.visible = false;
      return;
    }
    const whole = isWhole(piece);
    const lines = splitLines(piece, phase.angle);
    const base = this.#restingPlace(piece).setY(log.height + (phase.kind === 'aim' ? LIFT : 0));
    // The froe: along the line, from the pith out (across the log for the first split).
    const along = this.#direction(phase.angle);
    const length = whole ? log.radius * 2 : log.radius;
    const middle = whole ? base.clone() : base.clone().addScaledVector(along, log.radius / 2);
    root.visible = true;
    root.position.copy(middle);
    root.rotation.set(0, Math.atan2(-along.z, along.x), 0);
    blade.scale.set(length * 0.98, 1, 1);
    handle.position.set((length * 0.98) / 2, 0, 0);
    const lever = phase.kind === 'lever' ? phase.lever : undefined;
    const progress = lever?.progress ?? 0;
    // Driven in by the strike, deeper as it levers; the handle tips over as the crack opens.
    blade.position.y =
      phase.kind === 'aim' || phase.kind === 'swing' ? 0.03 : -0.02 - progress * 0.06;
    handle.rotation.set(progress * LEVER_TIP, 0, 0);
    handle.position.y = blade.position.y;
    // The mallet: raised over the blade, swinging down during the strike.
    const swing =
      phase.kind === 'swing' ? Math.min((round.now - phase.at) / round.feel.strikeSeconds, 1) : 1;
    this.#mallet.visible = phase.kind === 'swing';
    this.#mallet.position.copy(middle).add(new THREE.Vector3(0, 0, 0.55));
    this.#mallet.rotation.set(-(1 - swing ** 2) * 1.3 - 0.25, Math.atan2(-along.z, along.x), 0);
    // The guide: each line along the end face, warming from white to red the harder it'll pull.
    if (phase.kind === 'aim') {
      const preview = round.aimPreview;
      // Green when it cuts out only rot, red through gold or silver; else by how hard it'll pull.
      const kinds = this.#deps.game.data.riving.grainKinds;
      const multipliers = (preview?.cut ?? []).map(
        (index) => kinds.find((entry) => entry.id === log.grains[index]?.kind)?.multiplier ?? 1,
      );
      const color = multipliers.some((value) => value > 1)
        ? COLORS.danger
        : multipliers.length > 0
          ? COLORS.good
          : (COLORS.pull[pullLevel(preview?.unevenness ?? 0)] ?? COLORS.guide);
      lines.forEach((angle, index) => {
        const mesh = this.#guide.lines[index];
        if (!mesh) return;
        mesh.visible = true;
        mesh.position.copy(base).setY(log.height + LIFT + 0.01);
        mesh.rotation.set(0, Math.atan2(-this.#direction(angle).z, this.#direction(angle).x), 0);
        mesh.scale.set(log.radius, 1, 0.035);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      });
    }
    // The crack racing down the bark at each end of the line, reddening as the bubble drifts.
    if (lever) {
      lines.forEach((angle, index) => {
        const crack = this.#crack(index);
        const out = this.#direction(angle);
        crack.visible = true;
        const depth = log.height * Math.max(progress, 0.04);
        crack.scale.set(1, depth, 1);
        crack.position.copy(this.#restingPlace(piece)).addScaledVector(out, log.radius + 0.005);
        crack.position.y = log.height - depth / 2;
        crack.rotation.set(0, Math.atan2(-out.z, out.x) + Math.PI / 2, 0);
        (crack.material as THREE.MeshBasicMaterial).color
          .setHex(COLORS.crack)
          .lerp(new THREE.Color(COLORS.strain), Math.min(Math.abs(lever.offset), 1));
      });
      this.#driftFeedback();
    }
  }

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

  /** While the crack drifts off straight: a creak and buzz ticks, stronger the further it's gone. */
  #driftFeedback(): void {
    const round = this.#round;
    const phase = round?.phase;
    if (!round || phase?.kind !== 'lever') return;
    const drift = Math.abs(phase.lever.offset);
    if (drift < 0.3 || round.now < this.#strainTickAt) return;
    this.#strainTickAt = round.now + STRAIN_TICK;
    const feel = this.#deps.feel.values;
    this.#play(`creak-${1 + Math.floor(Math.random() * 3)}`, 0.3 + drift * 0.45, drift * 900);
    this.#deps.haptics.pulse(feel.buzzCrackMs + Math.round(drift * 14));
  }

  /**
   * At the start of a lever: which way the thin side looks on screen, so a sideways drag away
   * from it pushes the bubble back.
   */
  #findThinSide(): void {
    const round = this.#round;
    const piece = round?.current;
    const phase = round?.phase;
    const log = this.#log;
    if (!round || !piece || !log || phase?.kind !== 'lever') return;
    const pieces = splitPiece(piece, phase.angle);
    const [thin, thick] = thinSide(pieces) === 0 ? pieces : [pieces[1], pieces[0]];
    const x = (part: Piece) =>
      this.#facePoint(piece, part.start + part.width / 2, log.radius * 0.6).project(this.#camera).x;
    this.#thinSign = x(thin) >= x(thick) ? 1 : -1;
  }

  /** A point on a piece's top, `distance` from the pith at `angle`, in world space. */
  #facePoint(piece: Piece, angle: number, distance: number): THREE.Vector3 {
    const log = this.#log;
    return this.#restingPlace(piece)
      .addScaledVector(this.#direction(angle), distance)
      .setY(BLOCK_HEIGHT + (log?.height ?? 1.6) + LIFT);
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
    // Narrow portrait screens: widen the view so the whole block and pile fit across.
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
      const phase = round.phase;
      this.#pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        base: this.#leverPixels,
        // A finger keeps doing what it started: one levering on doesn't aim the next piece.
        aiming: phase.kind === 'aim',
      };
      if (phase.kind === 'aim') {
        const hit = this.#pieceAt(event.clientX, event.clientY);
        if (hit && hit !== round.current?.id) round.select(hit);
        else this.#aimAt(event.clientX, event.clientY);
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      const pointer = this.#pointer;
      const round = this.#round;
      if (!pointer || pointer.id !== event.pointerId || !round) return;
      const phase = round.phase;
      if (phase.kind === 'aim') {
        if (pointer.aiming) this.#aimAt(event.clientX, event.clientY);
      } else if (phase.kind === 'lever' && !pointer.aiming) {
        // Pulling the handle down runs the crack; sideways moves the bubble (lean against the
        // pull, away from the thin side).
        this.#leverPixels = pointer.base + Math.max(event.clientY - pointer.startY, 0);
        round.drag(this.#leverPixels);
        const lean = (event.clientX - pointer.startX) / this.#deps.feel.values.leanTravel;
        round.lean(lean * this.#thinSign);
      }
    });
    const end = (event: PointerEvent) => {
      const pointer = this.#pointer;
      if (pointer?.id !== event.pointerId) return;
      // Where the finger lifted counts too: moves can be dropped on a fast flick.
      if (this.#round?.phase.kind === 'lever' && !pointer.aiming) {
        this.#leverPixels = pointer.base + Math.max(event.clientY - pointer.startY, 0);
        this.#round.drag(this.#leverPixels);
        this.#round.lean(0);
      }
      this.#pointer = undefined;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /** The froe turns to point from the pith toward the finger, on the log's top. */
  #aimAt(clientX: number, clientY: number): void {
    const round = this.#round;
    const log = this.#log;
    const piece = round?.current;
    if (!round || !log || !piece) return;
    const point = this.#onTop(clientX, clientY, log.height + BLOCK_HEIGHT);
    if (!point) return;
    const centre = this.#restingPlace(piece);
    const angle = Math.atan2(-(point.z - centre.z), point.x - centre.x);
    round.aimTo(normalize(angle));
  }

  #onTop(clientX: number, clientY: number, height: number): THREE.Vector3 | undefined {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    return this.#raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? undefined;
  }

  /** The unfinished piece under the finger, if any. */
  #pieceAt(clientX: number, clientY: number): string | undefined {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const meshes = [...this.#pieces.values()]
      .filter((visual) => !visual.fate)
      .map((visual) => visual.mesh);
    const [hit] = this.#raycaster.intersectObjects(meshes, true);
    const id: unknown = hit?.object.userData.piece;
    return typeof id === 'string' ? id : undefined;
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
    const tally = el('div', 'rv-tally');
    const hint = el('div', 'rv-hint');
    // While aiming: a chip for each grain the line would cut, and what it does to the log.
    const chips = el('div', 'rv-chips');
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
    left.setAttribute('aria-label', 'Turn the froe counter-clockwise');
    right.setAttribute('aria-label', 'Turn the froe clockwise');
    const finish = button('Keep', 'rv-button rv-finish', () => {
      this.#round?.finish();
    });
    controls.append(left, strike, right, finish);
    // The bubble while levering: drifts toward the thin side; drag sideways to keep it centred.
    const level = el('div', 'rv-level');
    const levelBubble = el('div', 'rv-level-bubble');
    const levelThin = el('div', 'rv-level-thin', 'thin side');
    level.append(levelThin, levelBubble);
    const sideLabels = el('div', 'rv-sides');
    const card = el('div', 'rv-card');
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
    card.append(cardTitle, cardText, cardButtons);
    card.hidden = true;
    root.append(logName, tally, sideLabels, chips, hint, flashes, controls, level, card);
    this.#element.append(root);
    return {
      root,
      logName,
      tally,
      hint,
      flashes,
      controls,
      left,
      strike,
      right,
      finish,
      level,
      levelBubble,
      levelThin,
      sideLabels,
      chips,
      card,
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
      document.body.dataset.riving = phase;
    }
    if (!round) {
      ui.controls.hidden = true;
      ui.hint.textContent = '';
      ui.tally.textContent = '';
      return;
    }
    const logs = this.#deps.game.inventory.count('log');
    const multiplier = round.multiplierLeft;
    const grains = multiplier === 1 ? '' : ` · grains ×${times(multiplier)}`;
    const staves = round.staves + round.stavesReady;
    ui.tally.textContent = `Staves ${String(staves)} / ${String(round.maxStaves)}${grains} · logs left ${String(logs)}`;
    const kind = round.phase.kind;
    ui.controls.hidden = kind === 'done';
    ui.left.hidden = ui.right.hidden = ui.strike.hidden = kind !== 'aim';
    ui.finish.hidden = !round.canFinish;
    ui.finish.textContent = `Keep ${String(staves)}`;
    const preview = round.aimPreview;
    this.#showSides(preview);
    this.#showCuts(preview);
    const pull = pullLevel(preview?.unevenness ?? 0);
    const practiceRot = this.#log?.id === this.#deps.game.data.riving.tutorialLog.id;
    const hints: Record<string, string> = {
      aim:
        (preview?.cut.length ?? 0) > 0
          ? preview?.throughRot
            ? 'Rot wobbles the crack: hold it steady'
            : ''
          : pull > 0
            ? "Uneven: it'll pull to the thin side · lean against it"
            : practiceRot && round.multiplierLeft < 1
              ? 'Rot halves the whole log: aim a line through it to cut it out'
              : preview?.check
                ? 'Along a check: it splits easier'
                : 'Drag to aim anywhere · thinner staves = more staves, harder to hold',
      swing: '',
      lever: 'Drag down to open it · slide sideways to keep the bubble in the middle',
      done: '',
    };
    ui.hint.textContent = hints[kind] ?? '';
    ui.hint.classList.toggle(
      'rv-hint-warn',
      kind === 'aim' &&
        (pull >= 2 || (preview ? preview.multiplierAfter < preview.multiplierNow : false)),
    );
    const phaseNow = round.phase;
    const lever = phaseNow.kind === 'lever' ? phaseNow.lever : undefined;
    ui.level.hidden = !lever;
    if (lever) {
      const x = Math.max(-1, Math.min(1, lever.offset)) * this.#thinSign;
      ui.levelBubble.style.left = `${String(50 + x * 45)}%`;
      ui.levelBubble.classList.toggle('rv-level-danger', Math.abs(lever.offset) > 0.6);
      ui.levelThin.classList.toggle('rv-level-thin-left', this.#thinSign < 0);
    }
    this.#element.dataset.crack = lever ? lever.progress.toFixed(2) : '';
    this.#element.dataset.bubble = lever ? lever.offset.toFixed(2) : '';
    this.#element.dataset.aim =
      round.phase.kind === 'aim' ? String(Math.round(normalize(round.phase.angle) / DEG)) : '';
  }

  /**
   * While aiming, the grains the line would cut: they glow on the log, and each gets a chip on its
   * own line (green for cutting out something bad, red for cutting something good), with the
   * log's multiplier before and after under them.
   */
  #showCuts(preview: AimPreview | undefined): void {
    const log = this.#log;
    const round = this.#round;
    const cut = preview?.cut ?? [];
    const key = preview ? `${cut.join(',')}|${String(preview.multiplierAfter)}` : '';
    if (key === this.#aimedKey || !log || !round) return;
    this.#aimedKey = key;
    this.#drawFace(log, round.live, cut);
    const kinds = this.#deps.game.data.riving.grainKinds;
    const chips = cut.flatMap((index) => {
      const kind = kinds.find((entry) => entry.id === log.grains[index]?.kind);
      if (!kind) return [];
      const chip = document.createElement('div');
      const bad = kind.multiplier < 1;
      chip.className = `rv-chip ${bad ? 'rv-chip-good' : 'rv-chip-bad'}`;
      chip.textContent = `${bad ? 'Cuts out' : 'Cuts'} the ${kind.name.toLowerCase()} ×${times(
        kind.multiplier,
      )}`;
      return [chip];
    });
    if (preview && chips.length > 0) {
      const total = document.createElement('div');
      total.className = 'rv-chip rv-chip-total';
      total.textContent = `Log ×${times(preview.multiplierNow)} → ×${times(preview.multiplierAfter)}`;
      chips.push(total);
    }
    this.#ui.chips.replaceChildren(...chips);
  }

  /**
   * While aiming: each side of the line labelled on the log with its width and what it'll be
   * (a stave, kindling, or a slab to split again), and the thin side with how hard it'll pull.
   */
  #showSides(preview: AimPreview | undefined): void {
    const ui = this.#ui;
    const round = this.#round;
    const piece = round?.current;
    const log = this.#log;
    if (!preview || !piece || !log) {
      ui.sideLabels.hidden = true;
      return;
    }
    ui.sideLabels.hidden = false;
    const { clientWidth: width, clientHeight: height } = this.#element;
    const names = { stave: 'stave', kindling: 'kindling', slab: 'split again' };
    preview.pieces.forEach((part, index) => {
      let label = this.#sideLabels[index];
      if (!label) {
        label = document.createElement('div');
        label.className = 'rv-side';
        ui.sideLabels.append(label);
        this.#sideLabels[index] = label;
      }
      const size = preview.sizes[index] ?? 'slab';
      const pull = index === preview.thin ? pullLevel(preview.unevenness) : 0;
      label.textContent = `${String(Math.round(part.width / DEG))}° ${names[size]}${
        pull > 0 ? ` ${'›'.repeat(pull)}` : ''
      }`;
      label.dataset.size = size;
      const at = this.#facePoint(piece, part.start + part.width / 2, log.radius * 0.55).project(
        this.#camera,
      );
      label.style.left = `${String(((at.x + 1) / 2) * width)}px`;
      label.style.top = `${String(((1 - at.y) / 2) * height)}px`;
    });
  }

  /**
   * The end card, as the sum it is: the staves kept, times each grain that counted, equals what
   * goes into the warchest. Grains cut or lost with a piece are listed under it.
   */
  #showCard(staves: number, kept: number[], multiplier: number, worth: number): void {
    const round = this.#round;
    const log = this.#log;
    if (!round || !log) return;
    const ui = this.#ui;
    const rules = this.#deps.game.data.riving;
    const kindOf = (index: number) =>
      rules.grainKinds.find((entry) => entry.id === log.grains[index]?.kind);
    const factors = kept.flatMap((index) => {
      const kind = kindOf(index);
      return kind ? [`×${times(kind.multiplier)}`] : [];
    });
    const product = kept.reduce((total, index) => total * (kindOf(index)?.multiplier ?? 1), 1);
    const sum = [`${String(staves)} stave${staves === 1 ? '' : 's'}`, ...factors].join(' ');
    const capped = product > multiplier ? ` (capped at ×${times(multiplier)})` : '';
    const runouts = round.finished.filter((entry) => entry.fate === 'runout').length;
    const kindling = round.finished.filter((entry) => entry.fate === 'kindling').length;
    const notes: string[] = [];
    if (runouts > 0) notes.push(`${String(runouts)} runout${runouts === 1 ? '' : 's'}`);
    if (kindling > 0) notes.push(`${String(kindling)} kindling`);
    log.grains.forEach((_, index) => {
      if (kept.includes(index)) return;
      const kind = kindOf(index);
      if (kind) notes.push(`${kind.name} ${round.live.has(index) ? 'lost' : 'cut'}`);
    });
    const perfect = staves === round.maxStaves;
    ui.cardTitle.textContent = `${perfect ? 'Perfect log! ' : ''}${String(worth)} staves`;
    ui.cardText.textContent = `${sum} = ${String(worth)}${capped}${
      notes.length > 0 ? `\n${notes.join(' · ')}` : ''
    }`;
    ui.next.hidden = false;
    ui.card.hidden = false;
  }

  #showNoLogs(): void {
    const ui = this.#ui;
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

/** How hard a split will pull, for the guide: 0 (even) to 3. */
function pullLevel(unevenness: number): number {
  if (unevenness < 0.08) return 0;
  if (unevenness < 0.25) return 1;
  if (unevenness < 0.45) return 2;
  return 3;
}
