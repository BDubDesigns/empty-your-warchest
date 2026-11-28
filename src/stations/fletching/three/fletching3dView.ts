import * as THREE from 'three';
import { gpuOf } from '../../../app/deviceHints';
import { groundMesh } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import { loadModel } from '../../../app/models';
import { capturePointer } from '../../../app/pointer';
import type { ScreenView } from '../../../app/screen';
import { Sfx } from '../../../app/sfx';
import { SkillBar } from '../../../app/skillBar';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import { textureBytes } from '../../../bench/logic/stats';
import type { EventLogger, Game, GraphicsSettings, GraphicsTier, LiveTuning } from '../../../core';
import type { Fletching, FletchingFeel } from '../../../data';
import { TreeLine } from '../../archery/three/scenery';
import {
  FletchingRound,
  type ArrowInHand,
  type FletchingEvent,
  type FletchingResult,
} from '../logic/round';
import { BENCH, COLORS, TAR_Y, buildBench, type BenchParts } from './bench';
import { ShaftRig } from './shaft';

export interface Fletching3DDeps {
  game: Game;
  logger: EventLogger;
  feel: LiveTuning<FletchingFeel>;
  /** The graphics tier: how sharp, shadows, feathers and trees. Calm frames feed it. */
  graphics: GraphicsSettings;
  haptics: Haptics;
  /** Leaves the station (the end card's Back to camp). */
  onLeave: () => void;
}

const DEG = Math.PI / 180;
const TREES = [
  'models/kenney/tree_default.glb',
  'models/kenney/tree_oak.glb',
  'models/kenney/tree_fat.glb',
];
const SOUNDS: Record<string, string> = {
  dip: 'audio/firemaking/steam-1.mp3',
  lift: 'audio/splitting/press-click.mp3',
  slap: 'audio/woodcutting/chop-1.mp3',
  miss: 'audio/woodcutting/land-2.mp3',
  bucket: 'audio/woodcutting/crash-wood.mp3',
  made: 'audio/warchest/log-in-2.mp3',
  star: 'audio/woodcutting/star.mp3',
};
/** The shaft moves from one place to the next over this long (seconds). */
const MOVE_SECONDS = 0.22;
/** The shaft's back end, held over the pot, and how deep it goes into the tar. */
const HOLD_HEIGHT = 0.12;
const DIP_DEPTH = 0.03;
/** The fletcher's feather hovers this far over the top of the shaft. */
const HAND_GAP = 0.022;
/** The card waits this long after the round ends, so the last arrow is seen to go. */
const CARD_DELAY = 0.6;

interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** The camera's two framings, and their fields of view (degrees, up and down). */
interface CameraViews {
  bench: Pose;
  jig: Pose;
  benchFov: number;
  jigFov: number;
}

/** The shaft's pose on the bench at a step: held over the pot, in the tar, or in the jig. */
type Spot = 'hold' | 'dip' | 'jig';

/**
 * The fletcher's bench in 3D: a shaft at a time, dipped in the tar pot (drag it down and hold,
 * lift in the green band), then turned in the jig while you tap a feather onto each mark as it
 * comes to the top, or shoved in the feather bucket for a duster, or left bare. The rules
 * (FletchingRound) decide everything; this draws them, feeds them the player's moves, and pours
 * each arrow into the chest.
 */
