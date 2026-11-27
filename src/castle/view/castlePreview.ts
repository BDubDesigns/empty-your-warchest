import * as THREE from 'three';
import { gpuOf } from '../../app/deviceHints';
import { capturePointer, releasePointer } from '../../app/pointer';
import type { EventLogger, GraphicsSettings, GraphicsTier } from '../../core';
import { castleBreakableKinds, type Castle, type CastleVantage } from '../../data';
import { buildCastleScene, type CastleScene } from './castleScene';
import './castle.css';

// Debug → Castle preview: the siege's castle on its own, to judge its looks before the siege moves
// onto it. Drag to orbit, pinch or scroll to zoom, or jump to one of the siege's vantage points
// (the camera flies there). High or Low draws it as that graphics tier would (it starts on this
// phone's). What it costs to draw (draw calls, triangles, texture memory) shows at the top and is
// logged as `castle.preview` when each tier is built.

export interface CastlePreviewDeps {
  castle: Castle;
  logger: EventLogger;
  graphics: GraphicsSettings;
}

type Props<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & {
  dataset?: Record<string, string>;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(element, rest);
  if (dataset) Object.assign(element.dataset, dataset);
  element.append(...children);
  return element;
}

const DEG = Math.PI / 180;

/** Where the camera is and what it looks at. */
interface Pose {
  at: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/** Eased 0 to 1. */
const ease = (t: number) => t * t * (3 - 2 * t);

class CastlePreview {
  readonly #deps: CastlePreviewDeps;
  readonly #root: HTMLElement;
  readonly #status: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #camera: THREE.PerspectiveCamera;
  readonly #tierButtons = new Map<GraphicsTier, HTMLButtonElement>();
  readonly #viewButtons = new Map<string, HTMLButtonElement>();
  readonly #closed: Promise<void>;
  readonly #timer = new THREE.Timer();
  #close: () => void = () => undefined;
  #built: CastleScene | undefined;
  #tier: GraphicsTier;
  /** Bumped by every build, so a slow one that's been overtaken is thrown away. */
  #building = 0;
  #measured = false;
  #frames = 0;
  // The orbit: round `target`, `yaw` and `pitch` (radians), `distance` (m) away.
  readonly #target = new THREE.Vector3();
  #yaw: number;
  #pitch: number;
  #distance: number;
  /** A vantage point the camera is at (or flying to); the orbit if none. */
  #vantage: CastleVantage | undefined;
  #flight: { from: Pose; to: Pose; t: number } | undefined;
  readonly #pointers = new Map<number, { x: number; y: number }>();
  #pinchGap = 0;

