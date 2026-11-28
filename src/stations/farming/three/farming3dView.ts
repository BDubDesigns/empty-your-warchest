import * as THREE from 'three';
import { gpuOf } from '../../../app/deviceHints';
import { groundMesh } from '../../../app/ground';
import type { Haptics } from '../../../app/haptics';
import { itemText } from '../../../app/itemText';
import { loadModel } from '../../../app/models';
import { capturePointer } from '../../../app/pointer';
import type { ScreenView } from '../../../app/screen';
import { Sfx, type SoundLoop } from '../../../app/sfx';
import { SkillBar } from '../../../app/skillBar';
import { releaseContext, restoreContext } from '../../../app/trouble';
import { WarchestHud, type ScreenPoint } from '../../../app/warchestHud';
import { textureBytes } from '../../../bench/logic/stats';
import {
  cropById,
  cropsOpen,
  farmStation,
  growth,
  isRipe,
  ripeAt,
  stageOf,
  type Clock,
  type EventLogger,
  type Game,
  type GraphicsSettings,
  type GraphicsTier,
  type Harvest,
  type LiveTuning,
  type Planting,
  type WorkClock,
} from '../../../core';
import type { Crop, Farming, FarmingFeel } from '../../../data';
import { TreeLine } from '../../archery/three/scenery';
import { plotLayout, plotsCrossed, type PlotSpot } from '../logic/layout';
import {
  canCapacity,
  soilState,
  WateringRound,
  type WateringEvent,
  type WateringResult,
} from '../logic/watering';
import { WateringCan } from './can';
import { COLORS, Field, type PlotLook } from './field';
import './farming.css';

export interface Farming3DDeps {
  game: Game;
  logger: EventLogger;
  /** The time now, and the workers' clock: crops grow on its minutes, live. */
  clock: Clock;
  work: WorkClock;
  feel: LiveTuning<FarmingFeel>;
  /** The graphics tier: how sharp, shadows, furrows, trees and drops. Calm frames feed it. */
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
  plant: 'audio/splitting/press-click.mp3',
  pour: 'audio/firemaking/steam-2.mp3',
  band: 'audio/woodcutting/chop-perfect.mp3',
  mud: 'audio/woodcutting/land-2.mp3',
  harvest: 'audio/warchest/log-in-1.mp3',
  star: 'audio/woodcutting/star.mp3',
};
/** Each crop's mark on its seed button and plot tags. */
const ICONS: Record<string, string> = { woad: '🌿', sunflower: '🌻' };
/** The can's rose is this high over the soil while watering (m). */
const CAN_HEIGHT = 0.75;
/** A plant's pop as it goes in or comes out lasts this long (seconds). */
const POP_SECONDS = 0.3;
/** The card waits this long after the watering ends, so the last pour is seen to land. */
const CARD_DELAY = 0.5;

type Mode = 'farm' | 'water' | 'card';

/**
 * The farm in 3D: raised beds of tilled soil seen from above. Pick a seed and drag across empty
 * plots to plant it; swipe across ripe ones to harvest them into the chest. Once a planting,
 * water it: the mini game, a soil gauge over each plot with its crop's band, the can following
 * the finger and pouring while it's held down. Crops grow on the workers' clock (playing, and
 * away up to the cap), shown live. The rules (core/farm.ts, WateringRound) decide everything;
 * this draws them and feeds them the player's moves.
 */
