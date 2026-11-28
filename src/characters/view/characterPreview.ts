import * as THREE from 'three';
import { gpuOf } from '../../app/deviceHints';
import { capturePointer, releasePointer } from '../../app/pointer';
import { percentile } from '../../bench/logic/stats';
import type { EventLogger, GraphicsSettings, GraphicsTier } from '../../core';
import type { Characters } from '../../data';
import { loadCharacterKit, type CharacterKit, type PlacedCharacter } from './characterKit';
import './characters.css';

// Debug → Character preview: one of the siege's guard looks and its captain side by side, to judge
// their looks (Look shows the guards' next). Each clip has a button (both play it); High or Low
// draws them as that graphics tier would (it starts on this phone's). Crowd shows about as many
// guards as the siege does, in all their looks, all animating, to see what that costs. Drag to orbit, pinch or scroll to zoom. What
// it costs to draw (draw calls, triangles, texture memory, the frame time) shows at the top and is
// logged as `characters.preview` once each build has settled.

export interface CharacterPreviewDeps {
  characters: Characters;
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
type Mode = 'pair' | 'crowd';

class CharacterPreview {
  readonly #deps: CharacterPreviewDeps;
  readonly #root: HTMLElement;
  readonly #status: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #camera: THREE.PerspectiveCamera;
  readonly #scene = new THREE.Scene();
  readonly #sun: THREE.DirectionalLight;
  readonly #ground: THREE.Mesh;
  readonly #people = new THREE.Group();
  readonly #tierButtons = new Map<GraphicsTier, HTMLButtonElement>();
  readonly #clipButtons = new Map<string, HTMLButtonElement>();
  readonly #crowdButton: HTMLButtonElement;
  readonly #lookButton: HTMLButtonElement;
  readonly #closed: Promise<void>;
  readonly #timer = new THREE.Timer();
  #close: () => void = () => undefined;
  #kit: CharacterKit | undefined;
  #placed: PlacedCharacter[] = [];
  #tier: GraphicsTier;
  #mode: Mode = 'pair';
  /** The guards' look on show in the pair (by its place in `guards`). */
  #look = 0;
  /** The clip the buttons last asked for (the crowd plays its mix until one is). */
  #clip: string | undefined;
  /** Bumped by every build, so a slow one that's been overtaken is thrown away. */
  #building = 0;
  #measured = false;
  #frames = 0;
  /** The last frames' times (ms): from frame to frame, and the work in each (mixers and draw). */
  #frameMs: number[] = [];
  #workMs: number[] = [];
  #lastFrame = 0;
  #shownAt = 0;
  // The orbit: round the target, `yaw` and `pitch` (radians), `distance` (m) away.
  readonly #target = new THREE.Vector3();
  #yaw: number;
  #pitch: number;
  #distance: number;
  readonly #pointers = new Map<number, { x: number; y: number }>();
  #pinchGap = 0;