  constructor(host: HTMLElement, deps: CastlePreviewDeps) {
    this.#deps = deps;
    const preview = deps.castle.preview;
    this.#tier = deps.graphics.tier;
    this.#target.set(...preview.target);
    this.#yaw = preview.yaw * DEG;
    this.#pitch = preview.pitch.start * DEG;
    this.#distance = preview.distance.start;
    this.#closed = new Promise((resolve) => {
      this.#close = resolve;
    });

    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'castle-canvas';
    deps.graphics.noteGpu(gpuOf(this.#renderer.getContext()).gpu);
    this.#camera = new THREE.PerspectiveCamera(preview.fov, 1, 0.5, 700);

    const close = el('button', { type: 'button', textContent: 'Close' });
    close.addEventListener('click', () => {
      this.#dispose();
    });
    const tiers = el('div', { className: 'castle-group', role: 'group', ariaLabel: 'Graphics' });
    for (const [tier, label] of [
      ['high', 'High'],
      ['low', 'Low'],
    ] as const) {
      const button = el('button', { type: 'button', textContent: label });
      button.addEventListener('click', () => {
        void this.#build(tier);
      });
      this.#tierButtons.set(tier, button);
      tiers.append(button);
    }
    this.#status = el('p', { className: 'castle-stats', role: 'status' });
    const views = el('div', { className: 'castle-group', role: 'group', ariaLabel: 'Views' });
    const orbit = el('button', { type: 'button', textContent: 'Orbit' });
    orbit.addEventListener('click', () => {
      this.#flyTo(undefined);
    });
    this.#viewButtons.set('orbit', orbit);
    views.append(orbit);
    for (const vantage of deps.castle.vantages) {
      const button = el('button', { type: 'button', textContent: vantage.name });
      button.addEventListener('click', () => {
        this.#flyTo(vantage);
      });
      this.#viewButtons.set(vantage.id, button);
      views.append(button);
    }
    this.#root = el(
      'div',
      {
        id: 'castle-preview',
        className: 'castle-preview',
        role: 'dialog',
        ariaLabel: 'Castle preview',
      },
      [
        this.#renderer.domElement,
        el('div', { className: 'castle-top' }, [
          el('h1', { textContent: 'Castle' }),
          tiers,
          close,
          this.#status,
        ]),
        el('div', { className: 'castle-bottom' }, [views]),
      ],
    );
    host.append(this.#root);
    this.#markView();
    this.#listen(this.#renderer.domElement);
    new ResizeObserver(() => {
      this.#resize();
    }).observe(this.#root);
    this.#resize();
    this.#renderer.setAnimationLoop((time) => {
      this.#tick(time);
    });
    deps.logger.log('castle.previewOpen', { tier: this.#tier });
    void this.#build(this.#tier);
  }

  get closed(): Promise<void> {
    return this.#closed;
  }

  async #build(tier: GraphicsTier): Promise<void> {
    const build = ++this.#building;
    this.#tier = tier;
    for (const [key, button] of this.#tierButtons) {
      button.setAttribute('aria-pressed', String(key === tier));
    }
    this.#root.dataset.state = 'loading';
    this.#root.dataset.tier = tier;
    this.#status.textContent = 'Building the castle…';
    const started = performance.now();
    let built: CastleScene;
    try {
      built = await buildCastleScene(
        this.#deps.castle,
        tier,
        Math.min(4, this.#renderer.capabilities.getMaxAnisotropy()),
      );
    } catch (error) {
      if (build !== this.#building) return;
      this.#status.textContent = `Couldn't build it: ${String(error)}`;
      this.#root.dataset.state = 'failed';
      this.#deps.logger.log('castle.previewFailed', { tier, error: String(error) });
      return;
    }
    if (build !== this.#building || !this.#root.isConnected) {
      built.dispose();
      return;
    }
    this.#built?.dispose();
    this.#built = built;
    this.#renderer.shadowMap.enabled = this.#deps.castle.tiers[tier].shadows;
    this.#measured = false;
    this.#frames = 0;
    this.#root.dataset.loadMs = String(Math.round(performance.now() - started));
  }

  /** Draw calls and triangles as drawn, and the memory, once the textures are in. */
  #measure(): void {
    const built = this.#built;
    if (!built) return;
    const info = this.#renderer.info.render;
    const memory = built.measure();
    const stats = {
      tier: this.#tier,
      drawCalls: info.calls,
      triangles: info.triangles,
      ...memory,
      breakable: built.layout.parts.filter((part) => castleBreakableKinds.includes(part.kind))
        .length,
      loadMs: Number(this.#root.dataset.loadMs ?? 0),
    };
    this.#status.textContent =
      `${this.#tier === 'high' ? 'High' : 'Low'}: ${String(stats.drawCalls)} draws · ` +
      `${(stats.triangles / 1000).toFixed(0)}k tris · ${String(stats.textureMB)} MB textures ` +
      `(castle ${String(stats.castleTextureMB)} MB, ${(stats.castleTriangles / 1000).toFixed(0)}k tris, ` +
      `${String(stats.breakable)} parts that break)`;
    Object.assign(this.#root.dataset, {
      state: 'ready',
      drawCalls: String(stats.drawCalls),
      triangles: String(stats.triangles),
      textureMb: String(stats.textureMB),
    });
    this.#deps.logger.log('castle.preview', stats);
  }

  #flyTo(vantage: CastleVantage | undefined): void {
    const from = this.#pose();
    this.#vantage = vantage;
    if (!vantage) {
      const preview = this.#deps.castle.preview;
      this.#target.set(...preview.target);
      this.#yaw = preview.yaw * DEG;
      this.#pitch = preview.pitch.start * DEG;
      this.#distance = preview.distance.start;
    }
    this.#flight = { from, to: this.#pose(), t: 0 };
    this.#markView();
    this.#deps.logger.log('castle.previewView', { view: vantage?.id ?? 'orbit' });
  }

  /** Where the camera should be: at the vantage point, or on the orbit. */
  #pose(): Pose {
    const vantage = this.#vantage;
    if (vantage) {
      return {
        at: new THREE.Vector3(...vantage.at),
        look: new THREE.Vector3(...vantage.look),
        fov: vantage.fov,
      };
    }
    const flat = Math.cos(this.#pitch) * this.#distance;
    return {
      at: new THREE.Vector3(
        this.#target.x + Math.sin(this.#yaw) * flat,
        this.#target.y + Math.sin(this.#pitch) * this.#distance,
        this.#target.z + Math.cos(this.#yaw) * flat,
      ),
      look: this.#target.clone(),
      fov: this.#deps.castle.preview.fov,
    };
  }

  #markView(): void {
    const current = this.#vantage?.id ?? 'orbit';
    this.#root.dataset.view = current;
    for (const [key, button] of this.#viewButtons) {
      button.setAttribute('aria-pressed', String(key === current));
    }
  }