export class Farming3DView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #deps: Farming3DDeps;
  readonly #rules: Farming;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  readonly #timer = new THREE.Timer();
  readonly #sfx = new Sfx();
  readonly #pourSound: SoundLoop;
  readonly #hud: WarchestHud;
  readonly #skillBar: SkillBar;
  readonly #skill: string;
  readonly #ui: ReturnType<Farming3DView['buildUi']>;
  #field: Field;
  #fence: THREE.Group;
  readonly #can: WateringCan;
  readonly #sun: THREE.DirectionalLight;
  readonly #ground: THREE.Mesh;
  readonly #groundLooks: { high: THREE.Material; low: THREE.Material };
  readonly #trees: TreeLine;
  /** The open plots' spots: the field is built for them (again, when more open). */
  #spots: PlotSpot[];
  readonly #raycaster = new THREE.Raycaster();
  #tier: GraphicsTier;
  #look: Farming['looks']['tiers']['high'];
  #mode: Mode = 'farm';
  /** The seed picked to plant. */
  #crop: string | undefined;
  #round: WateringRound | undefined;
  /** The finger: where it was on the field (for swipes), and where on the screen. */
  #pointer:
    | {
        id: number;
        last: THREE.Vector3 | undefined;
        x: number;
        y: number;
        /** What this swipe does, set by the first plot it reaches: one job a gesture. */
        job: 'harvest' | 'plant' | undefined;
      }
    | undefined;
  /** Where the can's stream lands, on the field, and whether it's over the field at all. */
  #aim: THREE.Vector3 | undefined;
  /** When each plot last had something go in or come out (a little pop), by plot. */
  readonly #pops = new Map<number, { at: number; crop: Crop | undefined; growth: number }>();
  #clock = 0;
  #shake = 0;
  #endedAt: number | undefined;
  #statsAt = 0;
  #ripeAt = 0;
  #perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };

  private constructor(
    element: HTMLElement,
    deps: Farming3DDeps,
    hud: WarchestHud,
    trees: THREE.Object3D[],
  ) {
    this.#element = element;
    this.#deps = deps;
    this.#hud = hud;
    this.#rules = deps.game.data.farming;
    this.#skill = farmStation(deps.game.data).skill;
    this.#skillBar = new SkillBar(element, { game: deps.game, skill: this.#skill });
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    deps.graphics.noteGpu(gpuOf(this.#renderer.getContext()).gpu);
    this.#tier = deps.graphics.tier;
    this.#look = this.#rules.looks.tiers[this.#tier];
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.#look.pixelRatio));
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'fa-canvas';
    element.dataset.graphics = this.#tier;
    element.append(this.#renderer.domElement);
    this.#ui = this.buildUi();
    this.#sfx.load(SOUNDS);
    this.#pourSound = this.#sfx.loop('pour');

    const looks = this.#rules.looks;
    this.#scene.background = new THREE.Color(COLORS.sky);
    this.#scene.fog = new THREE.Fog(
      COLORS.sky,
      looks.treeDistance.min,
      looks.treeDistance.max * 1.6,
    );
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.5));
    this.#sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.#sun.position.set(-4, 9, 5);
    this.#sun.shadow.mapSize.set(1024, 1024);
    const shadow = this.#sun.shadow.camera;
    shadow.left = shadow.bottom = -7;
    shadow.right = shadow.top = 7;
    shadow.near = 1;
    shadow.far = 30;
    this.#scene.add(this.#sun);

    // The ground: grass round the beds (plain on the low tier, its texture is a big one).
    this.#ground = groundMesh('meadowGrass', 50, 50);
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
    this.#scene.add(this.#trees.group);
    const built = this.#build(deps.game.plots);
    this.#spots = built.spots;
    this.#field = built.field;
    this.#fence = built.fence;
    this.#can = new WateringCan(Math.max(high.drops, low.drops));
    this.#can.group.visible = false;
    this.#scene.add(this.#can.group, this.#can.drops);

    this.#applyTier(this.#tier, true);
    deps.graphics.onTier(({ tier }) => {
      this.#applyTier(tier);
    });
    this.#listen();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  /** The field and its fence for `count` open plots (replacing any there were). */
  #build(count: number): { spots: PlotSpot[]; field: Field; fence: THREE.Group } {
    const looks = this.#rules.looks;
    const layout = plotLayout(looks, count);
    for (const old of [this.#field as Field | undefined, this.#fence as THREE.Group | undefined]) {
      const group = old instanceof Field ? old.group : old;
      if (!group) continue;
      this.#scene.remove(group);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
      });
    }
    const field = new Field(looks, layout.spots, this.#rules.crops);
    const around = fence(layout, looks.margin * 0.7);
    this.#scene.add(field.group, around);
    return { spots: layout.spots, field, fence: around };
  }

  /** More plots opened (a level up): the field grows to show them. */
  #fitField(): void {
    const count = this.#deps.game.plots;
    if (count === this.#spots.length) return;
    const built = this.#build(count);
    this.#spots = built.spots;
    this.#field = built.field;
    this.#fence = built.fence;
    this.#applyTier(this.#tier, true);
  }

  static async create(element: HTMLElement, deps: Farming3DDeps): Promise<Farming3DView> {
    const [hud, trees] = await Promise.all([
      WarchestHud.create(element, {
        game: deps.game,
        item: deps.game.data.farming.crops[0]?.item ?? 'woad',
        haptics: deps.haptics,
        logger: deps.logger,
      }),
      Promise.all(TREES.map((url) => loadModel(url))),
    ]);
    return new Farming3DView(element, deps, hud, trees);
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
    this.#mode = 'farm';
    this.#ui.card.hidden = true;
    this.#perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };
    const { game, logger } = this.#deps;
    this.#fitField();
    // A crop's starter pack, the first time it's open here.
    const given = game.starterSeeds();
    if (given.length > 0) {
      const list = given.map((stack) => itemText(game.data, stack.item, stack.count)).join(', ');
      this.#flash(`Starter seeds: ${list}`, 'good');
    }
    const now = this.#now();
    game.noteRipe(now);
    logger.log('farming.visit', {
      level: game.level(this.#skill),
      plots: game.plots,
      at: round2(now),
      seeds: Object.fromEntries(
        this.#rules.crops.map((crop) => [crop.seed, game.inventory.count(crop.seed)]),
      ),
      planted: game.farm.plots.flatMap((plot, index) =>
        plot.planting
          ? [
              {
                plot: index,
                crop: plot.planting.crop,
                grown: round2(growth(this.#rules, plot.planting, now)),
                watered: plot.planting.water?.by ?? null,
              },
            ]
          : [],
      ),
      feel: this.#deps.feel.values,
    });
    this.#pickCrop();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
    if (this.#round?.phase === 'water') this.#round.exit();
    this.#round = undefined;
    this.#pointer = undefined;
    this.#pourSound.setVolume(0);
    this.#can.stopStream();
    this.#hud.sleep();
    this.#hud.settle();
    this.#skillBar.settle();
    if (this.#perf.frames > 0) this.#logPerf('leave');
    delete document.body.dataset.farming;
    releaseContext(this.#renderer, this.#deps.logger, 'farming3d');
  }

  /** The farm's clock now (minutes): what's banked, plus what the work clock owes, live. */
  #now(): number {
    const { game, work, clock } = this.#deps;
    return game.farm.minutes + work.owedAt(clock.now());
  }

  // Planting and harvesting

  /** Keeps the picked seed one there is, else the first open crop with seeds. */
  #pickCrop(): void {
    const { game } = this.#deps;
    const open = cropsOpen(this.#rules, game.level(this.#skill));
    const has = (crop: Crop) => game.inventory.count(crop.seed) > 0;
    const picked = open.find((crop) => crop.id === this.#crop);
    if (picked && has(picked)) return;
    this.#crop = open.find(has)?.id ?? picked?.id;
  }

  /**
   * A swipe reached a plot: harvest it if it's ripe, else plant the picked seed if it's empty. A
   * swipe does one or the other, whichever its first plot was: harvesting a row never replants it.
   */
  #touchPlot(plot: number): void {
    const { game, haptics } = this.#deps;
    const feel = this.#deps.feel.values;
    const pointer = this.#pointer;
    if (plot >= game.plots) return;
    const now = this.#now();
    const planting = game.farm.plots[plot]?.planting;
    if (planting) {
      if (!isRipe(this.#rules, planting, now) || pointer?.job === 'plant') return;
      if (pointer) pointer.job = 'harvest';
      const crop = cropById(this.#rules, planting.crop);
      const harvest = game.harvest(plot, now);
      if (!harvest) return;
      this.#pops.set(plot, { at: this.#clock, crop, growth: 1 });
      haptics.pulse(feel.buzzHarvestMs);
      this.#pourHarvest(harvest);
      return;
    }
    if (pointer?.job === 'harvest') return;
    if (pointer) pointer.job = 'plant';
    const crop = this.#crop;
    if (!crop) {
      this.#flash('No seeds: hunt birds at the Hunting stand', 'bad');
      return;
    }
    if (!game.plant(plot, crop, now)) {
      const entry = cropById(this.#rules, crop);
      if (game.inventory.count(entry.seed) === 0) {
        this.#flash(`Out of ${itemText(game.data, entry.seed, 2).replace(/^2 /, '')}`, 'bad');
        this.#pickCrop();
      }
      return;
    }
    this.#pops.set(plot, { at: this.#clock, crop: undefined, growth: 0 });
    haptics.pulse(feel.buzzPlantMs);
    this.#sfx.play('plant', 0.4, 300 + plot * 60);
    if (!game.hasDone('tutorial.farming')) game.markDone('tutorial.farming');
    this.#pickCrop();
  }

  /** Pours a harvest into the chest from its plot, its XP ticking in as the pieces land. */
  #pourHarvest(harvest: Harvest): void {
    const deposit = harvest.xp > 0 ? this.#skillBar.hold(harvest.xp) : undefined;
    const held = this.#hud.hold(
      harvest.count,
      deposit
        ? (share: number) => {
            deposit.arrive(share);
          }
        : undefined,
      harvest.item,
    );
    const at = this.#plotOnScreen(harvest.plot);
    held.pour(
      Array.from({ length: Math.min(harvest.count, 4) }, (_, index) => ({
        x: at.x + (index - 1.5) * 12,
        y: at.y - index * 4,
      })),
    );
    this.#sfx.play('harvest', 0.5, harvest.plot * 80);
  }

  // Watering

  /** Plots planted, not yet watered and still growing: what a watering waters. */
  #thirsty(): { plot: number; crop: string }[] {
    const { game } = this.#deps;
    const now = this.#now();
    return game.farm.plots.flatMap((entry, plot) => {
      const planting = entry.planting;
      if (!planting || planting.water || plot >= game.plots) return [];
      return isRipe(this.#rules, planting, now) ? [] : [{ plot, crop: planting.crop }];
    });
  }

  #startWatering(): void {
    const { game, logger } = this.#deps;
    const plots = this.#thirsty();
    if (plots.length === 0) return;
    // Seeded by the plantings, so the same plots start as dry on a replay.
    const seed = plots
      .map(({ plot }) => `${String(plot)}@${String(game.farm.plots[plot]?.planting?.plantedAt)}`)
      .join(',');
    this.#round = new WateringRound(
      this.#rules,
      this.#deps.feel.values,
      plots,
      canCapacity(this.#rules, game.plots),
      `water:${seed}`,
      {
        logger,
        level: game.level(this.#skill),
        record: (plot, water) => {
          game.water(plot, water);
        },
        bank: (seeds) => {
          for (const stack of seeds) game.addItems(stack.item, stack.count);
        },
        onEvent: (event) => {
          this.#onWater(event);
        },
      },
    );
    this.#mode = 'water';
    this.#endedAt = undefined;
    this.#perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };
    this.#can.group.visible = true;
    this.#aim = undefined;
  }

  #onWater(event: WateringEvent): void {
    const feel = this.#deps.feel.values;
    const { haptics } = this.#deps;
    if (event.type === 'band') {
      haptics.pulse(feel.buzzBandMs);
      this.#sfx.play('band', 0.35, 400);
      return;
    }
    if (event.type === 'mud') {
      haptics.pulse(feel.buzzMudMs);
      this.#sfx.play('mud', 0.6, -300);
      this.#shake = Math.max(this.#shake, 0.05 * feel.shakeStrength);
      this.#flash('Too much: mud!', 'bad');
      return;
    }
    if (event.type === 'stop') {
      const { gauge } = event;
      if (gauge.state === 'good') this.#flash(`✓ ${gauge.crop.name}: just right`, 'good');
      return;
    }
    if (event.type === 'empty') {
      this.#flash('The can is empty', 'meh');
      return;
    }
    if (event.type === 'end') {
      this.#endedAt = this.#clock;
      this.#pourSound.setVolume(0);
      if (event.bonus.length > 0) {
        for (const stack of event.bonus) {
          this.#hud.hold(stack.count, undefined, stack.item).pour([this.#cardPoint()]);
        }
      }
      this.#logPerf('water');
    }
  }

  // The loop

  #loop(time: number): void {
    this.#timer.update(time);
    const dt = Math.min(this.#timer.getDelta(), 0.1);
    this.#clock += dt;
    const round = this.#round;
    const feel = this.#deps.feel.values;
    if (round && this.#mode === 'water') {
      const plot = this.#aim ? this.#plotAtPoint(this.#aim) : undefined;
      round.aim(plot, Boolean(this.#pointer));
      round.tick(dt);
      const pouring = round.pouringOn !== undefined;
      this.#pourSound.setVolume(pouring ? 0.25 : 0);
      if (this.#aim) {
        this.#can.place(this.#aim, CAN_HEIGHT, pouring, this.#look.drops, dt, this.#clock);
      } else {
        this.#restCan(dt);
      }
      if (round.phase === 'done' && this.#endedAt !== undefined) {
        if (this.#clock - this.#endedAt >= CARD_DELAY && round.result) this.#showCard(round.result);
      }
      this.#deps.graphics.sample(dt * 1000);
    } else {
      this.#can.group.visible = false;
      this.#can.stopStream();
    }
    // Growth end is logged as it's seen (once a second is plenty).
    if (this.#clock - this.#ripeAt > 1) {
      this.#ripeAt = this.#clock;
      this.#deps.game.noteRipe(this.#now());
      if (this.#mode === 'farm') this.#fitField();
    }
    this.#field.update(this.#plotLooks(), this.#clock);
    this.#drawCamera(dt, feel);
    this.#updateUi();
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

  /** The can waits at the near right corner of the field until the finger picks it up. */
  #restCan(dt: number): void {
    const spots = this.#openSpots();
    const last = spots[spots.length - 1];
    const size = this.#rules.looks.plotSize;
    const at = new THREE.Vector3(
      (last?.x ?? 0) + size * 0.7,
      this.#field.top,
      (last?.z ?? 0) + size * 0.75,
    );
    this.#can.place(at, 0.45, false, 0, dt, this.#clock);
  }

  /** What each plot shows: its soil (the round's gauge while watering) and its crop's growth. */
  #plotLooks(): (PlotLook | undefined)[] {
    const { game } = this.#deps;
    const now = this.#now();
    const round = this.#mode === 'water' || this.#mode === 'card' ? this.#round : undefined;
    return this.#spots.map((spot) => {
      if (spot.plot >= game.plots) return undefined;
      const planting = game.farm.plots[spot.plot]?.planting;
      const pop = this.#pops.get(spot.plot);
      const popping = pop && this.#clock - pop.at < POP_SECONDS;
      const share = popping ? (this.#clock - pop.at) / POP_SECONDS : 1;
      const gauge = round?.gauge(spot.plot);
      const crop = planting ? cropById(this.#rules, planting.crop) : undefined;
      if (gauge) {
        return this.#lookFor(
          crop,
          planting,
          now,
          gauge.moisture,
          gauge.band.high,
          gauge.state,
          share,
        );
      }
      if (!planting) {
        // Just harvested: the crop shrinks away as it comes out.
        if (popping && pop.crop) {
          return {
            moisture: 0.1,
            soil: 'none',
            wetAt: 1,
            crop: pop.crop,
            growth: 1,
            stage: 'ripe',
            pop: 1 - share,
          };
        }
        return {
          moisture: 0.1,
          soil: 'none',
          wetAt: 1,
          crop: undefined,
          growth: 0,
          stage: 'seed',
          pop: 1,
        };
      }
      const water = planting.water;
      const band = crop?.band ?? { low: 0.5, high: 0.7 };
      const moisture = water?.moisture ?? 0.12;
      return this.#lookFor(
        crop,
        planting,
        now,
        moisture,
        band.high,
        soilState(moisture, band),
        share,
      );
    });
  }

  #lookFor(
    crop: Crop | undefined,
    planting: Planting | undefined,
    now: number,
    moisture: number,
    wetAt: number,
    soil: PlotLook['soil'],
    pop: number,
  ): PlotLook {
    const grown = planting ? growth(this.#rules, planting, now) : 0;
    return {
      moisture,
      soil,
      wetAt,
      crop,
      growth: grown,
      stage: stageOf(this.#rules.looks.stages, grown),
      pop,
    };
  }

  // Camera

  /**
   * Looks down `pitch` degrees at the open plots, from far enough back that the field and a
   * margin round it fit the screen's width, and its depth fits between the HUD and the buttons.
   */
  #drawCamera(dt: number, feel: FarmingFeel): void {
    const looks = this.#rules.looks;
    const layout = plotLayout(looks, Math.max(this.#deps.game.plots, 1));
    const aspect = Math.max(this.#camera.aspect, 0.1);
    const pitch = looks.pitch * DEG;
    const half = Math.tan((looks.fov * DEG) / 2);
    const across = (layout.width / 2 + looks.margin) / (half * aspect);
    // The middle 60% of the screen's height is for the field (the HUD above, buttons below).
    const deep = ((layout.depth / 2 + looks.margin) * Math.sin(pitch)) / (half * 0.6);
    const distance = Math.max(across, deep);
    // The field's middle row of the open plots, a touch above the screen's middle.
    const middle = (layout.spots[0]?.z ?? 0) + (layout.depth - looks.plotSize) / 2;
    const target = new THREE.Vector3(0, 0, middle + distance * 0.02);
    this.#camera.fov = looks.fov;
    this.#camera.position
      .copy(target)
      .add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance));
    this.#camera.lookAt(target);
    this.#shake = Math.max(this.#shake - dt * 0.2, 0);
    if (this.#shake > 0) {
      this.#camera.position.x += (Math.random() - 0.5) * this.#shake * feel.shakeStrength;
      this.#camera.position.y += (Math.random() - 0.5) * this.#shake * feel.shakeStrength;
    }
    this.#camera.updateProjectionMatrix();
    this.#camera.updateMatrixWorld();
  }

  // Input

  #listen(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.#sfx.unlock();
      if (this.#pointer || this.#mode === 'card') return;
      if (!capturePointer(canvas, event.pointerId)) return;
      this.#pointer = {
        id: event.pointerId,
        last: undefined,
        x: event.clientX,
        y: event.clientY,
        job: undefined,
      };
      this.#moved(event);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.#pointer?.id !== event.pointerId) return;
      this.#moved(event);
    });
    const release = (event: PointerEvent) => {
      if (this.#pointer?.id !== event.pointerId) return;
      this.#pointer = undefined;
      this.#round?.aim(this.#aim ? this.#plotAtPoint(this.#aim) : undefined, false);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  #moved(event: PointerEvent): void {
    const pointer = this.#pointer;
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const box = this.#renderer.domElement.getBoundingClientRect();
    if (this.#mode === 'water') {
      // The stream lands a little above the finger, so it can be seen.
      const lift = this.#deps.feel.values.liftPx;
      this.#aim = this.#fieldPoint(event.clientX - box.left, event.clientY - box.top - lift);
      return;
    }
    const point = this.#fieldPoint(event.clientX - box.left, event.clientY - box.top);
    if (!point) return;
    const from = pointer.last ?? point;
    pointer.last = point;
    const size = this.#rules.looks.plotSize;
    for (const plot of plotsCrossed(this.#openSpots(), size, from, point)) this.#touchPlot(plot);
  }

  /** Where a screen point (CSS px in the canvas) lands on the soil's top. */
  #fieldPoint(x: number, y: number): THREE.Vector3 | undefined {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return undefined;
    const ndc = new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.#field.top);
    const hit = new THREE.Vector3();
    return this.#raycaster.ray.intersectPlane(plane, hit) ? hit : undefined;
  }

  #plotAtPoint(point: THREE.Vector3): number | undefined {
    const size = this.#rules.looks.plotSize;
    const crossed = plotsCrossed(this.#openSpots(), size, point, point);
    return crossed[0];
  }

  #openSpots(): PlotSpot[] {
    return this.#spots.slice(0, this.#deps.game.plots);
  }

  // Layout

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#drawCamera(0, this.#deps.feel.values);
    this.#measureTextures();
  }

  /** Where a plot's middle is on the screen, in CSS pixels. */
  #plotOnScreen(plot: number, lift = 0): ScreenPoint {
    const spot = this.#spots[plot];
    const point = new THREE.Vector3(spot?.x ?? 0, this.#field.top + lift, spot?.z ?? 0);
    return this.#project(point);
  }

  #project(point: THREE.Vector3): ScreenPoint {
    const projected = point.clone().project(this.#camera);
    const { clientWidth: width, clientHeight: height } = this.#element;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
  }

  #cardPoint(): ScreenPoint {
    const box = this.#ui.card.getBoundingClientRect();
    const root = this.#element.getBoundingClientRect();
    if (box.width === 0) return { x: root.width / 2, y: root.height / 2 };
    return { x: box.left - root.left + box.width / 2, y: box.top - root.top + 40 };
  }

  // Graphics tiers

  /** Draws at `tier` from now on: only looks (how sharp, shadows, furrows, trees, drops, ground). */
  #applyTier(tier: GraphicsTier, first = false): void {
    if (tier === this.#tier && !first) return;
    this.#tier = tier;
    this.#look = this.#rules.looks.tiers[tier];
    this.#element.dataset.graphics = tier;
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.#look.pixelRatio));
    this.#renderer.shadowMap.enabled = this.#look.shadows;
    this.#sun.castShadow = this.#look.shadows;
    this.#field.setFurrows(this.#look.furrows);
    this.#field.setSoilMap(this.#look.furrows);
    this.#fence.traverse((child) => {
      child.castShadow = this.#look.shadows;
    });
    this.#field.setShadows(this.#look.shadows);
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
    if (!first) this.#deps.logger.log('farming.graphics', { tier });
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

  #logPerf(when: 'water' | 'leave'): void {
    const perf = this.#perf;
    this.#deps.logger.log('farming.perf', {
      when,
      tier: this.#tier,
      seconds: Math.round(perf.seconds),
      fps: Math.round(perf.frames / Math.max(perf.seconds, 0.001)),
      worstMs: Math.round(perf.worst * 1000),
      drawCalls: perf.calls,
      triangles: perf.triangles,
      textureMb: Number(this.#element.dataset.textureMb ?? 0),
    });
    this.#perf = { frames: 0, seconds: 0, worst: 0, calls: 0, triangles: 0 };
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
    const root = el('div', 'fa-ui');
    const status = el('div', 'fa-status');
    const can = el('div', 'fa-can');
    const canFill = el('div', 'fa-can-fill');
    can.append(canFill);
    const flash = el('div', 'fa-flash');
    flash.hidden = true;
    const tags = el('div', 'fa-tags');
    const hint = el('div', 'fa-hint');
    const tools = el('div', 'fa-tools');
    const seeds = el('div', 'fa-seeds');
    const seedButtons = this.#rules.crops.map((crop) => {
      const seed = button('', 'fa-seed', () => {
        this.#crop = crop.id;
        this.#shown = '';
      });
      seed.dataset.crop = crop.id;
      seeds.append(seed);
      return { crop, button: seed };
    });
    const water = button('', 'fa-tool fa-water', () => {
      this.#startWatering();
    });
    const done = button('Done', 'fa-tool fa-done', () => {
      this.#round?.finish();
    });
    tools.append(water, done);
    const card = el('div', 'fm-card fa-card');
    const cardStars = el('div', 'w3d-stars fm-card-stars');
    const cardTitle = el('div', 'fm-card-title');
    const cardText = el('div', 'fm-card-text');
    const cardButtons = el('div', 'fm-card-buttons');
    const leave = button('Back to camp', 'fm-button fm-secondary', () => {
      this.#deps.onLeave();
    });
    const back = button('Back to the farm', 'fm-button', () => {
      this.#hud.settle();
      this.#skillBar.settle();
      this.#ui.card.hidden = true;
      this.#round = undefined;
      this.#mode = 'farm';
    });
    cardButtons.append(leave, back);
    card.append(cardStars, cardTitle, cardText, cardButtons);
    card.hidden = true;
    root.append(status, can, flash, tags, hint, tools, seeds, card);
    this.#element.append(root);
    return {
      root,
      status,
      can,
      canFill,
      flash,
      tags,
      tagFor: new Map<
        number,
        { tag: HTMLElement; gauge: HTMLElement; fill: HTMLElement; band: HTMLElement }
      >(),
      hint,
      tools,
      water,
      done,
      seeds,
      seedButtons,
      card,
      cardStars,
      cardTitle,
      cardText,
    };
  }

  #flashTimer: number | undefined;

  #flash(text: string, tone: 'good' | 'bad' | 'meh'): void {
    const flash = this.#ui.flash;
    flash.textContent = text;
    flash.dataset.tone = tone;
    flash.hidden = false;
    flash.classList.remove('fa-flash-show');
    flash.getBoundingClientRect();
    flash.classList.add('fa-flash-show');
    window.clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => {
      flash.hidden = true;
    }, 1400);
  }

  #shown = '';

  #updateUi(): void {
    const ui = this.#ui;
    const { game } = this.#deps;
    const mode = this.#mode;
    if (document.body.dataset.farming !== mode) document.body.dataset.farming = mode;
    this.#element.dataset.mode = mode;
    this.#updateTags();
    const round = this.#round;
    const thirsty = mode === 'farm' ? this.#thirsty().length : 0;
    const now = this.#now();
    const ripe = game.farm.plots.filter(
      (entry, plot) =>
        plot < game.plots && entry.planting && isRipe(this.#rules, entry.planting, now),
    ).length;
    const empty = Array.from({ length: game.plots }, (_, plot) => plot).filter(
      (plot) => !game.farm.plots[plot]?.planting,
    ).length;
    const open = cropsOpen(this.#rules, game.level(this.#skill));
    const seedsLeft = open.reduce((sum, crop) => sum + game.inventory.count(crop.seed), 0);
    const status =
      mode === 'water' && round
        ? `⏱ ${String(Math.ceil(round.left))} s · ${String(round.inBand)}/${String(round.gauges.length)} in their band`
        : '';
    const hint =
      mode === 'water'
        ? 'Hold over a plot to pour · stop in the green band'
        : ripe > 0
          ? 'Swipe across the ripe crops to harvest'
          : empty > 0 && seedsLeft > 0
            ? 'Pick a seed, then drag across empty plots'
            : empty > 0
              ? 'No seeds: birds drop them at the Hunting stand'
              : thirsty > 0
                ? 'Water them for a bigger harvest'
                : 'Growing…';
    const seedKey = open
      .map((crop) => `${crop.id}:${String(game.inventory.count(crop.seed))}`)
      .join(',');
    const key = [mode, status, hint, thirsty, seedKey, this.#crop, ripe].join('|');
    if (round && mode === 'water') {
      ui.canFill.style.width = `${String(Math.round((round.water / Math.max(round.capacity, 1e-6)) * 100))}%`;
      this.#element.dataset.water = round.water.toFixed(3);
    }
    if (key === this.#shown) return;
    this.#shown = key;
    ui.status.textContent = status;
    ui.status.hidden = status === '';
    ui.can.hidden = mode !== 'water';
    ui.hint.textContent = hint;
    ui.hint.hidden = mode === 'card';
    ui.water.textContent = `💧 Water ${String(thirsty)} plot${thirsty === 1 ? '' : 's'}`;
    ui.water.hidden = mode !== 'farm' || thirsty === 0;
    ui.done.hidden = mode !== 'water';
    ui.seeds.hidden = mode !== 'farm';
    for (const { crop, button } of ui.seedButtons) {
      const shown = open.includes(crop);
      button.hidden = !shown;
      const count = game.inventory.count(crop.seed);
      button.textContent = `${ICONS[crop.id] ?? '🌱'} ${crop.name} · ${String(count)}`;
      button.classList.toggle('fa-seed-on', crop.id === this.#crop);
      button.disabled = count === 0;
    }
    this.#element.dataset.ripe = String(ripe);
    this.#element.dataset.thirsty = String(thirsty);
  }

  /** Each plot's tag (what's growing, and how long it has to go) and, while watering, its gauge. */
  #updateTags(): void {
    const ui = this.#ui;
    const { game } = this.#deps;
    const now = this.#now();
    const round = this.#mode === 'water' ? this.#round : undefined;
    for (const spot of this.#spots) {
      let parts = ui.tagFor.get(spot.plot);
      const open = spot.plot < game.plots;
      if (!parts) {
        if (!open) continue;
        const tag = document.createElement('div');
        tag.className = 'fa-tag';
        tag.dataset.plot = String(spot.plot);
        const gauge = document.createElement('div');
        gauge.className = 'fa-gauge';
        gauge.dataset.plot = String(spot.plot);
        const band = document.createElement('div');
        band.className = 'fa-gauge-band';
        const fill = document.createElement('div');
        fill.className = 'fa-gauge-fill';
        gauge.append(fill, band);
        ui.tags.append(tag, gauge);
        parts = { tag, gauge, fill, band };
        ui.tagFor.set(spot.plot, parts);
      }
      const { tag, gauge, fill, band } = parts;
      tag.hidden = !open;
      if (!open) {
        gauge.hidden = true;
        continue;
      }
      const middle = this.#plotOnScreen(spot.plot);
      const front = this.#project(
        new THREE.Vector3(spot.x, this.#field.top, spot.z + this.#rules.looks.plotSize * 0.5),
      );
      const side = this.#project(
        new THREE.Vector3(spot.x + this.#rules.looks.plotSize * 0.42, this.#field.top, spot.z),
      );
      tag.style.transform = `translate(${px(front.x)}, ${px(front.y)}) translate(-50%, -60%)`;
      tag.dataset.x = String(Math.round(middle.x));
      tag.dataset.y = String(Math.round(middle.y));
      const planting = game.farm.plots[spot.plot]?.planting;
      let text = '';
      if (planting) {
        const crop = cropById(this.#rules, planting.crop);
        const icon = ICONS[crop.id] ?? '🌱';
        const ripe = isRipe(this.#rules, planting, now);
        const drop = planting.water
          ? planting.water.inBand
            ? '💧'
            : planting.water.moisture > crop.band.high
              ? '🟫'
              : ''
          : '';
        text = ripe
          ? `${icon} Ready!`
          : `${icon}${drop} ${clockText(ripeAt(this.#rules, planting) - now)}`;
        tag.dataset.crop = crop.id;
        tag.dataset.stage = stageOf(this.#rules.looks.stages, growth(this.#rules, planting, now));
        tag.dataset.ripe = String(ripe);
        tag.dataset.watered = planting.water?.by ?? '';
      } else {
        delete tag.dataset.crop;
        tag.dataset.stage = 'empty';
        tag.dataset.ripe = 'false';
        tag.dataset.watered = '';
      }
      if (tag.textContent !== text) tag.textContent = text;
      tag.classList.toggle('fa-tag-ripe', tag.dataset.ripe === 'true');
      const g = round?.gauge(spot.plot);
      gauge.hidden = !g;
      if (g) {
        gauge.style.transform = `translate(${px(side.x)}, ${px(side.y)}) translate(-50%, -100%)`;
        fill.style.height = `${(g.moisture * 100).toFixed(1)}%`;
        band.style.bottom = `${(g.band.low * 100).toFixed(1)}%`;
        band.style.height = `${((g.band.high - g.band.low) * 100).toFixed(1)}%`;
        gauge.dataset.state = g.state;
        gauge.dataset.moisture = g.moisture.toFixed(3);
        gauge.dataset.low = String(g.band.low);
        gauge.dataset.high = String(g.band.high);
        gauge.classList.toggle('fa-gauge-pouring', round?.pouringOn === spot.plot);
      }
    }
  }

  /** The watering's card: stars, how many plots made their band, and what that's worth. */
  #showCard(result: WateringResult): void {
    this.#mode = 'card';
    this.#aim = undefined;
    const ui = this.#ui;
    const rules = this.#rules;
    const { game } = this.#deps;
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
    const multiplier =
      result.stars >= 3
        ? rules.watering.multiplier.three
        : result.stars === 2
          ? rules.watering.multiplier.two
          : rules.watering.multiplier.one;
    if (result.stars > 0 && result.inBand > 0) {
      lines.push(
        `${result.inBand === result.plots ? 'They' : 'Those'} give ×${String(multiplier)} at harvest`,
      );
    } else {
      lines.push('They still give their usual harvest');
    }
    const misses: string[] = [];
    if (result.dry > 0) misses.push(`${String(result.dry)} too dry`);
    if (result.mud > 0) misses.push(`${String(result.mud)} muddy`);
    if (misses.length > 0) lines.push(misses.join(' · '));
    for (const stack of result.bonus) {
      lines.push(`★★★ bonus +${itemText(game.data, stack.item, stack.count)}`);
    }
    const thresholds = [
      rules.watering.stars.one,
      rules.watering.stars.two,
      rules.watering.stars.three,
    ];
    const need = thresholds[result.stars];
    if (need !== undefined) {
      const plots = Math.ceil(need * result.plots - 1e-9);
      lines.push(
        `${plural(Math.max(plots - result.inBand, 1), 'more plot')} in the band for ${'★'.repeat(result.stars + 1)}`,
      );
    }
    ui.cardTitle.textContent = `${String(result.inBand)} of ${plural(result.plots, 'plot')} in their band`;
    ui.cardText.textContent = lines.join('\n');
    ui.card.hidden = false;
    this.#element.dataset.stars = String(result.stars);
    this.#can.group.visible = false;
    this.#can.stopStream();
    this.#shown = '';
  }
}

/**
 * A low post-and-rail fence round the back and sides of the whole field (every plot it will
 * have), `gap` out from it; the near side stays open, toward the camera. One draw for the posts,
 * one for the rails.
 */
function fence(layout: { width: number; depth: number }, gap: number): THREE.Group {
  const left = -layout.width / 2 - gap;
  const right = layout.width / 2 + gap;
  const far = -layout.depth / 2 - gap;
  const near = layout.depth / 2 + gap;
  const sides = [
    { from: new THREE.Vector3(left, 0, far), to: new THREE.Vector3(right, 0, far) },
    { from: new THREE.Vector3(left, 0, far), to: new THREE.Vector3(left, 0, near) },
    { from: new THREE.Vector3(right, 0, far), to: new THREE.Vector3(right, 0, near) },
  ];
  const posts = sides.flatMap(({ from, to }, side) => {
    const count = Math.max(Math.round(from.distanceTo(to) / 1.4), 1);
    // The back's corner posts are the sides' first posts too.
    return Array.from({ length: count + 1 }, (_, index) => index)
      .filter((index) => side === 0 || index > 0)
      .map((index) => from.clone().lerp(to, index / count));
  });
  const material = new THREE.MeshLambertMaterial({ color: COLORS.fence });
  const matrix = new THREE.Matrix4();
  const post = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.1, 0.6, 0.1),
    material,
    posts.length,
  );
  posts.forEach((at, index) => {
    post.setMatrixAt(index, matrix.makeTranslation(at.x, 0.3, at.z));
  });
  const rail = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.06, 0.05),
    material,
    sides.length * 2,
  );
  sides.forEach(({ from, to }, index) => {
    const middle = from.clone().lerp(to, 0.5);
    const angle = Math.atan2(to.z - from.z, to.x - from.x);
    [0.25, 0.48].forEach((height, row) => {
      matrix.compose(
        new THREE.Vector3(middle.x, height, middle.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle),
        new THREE.Vector3(from.distanceTo(to), 1, 1),
      );
      rail.setMatrixAt(index * 2 + row, matrix);
    });
  });
  post.castShadow = rail.castShadow = true;
  const group = new THREE.Group();
  group.add(post, rail);
  return group;
}

/** Minutes left as "4:05" (or "0:12"). */
function clockText(minutes: number): string {
  const seconds = Math.max(Math.ceil(minutes * 60), 0);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

function px(value: number): string {
  return `${value.toFixed(1)}px`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