  constructor(host: HTMLElement, deps: CharacterPreviewDeps) {
    this.#deps = deps;
    const { preview } = deps.characters;
    this.#tier = deps.graphics.tier;
    this.#target.set(...preview.orbit.target);
    this.#yaw = preview.orbit.yaw * DEG;
    this.#pitch = preview.orbit.pitch.start * DEG;
    this.#distance = preview.orbit.distance.start;
    this.#closed = new Promise((resolve) => {
      this.#close = resolve;
    });

    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'character-canvas';
    deps.graphics.noteGpu(gpuOf(this.#renderer.getContext()).gpu);
    this.#camera = new THREE.PerspectiveCamera(preview.fov, 1, 0.1, 200);

    const { colors, light } = preview;
    this.#scene.background = new THREE.Color(colors.sky);
    this.#scene.add(
      new THREE.HemisphereLight(colors.skyLight, colors.groundLight, light.hemisphere),
    );
    this.#sun = new THREE.DirectionalLight(colors.sun, light.sun);
    this.#sun.position.set(...light.from);
    const shadow = this.#sun.shadow;
    shadow.mapSize.set(light.shadowMap.size, light.shadowMap.size);
    const half = light.shadowMap.halfWidth;
    Object.assign(shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    shadow.camera.far = light.shadowMap.far;
    shadow.bias = light.shadowMap.bias;
    this.#scene.add(this.#sun, this.#sun.target);
    this.#ground = new THREE.Mesh(
      new THREE.PlaneGeometry(preview.ground, preview.ground),
      new THREE.MeshLambertMaterial({ color: colors.ground }),
    );
    this.#ground.rotation.x = -Math.PI / 2;
    this.#ground.receiveShadow = true;
    this.#scene.add(this.#ground, this.#people);

    const close = el('button', { type: 'button', textContent: 'Close' });
    close.addEventListener('click', () => {
      this.#dispose();
    });
    const tiers = el('div', { className: 'character-group', role: 'group', ariaLabel: 'Graphics' });
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
    this.#status = el('p', { className: 'character-stats', role: 'status' });
    const clips = el('div', { className: 'character-group', role: 'group', ariaLabel: 'Clips' });
    for (const clip of deps.characters.clips) {
      const button = el('button', { type: 'button', textContent: clip.label });
      button.addEventListener('click', () => {
        this.#playAll(clip.id);
      });
      this.#clipButtons.set(clip.id, button);
      clips.append(button);
    }
    this.#crowdButton = el('button', { type: 'button', textContent: 'Crowd' });
    this.#crowdButton.addEventListener('click', () => {
      this.#setMode(this.#mode === 'crowd' ? 'pair' : 'crowd');
    });
    this.#lookButton = el('button', { type: 'button', className: 'character-look' });
    this.#lookButton.addEventListener('click', () => {
      this.#nextLook();
    });
    this.#root = el(
      'div',
      {
        id: 'character-preview',
        className: 'character-preview',
        role: 'dialog',
        ariaLabel: 'Character preview',
      },
      [
        this.#renderer.domElement,
        el('div', { className: 'character-top' }, [
          el('h1', { textContent: 'Characters' }),
          tiers,
          close,
          this.#status,
        ]),
        el('div', { className: 'character-bottom' }, [
          clips,
          el('div', { className: 'character-row' }, [this.#lookButton, this.#crowdButton]),
        ]),
      ],
    );
    host.append(this.#root);
    this.#root.dataset.mode = this.#mode;
    this.#markLook();
    this.#markButtons();
    this.#listen(this.#renderer.domElement);
    new ResizeObserver(() => {
      this.#resize();
    }).observe(this.#root);
    this.#resize();
    this.#renderer.setAnimationLoop((time) => {
      this.#tick(time);
    });
    deps.logger.log('characters.previewOpen', { tier: this.#tier });
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
    this.#status.textContent = 'Loading the characters…';
    const started = performance.now();
    let kit: CharacterKit;
    try {
      kit = await loadCharacterKit(
        this.#deps.characters,
        tier,
        Math.min(4, this.#renderer.capabilities.getMaxAnisotropy()),
      );
    } catch (error) {
      if (build !== this.#building) return;
      this.#status.textContent = `Couldn't load them: ${String(error)}`;
      this.#root.dataset.state = 'failed';
      this.#deps.logger.log('characters.previewFailed', { tier, error: String(error) });
      return;
    }
    if (build !== this.#building || !this.#root.isConnected) {
      kit.dispose();
      return;
    }
    this.#clear();
    this.#kit?.dispose();
    this.#kit = kit;
    const shadows = this.#deps.characters.tiers[tier].shadows;
    this.#renderer.shadowMap.enabled = shadows;
    this.#sun.castShadow = shadows;
    this.#root.dataset.loadMs = String(Math.round(performance.now() - started));
    this.#populate();
  }

  /** Places the pair or the crowd, playing the clip asked for (or the crowd's mix). */
  #populate(): void {
    const kit = this.#kit;
    if (!kit) return;
    this.#clear();
    const { characters } = this.#deps;
    const { preview } = characters;
    if (this.#mode === 'pair') {
      const pair = this.#pair();
      pair.forEach((model, index) => {
        const placed = kit.place(model);
        placed.root.position.x = (index - (pair.length - 1) / 2) * preview.spacing;
        this.#placed.push(placed);
      });
    } else {
      const { crowd } = preview;
      const rows = Math.ceil(crowd.count / crowd.columns);
      for (let index = 0; index < crowd.count; index++) {
        const placed = kit.place(characters.guards[index % characters.guards.length] ?? '');
        const column = index % crowd.columns;
        const row = Math.floor(index / crowd.columns);
        placed.root.position.set(
          (column - (crowd.columns - 1) / 2) * crowd.spacing,
          0,
          (row - (rows - 1) / 2) * crowd.spacing,
        );
        this.#placed.push(placed);
      }
    }
    for (const placed of this.#placed) this.#people.add(placed.root);
    this.#playAll(this.#clip, false);
    this.#measured = false;
    this.#frames = 0;
    this.#frameMs = [];
    this.#workMs = [];
  }

  /**
   * Every character plays `clip`, each a little further into it than the last (so a crowd isn't in
   * step); with none, the crowd plays its mix in turn, and the pair idles.
   */
  #playAll(clip: string | undefined, asked = true): void {
    const { characters } = this.#deps;
    if (asked) {
      this.#clip = clip;
      this.#deps.logger.log('characters.previewClip', { clip, mode: this.#mode });
    }
    const mix = this.#mode === 'crowd' ? characters.preview.crowd.clips : [characters.idleClip];
    this.#placed.forEach((placed, index) => {
      const name = clip ?? mix[index % mix.length] ?? characters.idleClip;
      const length = this.#kit?.clipSeconds(name) ?? 0;
      const once = characters.clips.find((entry) => entry.id === name)?.play !== 'loop';
      placed.play(name, once ? 0 : ((index * 0.37) % 1) * length);
    });
    this.#root.dataset.clip = clip ?? 'mix';
    this.#markButtons();
  }

  /** The pair: the guards' look on show, and every other character (the captain). */
  #pair(): string[] {
    const { characters } = this.#deps;
    const look = characters.guards[this.#look % characters.guards.length] ?? '';
    const others = characters.models.filter((model) => !characters.guards.includes(model.id));
    return [look, ...others.map((model) => model.id)];
  }

  /** The guards' next look (back to the pair, if the crowd's on show). */
  #nextLook(): void {
    const { characters } = this.#deps;
    this.#look = (this.#look + 1) % characters.guards.length;
    this.#markLook();
    this.#deps.logger.log('characters.previewLook', { look: this.#pair()[0], tier: this.#tier });
    if (this.#mode === 'pair') this.#populate();
    else this.#setMode('pair');
  }

  #markLook(): void {
    const [look] = this.#pair();
    const name = this.#deps.characters.models.find((model) => model.id === look)?.name ?? '';
    this.#lookButton.textContent = `Look ${String(this.#look + 1)}/${String(this.#deps.characters.guards.length)}: ${name}`;
    this.#root.dataset.look = look ?? '';
  }

  #setMode(mode: Mode): void {
    this.#mode = mode;
    this.#clip = undefined;
    this.#root.dataset.mode = mode;
    const { orbit, crowd } = this.#deps.characters.preview;
    this.#distance = mode === 'crowd' ? crowd.distance : orbit.distance.start;
    this.#pitch = (mode === 'crowd' ? crowd.pitch : orbit.pitch.start) * DEG;
    this.#deps.logger.log('characters.previewMode', { mode, tier: this.#tier });
    this.#populate();
  }

  #markButtons(): void {
    for (const [key, button] of this.#clipButtons) {
      button.setAttribute('aria-pressed', String(key === this.#clip));
    }
    this.#crowdButton.setAttribute('aria-pressed', String(this.#mode === 'crowd'));
  }

  #clear(): void {
    for (const placed of this.#placed) {
      placed.mixer.stopAllAction();
      placed.mixer.uncacheRoot(placed.mixer.getRoot());
      this.#people.remove(placed.root);
    }
    this.#placed = [];
  }

  /** Draw calls and triangles as drawn, the texture memory, and the frame time. */
  #measure(): void {
    const kit = this.#kit;
    if (!kit) return;
    const info = this.#renderer.info.render;
    const median = (list: number[]) =>
      percentile(
        [...list].sort((a, b) => a - b),
        0.5,
      );
    const frameMs = median(this.#frameMs);
    const workMs = median(this.#workMs);
    const textureMB = kit.textureMB();
    const tier = this.#tier === 'high' ? 'High' : 'Low';
    const round = (ms: number) => Math.round(ms * 10) / 10;
    const lead =
      this.#mode === 'crowd'
        ? `Crowd of ${String(this.#placed.length)} on ${tier}`
        : `${tier}: ${this.#pair()
            .map((id) => {
              const name = this.#deps.characters.models.find((model) => model.id === id)?.name;
              return `${name ?? id} ${String(kit.triangles.get(id) ?? 0)}`;
            })
            .join(', ')} tris, ${String(kit.bones)} bones`;
    this.#status.textContent =
      `${lead} · ${String(info.calls)} draws · ${(info.triangles / 1000).toFixed(1)}k tris drawn · ` +
      `${String(textureMB)} MB textures · ${String(round(frameMs))} ms a frame ` +
      `(${String(round(workMs))} ms work)`;
    Object.assign(this.#root.dataset, {
      state: 'ready',
      drawCalls: String(info.calls),
      triangles: String(info.triangles),
      textureMb: String(textureMB),
      frameMs: String(round(frameMs)),
    });
    if (!this.#measured) {
      this.#measured = true;
      this.#deps.logger.log('characters.preview', {
        tier: this.#tier,
        mode: this.#mode,
        looks: this.#mode === 'pair' ? this.#pair() : this.#deps.characters.guards,
        characters: this.#placed.length,
        drawCalls: info.calls,
        triangles: info.triangles,
        textureMB,
        frameMs: round(frameMs),
        workMs: round(workMs),
        bones: kit.bones,
        modelTriangles: Object.fromEntries(kit.triangles),
        loadMs: Number(this.#root.dataset.loadMs ?? 0),
      });
    }
  }

  #pose(): void {
    const flat = Math.cos(this.#pitch) * this.#distance;
    this.#camera.position.set(
      this.#target.x + Math.sin(this.#yaw) * flat,
      this.#target.y + Math.sin(this.#pitch) * this.#distance,
      this.#target.z + Math.cos(this.#yaw) * flat,
    );
    this.#camera.lookAt(this.#target);
  }

  #clamp(): void {
    const { pitch, distance } = this.#deps.characters.preview.orbit;
    this.#pitch = Math.min(pitch.max * DEG, Math.max(pitch.min * DEG, this.#pitch));
    this.#distance = Math.min(distance.max, Math.max(distance.min, this.#distance));
  }

  #listen(canvas: HTMLCanvasElement): void {
    const preview = this.#deps.characters.preview;
    const gap = () => {
      const [a, b] = [...this.#pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (!capturePointer(canvas, event.pointerId)) return;
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
        this.#distance *= event.deltaY > 0 ? preview.zoomStep : 1 / preview.zoomStep;
        this.#clamp();
      },
      { passive: false },
    );
  }

  #tick(time: number): void {
    this.#timer.update(time);
    const dt = Math.min(this.#timer.getDelta(), 0.1);
    const kit = this.#kit;
    if (!kit) return;
    const { frames } = this.#deps.characters.preview;
    if (this.#lastFrame > 0) this.#frameMs.push(time - this.#lastFrame);
    this.#lastFrame = time;
    const started = performance.now();
    for (const placed of this.#placed) placed.mixer.update(dt);
    this.#pose();
    this.#renderer.render(this.#scene, this.#camera);
    this.#workMs.push(performance.now() - started);
    if (this.#frameMs.length > frames) this.#frameMs.shift();
    if (this.#workMs.length > frames) this.#workMs.shift();
    // A few frames in, once the textures have uploaded, it says what it costs; then twice a second.
    this.#frames++;
    if (this.#frames < 10) return;
    if (!this.#measured || time - this.#shownAt > 500) {
      this.#shownAt = time;
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
    this.#clear();
    this.#kit?.dispose();
    this.#kit = undefined;
    this.#ground.geometry.dispose();
    (this.#ground.material as THREE.Material).dispose();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
    this.#root.remove();
    this.#deps.logger.log('characters.previewClose', { tier: this.#tier });
    this.#close();
  }
}

/** Opens the character preview over `host`; resolves once it's closed. */
export async function openCharacterPreview(
  host: HTMLElement,
  deps: CharacterPreviewDeps,
): Promise<void> {
  const preview = new CharacterPreview(host, deps);
  await preview.closed;
}