  /** From a vantage point, a drag orbits round what it looks at. */
  #orbitFromHere(): void {
    const vantage = this.#vantage;
    if (!vantage) return;
    const at = new THREE.Vector3(...vantage.at);
    this.#target.set(...vantage.look);
    const offset = at.sub(this.#target);
    this.#distance = offset.length();
    this.#yaw = Math.atan2(offset.x, offset.z);
    this.#pitch = Math.asin(offset.y / Math.max(this.#distance, 1e-6));
    this.#vantage = undefined;
    this.#flight = undefined;
    this.#markView();
  }

  #clamp(): void {
    const { pitch, distance } = this.#deps.castle.preview;
    this.#pitch = Math.min(pitch.max * DEG, Math.max(pitch.min * DEG, this.#pitch));
    this.#distance = Math.min(distance.max, Math.max(distance.min, this.#distance));
  }

  #listen(canvas: HTMLCanvasElement): void {
    const preview = this.#deps.castle.preview;
    const gap = () => {
      const [a, b] = [...this.#pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (!capturePointer(canvas, event.pointerId)) return;
      this.#orbitFromHere();
      this.#flight = undefined;
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#pointers.size === 2) this.#pinchGap = gap();
    });
    canvas.addEventListener('pointermove', (event) => {
      const last = this.#pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#pointers.size >= 2) {
        const now = gap();
        if (this.#pinchGap > 0 && now > 0) this.#distance *= this.#pinchGap / now;
        this.#pinchGap = now;
      } else {
        const turn = (preview.dragDegrees * DEG) / Math.max(canvas.clientWidth, 1);
        this.#yaw -= dx * turn;
        this.#pitch += dy * turn;
      }
      this.#clamp();
    });
    const release = (event: PointerEvent): void => {
      releasePointer(canvas, event.pointerId);
      this.#pointers.delete(event.pointerId);
      this.#pinchGap = gap();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.#orbitFromHere();
        this.#distance *= event.deltaY > 0 ? preview.zoomStep : 1 / preview.zoomStep;
        this.#clamp();
      },
      { passive: false },
    );
  }

  #tick(time: number): void {
    this.#timer.update(time);
    const dt = Math.min(this.#timer.getDelta(), 0.1);
    const flight = this.#flight;
    let pose = this.#pose();
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / this.#deps.castle.preview.flySeconds);
      const k = ease(flight.t);
      pose = {
        at: flight.from.at.clone().lerp(flight.to.at, k),
        look: flight.from.look.clone().lerp(flight.to.look, k),
        fov: flight.from.fov + (flight.to.fov - flight.from.fov) * k,
      };
      if (flight.t >= 1) this.#flight = undefined;
    }
    this.#camera.position.copy(pose.at);
    this.#camera.lookAt(pose.look);
    if (this.#camera.fov !== pose.fov) {
      this.#camera.fov = pose.fov;
      this.#camera.updateProjectionMatrix();
    }
    const built = this.#built;
    if (!built) return;
    this.#renderer.render(built.scene, this.#camera);
    // A few frames in, once the textures have uploaded, measure what it costs.
    if (!this.#measured && ++this.#frames >= 3) {
      this.#measured = true;
      this.#measure();
    }
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#root;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  #dispose(): void {
    this.#building++;
    this.#renderer.setAnimationLoop(null);
    this.#built?.dispose();
    this.#built = undefined;
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
    this.#root.remove();
    this.#deps.logger.log('castle.previewClose', { tier: this.#tier });
    this.#close();
  }
}

/** Opens the castle preview over `host`; resolves once it's closed. */
export async function openCastlePreview(host: HTMLElement, deps: CastlePreviewDeps): Promise<void> {
  const preview = new CastlePreview(host, deps);
  await preview.closed;
}