export class Fletching3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Fletching3DDeps;
  readonly #rules: Fletching;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(50, 1, 0.02, 80);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #ui: ReturnType<Fletching3DView['buildUi']>;
  readonly #bench: BenchParts;
  readonly #shaft: ShaftRig;
  readonly #sun: THREE.DirectionalLight;
  readonly #ground: THREE.Mesh;
  readonly #groundLooks: { high: THREE.Material; low: THREE.Material };
  readonly #trees: TreeLine;
  /** The camera's two framings: the bench, and close in on the jig. */
  #views: CameraViews;
  #tier: GraphicsTier;
  #look: Fletching['looks']['tiers']['high'];
  #round: FletchingRound | undefined;
  /** The shaft's pose now, and the move it's making. */
  #pose: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  #move: { from: Pose; to: Spot; at: number } | undefined;
  /** The camera's blend from the bench (0) to the jig (1). */
  #zoom = 0;
  #pointer: { id: number; startY: number; pull: number } | undefined;
  /** The arrow being shown going off to the chest, and when it pours. */
  #going:
    { arrow: ArrowInHand; item: string; xp: number; pourAt: number; bucket: boolean } | undefined;
  #clock = 0;
  #shake = 0;
  #endedAt: number | undefined;
  #cardShown = false;
  #bonus: { result: FletchingResult; deposit: ReturnType<WarchestHud['hold']> } | undefined;
  #perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };
  #statsAt = 0;

  private constructor(
    element: HTMLElement,
    deps: Fletching3DDeps,
    hud: WarchestHud,
    trees: THREE.Object3D[],
  ) {
    this.#element = element;
    this.#deps = deps;
    this.#hud = hud;
    this.#rules = deps.game.data.fletching;
    const station = deps.game.data.stations.find((entry) => entry.mechanic === 'fletching');
    this.#skill = station?.skill ?? 'fletching';
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    deps.graphics.noteGpu(gpuOf(this.#renderer.getContext()).gpu);
    this.#tier = deps.graphics.tier;
    this.#look = this.#rules.looks.tiers[this.#tier];
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.#look.pixelRatio));
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'fl-canvas';
    element.dataset.graphics = this.#tier;
    element.append(this.#renderer.domElement);
    this.#ui = this.buildUi();
    this.#sfx.load(SOUNDS);

    const looks = this.#rules.looks;
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.fog = new THREE.Fog(
      COLORS.sky,
      looks.treeDistance.min,
      looks.treeDistance.max * 1.8,
    );
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.6));
    this.#sun = new THREE.DirectionalLight(0xfff1dc, 2);
    this.#sun.position.set(0.8, 2.4, 1.6);
    this.#sun.shadow.mapSize.set(1024, 1024);
    const shadow = this.#sun.shadow.camera;
    shadow.left = shadow.bottom = -0.8;
    shadow.right = shadow.top = 0.8;
    shadow.near = 0.5;
    shadow.far = 5;
    this.#scene.add(this.#sun);

    // The ground: grass round the bench (plain on the low tier, its texture is a big one).
    this.#ground = groundMesh('meadowGrass', 30, 30);
    this.#ground.position.y = BENCH.groundY;
    this.#groundLooks = {
      high: this.#ground.material as THREE.Material,
      low: new THREE.MeshLambertMaterial({ color: COLORS.ground }),
    };
    this.#scene.add(this.#ground);
    const { high, low } = looks.tiers;
    this.#trees = new TreeLine(trees, Math.max(high.trees, low.trees), looks.seed, {
      near: looks.treeDistance.min,
      far: looks.treeDistance.max,
      height: looks.treeHeight,
    });
    this.#trees.group.position.y = BENCH.groundY;
    this.#scene.add(this.#trees.group);

    this.#bench = buildBench(Math.max(high.bucketFeathers, low.bucketFeathers));
    this.#scene.add(this.#bench.group, this.#bench.pointer);
    this.#shaft = new ShaftRig(
      {
        length: looks.shaftLength,
        radius: looks.shaftRadius,
        tarLength: looks.tarLength,
        featherLength: looks.featherLength,
      },
      this.#rules.marks,
    );
    this.#shaft.group.visible = false;
    this.#scene.add(this.#shaft.group);
    this.#views = this.#cameraViews();

    this.#applyTier(this.#tier, true);
    deps.graphics.onTier(({ tier }) => {
      this.#applyTier(tier);
    });
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  static async create(element: HTMLElement, deps: Fletching3DDeps): Promise<Fletching3DView> {
    const [hud, trees] = await Promise.all([
      WarchestHud.create(element, {
        game: deps.game,
        item: deps.game.data.fletching.arrows.fletched.item,
        haptics: deps.haptics,
        logger: deps.logger,
      }),
      Promise.all(TREES.map((url) => loadModel(url))),
    ]);
    return new Fletching3DView(element, deps, hud, trees);
  }

  /** Loads the models ahead of time (e.g. at the camp), so `create` doesn't wait for them. */
  static async preload(): Promise<void> {
    await Promise.all([WarchestHud.preload(), ...TREES.map((url) => loadModel(url))]);
  }

  // ScreenView

  start(): void {
    restoreContext(this.#renderer);
    this.#hud.wake();
    this.#resize();
    this.#startRound();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  /** Back to camp with an arrow half made puts it back as a plain shaft: the tar or feathers are lost. */
  leaveCost(): string | undefined {
    const step = this.#round?.phase === 'make' ? this.#round.arrow?.step : undefined;
    if (step !== 'dip' && step !== 'feathers') return undefined;
    return 'The arrow in your hand goes back as a plain shaft.';
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    this.#round?.exit();
    this.#round = undefined;
    this.#pointer = undefined;
    this.#going = undefined;
    this.#hud.sleep();
    this.#hud.settle();
    this.#skillBar.settle();
    this.#bonus = undefined;
    delete document.body.dataset.fletching;
    releaseContext(this.#renderer, this.#deps.logger, 'fletching3d');
  }

  // Rounds

  #startRound(): void {
    const { game } = this.#deps;
    const rules = this.#rules;
    this.#ui.card.hidden = true;
    this.#cardShown = false;
    this.#endedAt = undefined;
    this.#going = undefined;
    this.#zoom = 0;
    const count = (item: string) => game.inventory.count(item);
    if (count(rules.shaft) + count(rules.stave) === 0) {
      this.#round = undefined;
      this.#shaft.group.visible = false;
      this.#showEmpty();
      this.#updateUi();
      return;
    }
    this.#perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };
    this.#round = new FletchingRound(rules, this.#deps.feel.values, {
      logger: this.#deps.logger,
      level: game.level(this.#skill),
      count,
      spend: (item, amount) => {
        game.removeItems(item, amount);
      },
      bank: (items, xp) => {
        for (const stack of items) if (stack.count > 0) game.addItems(stack.item, stack.count);
        if (xp > 0) game.addXp(this.#skill, xp);
      },
      onEvent: (event) => {
        this.#onEvent(event);
      },
    });
    this.#ui.hint.hidden = false;
    this.#updateUi();
  }

  #onEvent(event: FletchingEvent): void {
    const feel = this.#deps.feel.values;
    const { haptics } = this.#deps;
    const round = this.#round;
    if (event.type === 'ready') {
      this.#shaft.reset();
      this.#shaft.showBand({ low: feel.tarLow, high: feel.tarHigh });
      this.#placeAt('hold');
      // It comes up from the bench.
      this.#pose.position.y -= 0.12;
      this.#moveTo('hold');
      return;
    }
    if (event.type === 'dip') {
      haptics.pulse(feel.buzzDipMs);
      this.#sfx.play('dip', 0.35, -200);
      this.#moveTo('dip');
      return;
    }
    if (event.type === 'lift') {
      this.#sfx.play('lift', 0.5, 200);
      this.#shaft.showBand(undefined);
      const state = event.arrow.tarState;
      this.#flash(
        state === 'good'
          ? '✓ Just right'
          : state === 'thin'
            ? 'Too little tar…'
            : 'Too much: globs!',
        state === 'good' ? 'good' : 'bad',
      );
      this.#moveTo('jig');
      return;
    }
    if (event.type === 'tap') {
      const { tap } = event;
      this.#shaft.addVane(tap.angle, event.arrow.taps.length - 1);
      if (tap.onMark) {
        haptics.pulse(feel.buzzSlapMs);
        this.#sfx.play('slap', 0.6, 300);
      } else {
        haptics.pulse(feel.buzzMissMs);
        this.#sfx.play('miss', 0.6, 200);
        this.#shake = Math.max(this.#shake, 0.004 * feel.shakeStrength);
        this.#flash(tap.offMs > 0 ? 'Late: crooked' : 'Early: crooked', 'bad');
      }
      return;
    }
    if (event.type === 'made') {
      const { arrow } = event;
      const bucket = arrow.way === 'bucket';
      if (bucket) {
        haptics.pulse(feel.buzzBucketMs);
        this.#sfx.play('bucket', 0.45, 500);
      }
      if (arrow.way === 'careful' && arrow.lost > 0) this.#shaft.slideVanes();
      const messages = {
        fletched: '🏹 Fletched!',
        duster: bucket ? '🪶 Feather duster!' : '🪶 Lopsided: a duster',
        bare: arrow.lost > 0 ? 'The feathers slid off: bare' : 'Bare arrow',
      } as const;
      if (arrow.made) this.#flash(messages[arrow.made], arrow.made === 'fletched' ? 'good' : 'meh');
      // It goes off to the chest at the end of its beat (after the bucket's plunge).
      const beat = round?.feel.finishSeconds ?? 0;
      this.#going = {
        arrow,
        item: event.item,
        xp: event.xp,
        pourAt: this.#clock + Math.max(beat * 0.8, 0.05),
        bucket,
      };
      this.#move = bucket ? { from: this.#copyPose(), to: 'jig', at: this.#clock } : this.#move;
      return;
    }
    // The end.
    this.#endedAt = this.#clock;
    if (event.bonus > 0) {
      this.#bonus = {
        result: event,
        deposit: this.#hud.hold(event.bonus, undefined, this.#rules.arrows.fletched.item),
      };
    }
    this.#logPerf(event);
  }

  /** Pours a made arrow into the chest from where it is, with its XP ticking in as it lands. */
  #pour(item: string, xp: number): void {
    const deposit = xp > 0 ? this.#skillBar.hold(xp) : undefined;
    const held = this.#hud.hold(
      1,
      deposit
        ? (share: number) => {
            deposit.arrive(share);
          }
        : undefined,
      item,
    );
    held.pour([this.#shaftOnScreen()]);
    this.#sfx.play('made', 0.5, 0);
  }

  // The loop

  #loop(time: number): void {
    this.#timer.update(time);
    const dt = Math.min(this.#timer.getDelta(), 0.1);
    this.#clock += dt;
    const round = this.#round;
    if (round) round.tick(dt);
    const going = this.#going;
    if (going && this.#clock >= going.pourAt) {
      this.#going = undefined;
      this.#pour(going.item, going.xp);
      if (round?.arrow === going.arrow || round?.phase === 'done')
        this.#shaft.group.visible = false;
    }
    this.#drawShaft(dt);
    this.#drawCamera(dt);
    this.#updateUi();
    if (round?.phase === 'done' && !this.#cardShown && this.#endedAt !== undefined) {
      if (this.#clock - this.#endedAt >= CARD_DELAY && round.result) this.#showCard(round.result);
    }
    // Calm frames tell the graphics tier how this phone copes.
    if (round?.phase === 'make') this.#deps.graphics.sample(dt * 1000);
    this.#renderer.render(this.#scene, this.#camera);
    const perf = this.#perf;
    perf.frames++;
    perf.seconds += dt;
    perf.worst = Math.max(perf.worst, dt);
    perf.calls = Math.max(perf.calls, this.#renderer.info.render.calls);
    perf.triangles = Math.max(perf.triangles, this.#renderer.info.render.triangles);
    if (this.#clock - this.#statsAt > 1) {
      this.#statsAt = this.#clock;
      this.#element.dataset.calls = String(this.#renderer.info.render.calls);
      this.#element.dataset.triangles = String(this.#renderer.info.render.triangles);
      this.#measureTextures();
    }
  }

  /** Where the shaft is, as the rules have it: its tar, its turn, its place on the bench. */
  #drawShaft(dt: number): void {
    const round = this.#round;
    const arrow = round?.arrow ?? this.#going?.arrow;
    const shaft = this.#shaft;
    shaft.update(dt);
    if (!round || !arrow) {
      this.#bench.pointer.visible = false;
      shaft.hand.visible = false;
      return;
    }
    const feel = round.feel;
    const live = round.arrow === arrow;
    const tar = live ? round.tar : (arrow.tar ?? 0);
    shaft.setTar(tar, tar > feel.tarHigh && arrow.way !== 'bucket');
    if (arrow.step === 'feathers' && live) shaft.setTurn(round.turn);
    // The shaft's place: following the finger down to the pot, in it, in the jig, or (the
    // bucket) plunged in and out of the feathers.
    const going = this.#going;
    if (going?.bucket && going.arrow === arrow) {
      this.#bucketPlunge(going);
    } else {
      const pull = arrow.step === 'shaft' ? (this.#pointer?.pull ?? 0) : 0;
      this.#follow(pull);
    }
    // The jig's pointer and the feather in hand, while feathers go on.
    const fletching = arrow.step === 'feathers' && live;
    shaft.showCollar(arrow.liftAt !== undefined && arrow.way !== 'bucket');
    const pointer = this.#bench.pointer;
    pointer.visible = fletching;
    const top = new THREE.Vector3(0, 0, 1).applyQuaternion(this.#pose.quaternion);
    // Over the index wheel's twelve o'clock, at the back end.
    const radius = this.#rules.looks.shaftRadius;
    const back = new THREE.Vector3(0, -radius * 1.2, 0)
      .applyQuaternion(this.#pose.quaternion)
      .add(this.#pose.position);
    pointer.position.copy(back).addScaledVector(top, radius * 2.9);
    pointer.quaternion
      .copy(this.#pose.quaternion)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    const hand = shaft.hand;
    hand.visible = fletching && round.canFletch && arrow.taps.length < this.#rules.marks;
    if (hand.visible) {
      const bob = Math.sin(this.#clock * 7) * 0.002;
      hand.position.set(0, shaft.fletchingMiddle - this.#rules.looks.featherLength / 2, 0);
      hand.position.z = radius * 0.9 + HAND_GAP + bob;
      hand.rotation.set(0, 0, 0);
    }
    // Shown right where the rules have them.
    this.#element.dataset.tar = tar.toFixed(2);
    this.#element.dataset.turn = String(Math.round(round.turn));
  }

  /** Puts the shaft at a spot straight away. */
  #placeAt(spot: Spot): void {
    const pose = this.#spotPose(spot, 0);
    this.#pose = pose;
    this.#move = undefined;
    this.#applyPose();
  }

  #moveTo(spot: Spot): void {
    this.#move = { from: this.#copyPose(), to: spot, at: this.#clock };
  }

  #copyPose(): Pose {
    return { position: this.#pose.position.clone(), quaternion: this.#pose.quaternion.clone() };
  }

  /** Eases the shaft toward its step's spot (or down with the finger, over the pot). */
  #follow(pull: number): void {
    const round = this.#round;
    const arrow = round?.arrow ?? this.#going?.arrow;
    if (!arrow) return;
    const spot: Spot =
      arrow.step === 'shaft'
        ? 'hold'
        : arrow.step === 'dip'
          ? 'dip'
          : arrow.liftAt === undefined
            ? 'hold'
            : 'jig';
    const target = this.#spotPose(spot, pull);
    const move = this.#move;
    if (move && move.to === spot) {
      const t = Math.min((this.#clock - move.at) / MOVE_SECONDS, 1);
      const ease = t * t * (3 - 2 * t);
      this.#pose.position.lerpVectors(move.from.position, target.position, ease);
      this.#pose.quaternion.slerpQuaternions(move.from.quaternion, target.quaternion, ease);
      if (t >= 1) this.#move = undefined;
    } else {
      this.#pose = target;
    }
    this.#applyPose();
  }

  /** The bucket: up and over from the jig, down into the feathers and out a duster. */
  #bucketPlunge(going: { pourAt: number }): void {
    const start = this.#move?.at ?? this.#clock;
    const length = Math.max(going.pourAt - start, 0.05);
    const t = Math.min((this.#clock - start) / length, 1);
    const from = this.#move?.from ?? this.#copyPose();
    const { x, z, height } = BENCH.bucket;
    const over = new THREE.Vector3(x, height + 0.16, z);
    const into = new THREE.Vector3(x, height * 0.35, z);
    const upright = new THREE.Quaternion();
    if (t < 0.4) {
      const ease = t / 0.4;
      this.#pose.position.lerpVectors(from.position, over, ease);
      this.#pose.quaternion.slerpQuaternions(from.quaternion, upright, ease);
    } else {
      // Shoved in and pulled out, a feather duster.
      const plunge = Math.sin(((t - 0.4) / 0.6) * Math.PI);
      this.#pose.position.lerpVectors(over, into, plunge);
      this.#pose.quaternion.copy(upright);
      if (t > 0.6) this.#shaft.showDuster(this.#look.dusterFeathers);
    }
    this.#applyPose();
  }

  /**
   * A spot's pose. Held over the pot: upright, its back end down (`pull` of the way down to the
   * tar, as the finger drags). In the tar: its back end under the surface. In the jig: lying back
   * end toward the camera, its +z (the shaft's 0°) at the top.
   */
  #spotPose(spot: Spot, pull: number): Pose {
    const { pot } = BENCH;
    const upright = new THREE.Quaternion();
    if (spot === 'hold' || spot === 'dip') {
      const share = spot === 'dip' ? 1 : Math.min(Math.max(pull, 0), 1) * 0.6;
      const top = TAR_Y + HOLD_HEIGHT;
      const bottom = TAR_Y - DIP_DEPTH;
      return {
        position: new THREE.Vector3(pot.x, top + (bottom - top) * share, pot.z),
        quaternion: upright,
      };
    }
    const along = BENCH.jig.along.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const top = up.clone().addScaledVector(along, -up.dot(along)).normalize();
    const side = new THREE.Vector3().crossVectors(along, top);
    const basis = new THREE.Matrix4().makeBasis(side, along, top);
    return {
      position: BENCH.jig.nock.clone(),
      quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
    };
  }

  #applyPose(): void {
    this.#shaft.group.position.copy(this.#pose.position);
    this.#shaft.group.quaternion.copy(this.#pose.quaternion);
  }

  /** The camera: the bench, moving in on the jig while the feathers go on. */
  #drawCamera(dt: number): void {
    const arrow = this.#round?.arrow;
    const close = arrow?.step === 'feathers' || (arrow?.step === 'made' && arrow.way === 'careful');
    const target = close ? 1 : 0;
    this.#zoom += (target - this.#zoom) * (1 - Math.exp(-dt * 7));
    const { bench, jig, benchFov, jigFov } = this.#views;
    this.#camera.position.lerpVectors(bench.position, jig.position, this.#zoom);
    this.#camera.quaternion.slerpQuaternions(bench.quaternion, jig.quaternion, this.#zoom);
    this.#camera.fov = benchFov + (jigFov - benchFov) * this.#zoom;
    this.#shake = Math.max(this.#shake - dt * 0.03, 0);
    if (this.#shake > 0) {
      this.#camera.position.x += (Math.random() - 0.5) * this.#shake;
      this.#camera.position.y += (Math.random() - 0.5) * this.#shake;
    }
    this.#camera.updateProjectionMatrix();
    this.#camera.updateMatrixWorld();
  }

  /**
   * The bench framing (`frameWidth` across the screen, looking down `pitch` from `distance`), and
   * the close one on the jig (`closeDistance` from the shaft's back end, behind and above it).
   */
  #cameraViews(): CameraViews {
    const looks = this.#rules.looks;
    const aspect = Math.max(this.#camera.aspect, 0.1);
    const target = new THREE.Vector3(0, 0.13, -0.02);
    const pitch = looks.pitch * DEG;
    const benchCamera = new THREE.PerspectiveCamera();
    benchCamera.position
      .copy(target)
      .add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(looks.distance));
    benchCamera.lookAt(target);
    // Fit the frame's width: the vertical field that shows it across this aspect.
    const halfWidth = looks.frameWidth / 2;
    const benchFov = (2 * Math.atan(halfWidth / aspect / looks.distance)) / DEG;
    const along = BENCH.jig.along.clone().normalize();
    const nock = BENCH.jig.nock;
    const focus = nock.clone().addScaledVector(along, 0.06);
    const jigCamera = new THREE.PerspectiveCamera();
    // Straight behind the back end and a little up, looking down the shaft: the marks go round
    // like a clock's hands, and the top is twelve o'clock.
    const back = along
      .clone()
      .negate()
      .add(new THREE.Vector3(0, 0.3, 0))
      .normalize();
    jigCamera.position.copy(focus).addScaledVector(back, looks.closeDistance);
    jigCamera.lookAt(focus);
    // About 15 cm across, whatever the aspect.
    const jigFov = Math.min(
      (2 * Math.atan(0.075 / Math.max(aspect, 0.4) / looks.closeDistance)) / DEG,
      70,
    );
    return {
      bench: { position: benchCamera.position.clone(), quaternion: benchCamera.quaternion.clone() },
      jig: { position: jigCamera.position.clone(), quaternion: jigCamera.quaternion.clone() },
      benchFov,
      jigFov,
    };
  }

  // Input

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      const round = this.#round;
      const arrow = round?.arrow;
      if (!round || round.phase !== 'make' || !arrow || this.#pointer) return;
      if (arrow.step === 'feathers') {
        if (!round.tap()) this.#flash(`Needs ${String(this.#rules.feathers.careful)} 🪶`, 'bad');
        return;
      }
      if (arrow.step !== 'shaft') return;
      if (!capturePointer(canvas, event.pointerId)) return;
      this.#pointer = { id: event.pointerId, startY: event.clientY, pull: 0 };
    });
    canvas.addEventListener('pointermove', (event) => {
      const pointer = this.#pointer;
      const round = this.#round;
      if (!pointer || event.pointerId !== pointer.id || !round) return;
      const feel = round.feel;
      pointer.pull = Math.max(event.clientY - pointer.startY, 0) / feel.dipPx;
      if (pointer.pull >= 1 && round.arrow?.step === 'shaft') {
        round.dip();
        this.#ui.hint.hidden = true;
        if (!this.#deps.game.hasDone('tutorial.fletching')) {
          this.#deps.game.markDone('tutorial.fletching');
        }
      }
    });
    const release = (event: PointerEvent) => {
      const pointer = this.#pointer;
      if (!pointer || event.pointerId !== pointer.id) return;
      this.#pointer = undefined;
      const round = this.#round;
      if (round?.arrow?.step === 'dip') round.lift();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  // Layout

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#views = this.#cameraViews();
    this.#drawCamera(1);
    this.#measureTextures();
  }

  /** Where the shaft's feathers are on the screen, in CSS pixels. */
  #shaftOnScreen(): ScreenPoint {
    const middle = new THREE.Vector3(0, this.#shaft.fletchingMiddle, 0);
    const projected = this.#shaft.group.localToWorld(middle).project(this.#camera);
    const { clientWidth: width, clientHeight: height } = this.#element;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
  }

  // Graphics tiers

  /** Draws at `tier` from now on: only looks (how sharp, shadows, feathers, trees, ground). */
  #applyTier(tier: GraphicsTier, first = false): void {
    if (tier === this.#tier && !first) return;
    this.#tier = tier;
    this.#look = this.#rules.looks.tiers[tier];
    this.#element.dataset.graphics = tier;
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.#look.pixelRatio));
    this.#renderer.shadowMap.enabled = this.#look.shadows;
    this.#sun.castShadow = this.#look.shadows;
    this.#bench.heap.count = this.#look.bucketFeathers;
    this.#trees.show(this.#look.trees);
    this.#ground.material = this.#look.grass ? this.#groundLooks.high : this.#groundLooks.low;
    // Shadow maps are made when a material first compiles: compile again with or without them.
    this.#scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        for (const material of [child.material as THREE.Material | THREE.Material[]].flat()) {
          material.needsUpdate = true;
        }
      }
    });
    this.#resize();
    if (!first) this.#deps.logger.log('fletching.graphics', { tier });
  }

  /** Texture memory the scene holds (MB), for the stress-test numbers. */
  #measureTextures(): void {
    const seen = new Set<unknown>();
    const add = (texture: unknown) => {
      if (texture instanceof THREE.Texture) seen.add(texture.image);
    };
    this.#scene.traverseVisible((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const material of [child.material as THREE.Material | THREE.Material[]].flat()) {
        const maps = material as unknown as Record<string, unknown>;
        add(maps.map);
        add(maps.normalMap);
        add(maps.alphaMap);
      }
    });
    let bytes = 0;
    for (const image of seen) {
      const { width, height } = (image ?? {}) as { width?: number; height?: number };
      if (width && height) bytes += textureBytes(width, height);
    }
    this.#element.dataset.textureMb = (bytes / 1024 / 1024).toFixed(1);
  }

  #logPerf(result: FletchingResult): void {
    const perf = this.#perf;
    this.#deps.logger.log('fletching.perf', {
      tier: this.#tier,
      seconds: Math.round(result.seconds),
      fps: Math.round(perf.frames / Math.max(perf.seconds, 0.001)),
      worstMs: Math.round(perf.worst * 1000),
      drawCalls: perf.calls,
      triangles: perf.triangles,
      textureMb: Number(this.#element.dataset.textureMb ?? 0),
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
    const root = el('div', 'fl-ui');
    const status = el('div', 'fl-status');
    const supplies = el('div', 'fl-supplies');
    const flash = el('div', 'fl-flash');
    flash.hidden = true;
    const hint = el('div', 'fl-hint');
    hint.hidden = true;
    const tools = el('div', 'fl-tools');
    const bare = button('Bare', 'fl-tool fl-bare', () => {
      this.#round?.bare();
    });
    const bucket = button(
      `🪣 Bucket · ${String(this.#rules.feathers.bucket)} 🪶`,
      'fl-tool fl-bucket',
      () => {
        if (this.#round && !this.#round.bucket() && !this.#round.canBucket) {
          this.#flash(`The bucket takes ${String(this.#rules.feathers.bucket)} 🪶`, 'bad');
        }
      },
    );
    tools.append(bare, bucket);
    const card = el('div', 'fm-card fl-card');
    const cardStars = el('div', 'w3d-stars fm-card-stars');
    const cardTitle = el('div', 'fm-card-title');
    const cardText = el('div', 'fm-card-text');
    const cardButtons = el('div', 'fm-card-buttons');
    const leave = button('Back to camp', 'fm-button fm-secondary', () => {
      this.#deps.onLeave();
    });
    const next = button('Fletch again', 'fm-button', () => {
      this.#hud.settle();
      this.#skillBar.settle();
      this.#startRound();
    });
    cardButtons.append(leave, next);
    card.append(cardStars, cardTitle, cardText, cardButtons);
    card.hidden = true;
    root.append(status, supplies, flash, hint, tools, card);
    this.#element.append(root);
    return {
      root,
      status,
      supplies,
      flash,
      hint,
      tools,
      bare,
      bucket,
      card,
      cardStars,
      cardTitle,
      cardText,
      next,
    };
  }

  #flashTimer: number | undefined;

  #flash(text: string, tone: 'good' | 'bad' | 'meh'): void {
    const flash = this.#ui.flash;
    flash.textContent = text;
    flash.dataset.tone = tone;
    flash.hidden = false;
    flash.classList.remove('fl-flash-show');
    flash.getBoundingClientRect();
    flash.classList.add('fl-flash-show');
    window.clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => {
      flash.hidden = true;
    }, 1100);
  }

  #shown = '';

  #updateUi(): void {
    const ui = this.#ui;
    const round = this.#round;
    const phase = round ? round.phase : 'empty';
    if (document.body.dataset.fletching !== phase) document.body.dataset.fletching = phase;
    const arrow = round?.arrow;
    const step = round?.phase === 'make' ? (arrow?.step ?? 'none') : 'none';
    const made = round?.made ?? { fletched: 0, duster: 0, bare: 0 };
    const status = round
      ? `⏱ ${String(Math.ceil(round.left))} s · 🏹 ${String(made.fletched)} fletched`
      : '';
    const supplies = round
      ? `Shafts ${String(round.shaftsLeft + (arrow && arrow.step !== 'made' ? 1 : 0))} · 🪶 ${String(round.feathersLeft)}`
      : '';
    const hint =
      step === 'shaft'
        ? 'Drag the shaft down into the tar · hold'
        : step === 'dip'
          ? 'Let go in the green band'
          : step === 'feathers'
            ? round?.canFletch
              ? 'Tap as each yellow mark comes to the top'
              : 'Not enough feathers: the bucket, or bare'
            : '';
    const key = [status, supplies, hint, step, made.fletched, made.duster, made.bare].join('|');
    if (key !== this.#shown) {
      this.#shown = key;
      ui.status.textContent = status;
      ui.status.hidden = !round;
      ui.supplies.textContent = supplies;
      ui.supplies.hidden = !round;
      ui.hint.textContent = hint;
      // The hint stays for the first dip, and always when it's out of feathers.
      ui.hint.hidden =
        hint === '' ||
        (this.#deps.game.hasDone('tutorial.fletching') &&
          !(step === 'feathers' && !round?.canFletch));
      ui.tools.hidden = step !== 'shaft' && step !== 'feathers';
      ui.bucket.hidden = step !== 'feathers';
      ui.bucket.disabled = !round?.canBucket;
      this.#element.dataset.step = step;
      this.#element.dataset.fletched = String(made.fletched);
      this.#element.dataset.dusters = String(made.duster);
      this.#element.dataset.bares = String(made.bare);
    }
  }

  /** The end card: stars, what was made, and what a star more would take. */
  #showCard(result: FletchingResult): void {
    this.#cardShown = true;
    const ui = this.#ui;
    const rules = this.#rules;
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
    const plural = (count: number, word: string) =>
      `${String(count)} ${word}${count === 1 ? '' : 's'}`;
    const lines: string[] = [];
    const { made } = result;
    lines.push(
      `🏹 ${String(made.fletched)} fletched · 🪶 ${plural(made.duster, 'duster')} · ${String(made.bare)} bare`,
    );
    const thresholds = [rules.stars.one, rules.stars.two, rules.stars.three];
    const need = thresholds[result.stars];
    if (need !== undefined) {
      lines.push(
        `${plural(need - made.fletched, 'fletched arrow')} more for ${'★'.repeat(result.stars + 1)}`,
      );
    }
    if (result.bonus > 0)
      lines.push(`${'★'.repeat(result.stars)} bonus +${plural(result.bonus, 'fletched arrow')}`);
    if (result.feathers > 0) {
      lines.push(
        `${plural(result.feathers, 'feather')} used${result.lost > 0 ? `, ${String(result.lost)} slid off` : ''}`,
      );
    }
    if (result.bucket > 0) lines.push(`${plural(result.bucket, 'trip')} to the bucket`);
    const left = this.#round?.shaftsLeft ?? 0;
    if (left === 0) lines.push('Out of shafts: split more staves at the Workbench');
    ui.cardTitle.textContent = plural(result.arrows, 'arrow');
    ui.cardText.textContent = lines.join('\n');
    ui.next.hidden = left === 0;
    ui.card.hidden = false;
    // The bonus arrows pour in from the card.
    const bonus = this.#bonus;
    this.#bonus = undefined;
    if (bonus) {
      const box = ui.card.getBoundingClientRect();
      const root = this.#element.getBoundingClientRect();
      bonus.deposit.pour([{ x: box.left - root.left + box.width / 2, y: box.top - root.top + 40 }]);
    }
  }

  #showEmpty(): void {
    const ui = this.#ui;
    ui.cardStars.replaceChildren();
    ui.cardTitle.textContent = 'No shafts';
    ui.cardText.textContent =
      'Arrows are made from staves (a stave is two shafts). Split some logs at the Workbench.';
    ui.next.hidden = true;
    ui.card.hidden = false;
    this.#cardShown = true;
  }
}
