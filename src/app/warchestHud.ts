import * as THREE from 'three';
import type { Game } from '../core';
import type { GameData } from '../data';
import type { Haptics } from './haptics';
import { loadModel } from './models';
import { warchestRows } from '../camp/warchestRows';
import { Sfx } from './sfx';
import { PANEL_CLOSE_MS, WarchestPanel } from './warchestPanel';
import { splitDeposit } from './warchestPour';

const MODELS = { chest: 'models/kenney/chest.glb', log: 'models/kenney/log.glb' };
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
/** Chest and flying pieces, in CSS pixels. */
const CHEST_SIZE = 46;
const PIECE_LENGTH = 30;
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
}

/** A point on the screen, in CSS pixels from the HUD's top-left corner. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Items already in the warchest that the chest holds back from its count until they fly in. */
export interface Deposit {
  /** Sends the items flying into the chest from these points (e.g. each stump on screen). */
  pour(from: ScreenPoint[]): void;
}

interface Flight {
  mesh: THREE.Object3D;
  from: THREE.Vector2;
  share: number;
  launchAt: number;
  spin: THREE.Vector3;
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
  readonly #log: THREE.Object3D;
  readonly #sfx = new Sfx();
  readonly #anchor: HTMLElement;
  readonly #count: HTMLElement;
  readonly #gain: HTMLElement;
  readonly #panel: WarchestPanel;
  readonly #unsubscribe: () => void;
  /** Items in the warchest the count doesn't show yet: they're still on their way in. */
  #held = 0;
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

  private constructor(
    element: HTMLElement,
    deps: HudDeps,
    models: { chest: THREE.Object3D; log: THREE.Object3D },
  ) {
    this.#element = element;
    this.#game = deps.game;
    this.#item = deps.item;
    this.#haptics = deps.haptics;
    this.#pour = deps.game.data.warchest.pour;
    this.#sfx.load(SOUNDS);

    this.#renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.domElement.className = 'warchest-layer';
    element.append(this.#renderer.domElement);
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
    const log = models.log.clone(true);
    const logSize = new THREE.Box3().setFromObject(log).getSize(new THREE.Vector3());
    log.scale.setScalar(PIECE_LENGTH / Math.max(logSize.z, 0.001));
    this.#log = log;

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
    const [chest, log] = await Promise.all([loadModel(MODELS.chest), loadModel(MODELS.log)]);
    return new WarchestHud(element, deps, { chest, log });
  }

  /**
   * Call when `amount` items have just gone into the warchest: the count holds them back until
   * `pour` sends them in, so the player watches them arrive.
   */
  hold(amount: number): Deposit {
    this.#held += amount;
    this.#showCount();
    let poured = false;
    return {
      pour: (from) => {
        if (poured) return;
        poured = true;
        this.#startPour(amount, from);
      },
    };
  }

  /** Finishes any pour at once and shuts the panel (e.g. leaving the station). */
  settle(): void {
    for (const flight of this.#flights) this.#scene.remove(flight.mesh);
    this.#flights = [];
    this.#held = 0;
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

  dispose(): void {
    this.#unsubscribe();
    window.clearTimeout(this.#slamTimer);
    this.#stop();
    this.#renderer.dispose();
  }

  #startPour(amount: number, from: ScreenPoint[]): void {
    const sources = from.length > 0 ? from : [this.#chestPoint()];
    const pieces = splitDeposit(amount, sources.length, this.#pour.maxPieces, this.#pour.stagger);
    const now = performance.now() / 1000;
    for (const piece of pieces) {
      const source = sources[piece.from] ?? this.#chestPoint();
      const mesh = this.#log.clone(true);
      mesh.visible = false;
      this.#scene.add(mesh);
      this.#flights.push({
        mesh,
        from: new THREE.Vector2(source.x, source.y),
        share: piece.share,
        launchAt: now + piece.delay,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(6 + Math.random() * 4),
      });
    }
    this.#arrived = 0;
    this.#poured += amount;
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
      count: (item, quality) =>
        Math.max(
          inventory.count(item, quality) -
            (item === this.#item && quality === undefined ? this.#held : 0),
          0,
        ),
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
      mesh.scale.setScalar((this.#log.scale.x || 1) * scale);
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
    this.#held = Math.max(this.#held - flight.share, 0);
    this.#arrived += 1;
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
    this.#gain.textContent = `+${this.#poured}`;
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
    const shown = Math.max(this.#game.inventory.count(this.#item) - this.#held, 0);
    this.#count.textContent = String(shown);
    this.#anchor.dataset.count = String(shown);
    this.#anchor.dataset.settled = String(this.#held === 0 && this.#flights.length === 0);
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
