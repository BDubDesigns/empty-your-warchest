import * as THREE from 'three';
import type { EventLogger } from '../../core';
import { loadBenchData, type BenchData, type BenchPixelRatio } from '../../data/bench';
import { loadPhysics } from '../../stations/siege/logic/physics';
import { CollapseSim, type BodyPose } from '../logic/collapse';
import { cameraAt, walkerAt } from '../logic/layout';
import {
  pixelRatioFor,
  pixelRatioLabel,
  planSeconds,
  runAllPlan,
  type RunSettings,
} from '../logic/plan';
import { frameStats, timingStats, type FrameStats } from '../logic/stats';
import { buildPackScene, type PackScene } from './packScene';
import './bench.css';

// Debug → Stress test: its own full-screen three.js screen. Pick a pack, a scale and what to turn
// off, and run it (or Run all): each run flies the same 20 s camera path through the scene,
// the fort comes down at 10 s, and every frame's time is kept. The results are shown in a table
// and logged as `bench.result`, so they come back with Debug → Share logs.

export interface BenchDeps {
  logger: EventLogger;
  buildLabel: string;
}

/** What this device is, as far as the browser says. */
interface DeviceInfo {
  gpu: string;
  gpuVendor: string;
  devicePixelRatio: number;
  screen: [number, number];
  userAgent: string;
  cores: number;
  memoryGB: number | null;
  webgl: string;
  maxTextureSize: number;
}

export interface BenchResult {
  pack: string;
  scale: number;
  shadows: boolean;
  physics: boolean;
  matte: boolean;
  pixelRatio: number;
  pixelRatioChoice: BenchPixelRatio;
  note: string;
  fps: FrameStats;
  cpuMs: ReturnType<typeof timingStats>;
  physicsMs: ReturnType<typeof timingStats>;
  animationMs: ReturnType<typeof timingStats>;
  drawCalls: { median: number; max: number };
  triangles: { median: number; max: number };
  geometries: number;
  textures: number;
  programs: number;
  textureMB: number;
  geometryMB: number;
  loadMs: number;
  warmMs: number;
  heapMB: number | null;
  canvas: [number, number];
  scene: PackScene['counts'];
  bodiesMoving: number;
  stopped: boolean;
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

function nextFrame(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

function deviceInfo(renderer: THREE.WebGLRenderer): DeviceInfo {
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const text = (value: unknown) => (typeof value === 'string' ? value : String(value));
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    gpu: text(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    gpuVendor: text(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
    devicePixelRatio: window.devicePixelRatio,
    screen: [window.screen.width, window.screen.height],
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    memoryGB: nav.deviceMemory ?? null,
    webgl: text(gl.getParameter(gl.VERSION)),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
  };
}

function heapMB(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / (1024 * 1024)) : null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** The bench screen, open until its Close button is tapped. */
class Bench {
  readonly #data: BenchData;
  readonly #deps: BenchDeps;
  readonly #root: HTMLElement;
  readonly #stage: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #hud: HTMLElement;
  readonly #hudText: HTMLElement;
  readonly #status: HTMLElement;
  readonly #table: HTMLTableSectionElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #camera: THREE.PerspectiveCamera;
  readonly #device: DeviceInfo;
  readonly #choice: {
    pack: string;
    scale: number;
    shadows: boolean;
    physics: boolean;
    matte: boolean;
    pixelRatio: BenchPixelRatio;
  };
  readonly #closed: Promise<void>;
  #close: () => void = () => undefined;
  #busy = false;
  #stop = false;
  #runCount = 0;
  #pose: BodyPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  constructor(host: HTMLElement, deps: BenchDeps) {
    this.#data = loadBenchData();
    this.#deps = deps;
    const data = this.#data;
    const first = data.packs[0];
    this.#choice = {
      pack: first?.id ?? '',
      scale: data.scales[0] ?? 1,
      shadows: true,
      physics: true,
      matte: false,
      pixelRatio: data.pixelRatios[0] ?? 'game',
    };
    this.#closed = new Promise((resolve) => {
      this.#close = resolve;
    });

    this.#stage = el('div', { className: 'bench-stage' });
    this.#hudText = el('span');
    const stop = el('button', { type: 'button', textContent: 'Stop' });
    stop.addEventListener('click', () => {
      this.#stop = true;
      this.#hudText.textContent = 'Stopping…';
    });
    this.#hud = el('div', { className: 'bench-hud', hidden: true }, [this.#hudText, stop]);
    this.#status = el('p', { className: 'bench-status', role: 'status' });
    this.#table = el('tbody');
    this.#panel = this.#buildPanel();
    this.#root = el(
      'div',
      { id: 'bench', className: 'bench', role: 'dialog', ariaLabel: 'Stress test' },
      [this.#stage, this.#hud, this.#panel],
    );
    this.#root.dataset.benchState = 'idle';
    host.append(this.#root);

    this.#renderer = new THREE.WebGLRenderer({ antialias: data.renderer.antialias });
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    this.#renderer.domElement.className = 'bench-canvas';
    this.#stage.append(this.#renderer.domElement);
    this.#camera = new THREE.PerspectiveCamera(
      data.renderer.fov,
      1,
      data.renderer.near,
      data.renderer.far,
    );
    this.#device = deviceInfo(this.#renderer);
    this.#resize();
    new ResizeObserver(() => {
      this.#resize();
    }).observe(this.#stage);
    this.#deps.logger.log('bench.open', { build: deps.buildLabel, device: { ...this.#device } });
    this.#showDevice();
  }

  get closed(): Promise<void> {
    return this.#closed;
  }

  // Controls

  #buildPanel(): HTMLElement {
    const data = this.#data;
    const choice = this.#choice;
    const device = window.devicePixelRatio;
    const most = data.renderer.maxPixelRatio;
    const picker = <T>(
      label: string,
      options: { label: string; value: T }[],
      get: () => T,
      set: (value: T) => void,
    ): HTMLElement => {
      const buttons = options.map((option) => {
        const button = el('button', { type: 'button', textContent: option.label });
        button.addEventListener('click', () => {
          set(option.value);
          show();
        });
        return { button, value: option.value };
      });
      const show = () => {
        for (const { button, value } of buttons) {
          button.setAttribute('aria-pressed', String(value === get()));
        }
      };
      show();
      return el('div', { className: 'bench-choice' }, [
        el('p', { className: 'bench-label', textContent: label }),
        el(
          'div',
          { className: 'bench-row', role: 'group', ariaLabel: label },
          buttons.map(({ button }) => button),
        ),
      ]);
    };
    const onOff = [
      { label: 'On', value: true },
      { label: 'Off', value: false },
    ];
    const runButton = el('button', { type: 'button', className: 'bench-go', textContent: 'Run' });
    runButton.addEventListener('click', () => {
      void this.#runSet([{ ...choice, note: '' }], 'single');
    });
    const minutes = Math.ceil(planSeconds(data.runAll.length, data, 5) / 60);
    const runAllButton = el('button', {
      type: 'button',
      className: 'bench-go',
      textContent: `Run all (${String(data.runAll.length)} runs, ~${String(minutes)} min)`,
    });
    runAllButton.addEventListener('click', () => {
      void this.#runSet(runAllPlan(data, choice.pixelRatio), 'all');
    });
    const close = el('button', { type: 'button', className: 'bench-close', textContent: 'Close' });
    close.addEventListener('click', () => {
      if (!this.#busy) this.#dispose();
    });
    const caveat = el('p', {
      className: 'bench-note',
      textContent:
        'Phones slow down as they get hot (thermal throttling), so start from a cool phone off the ' +
        'charger, other apps closed, and leave it flat while it runs. Run all does the boxes twice: ' +
        'if the second is slower, the phone has throttled. Frame rates top out at the screen’s ' +
        'refresh rate (60 or 120 Hz). Results are logged: send them with Debug → Share logs.',
    });
    return el('div', { className: 'bench-panel' }, [
      el('header', { className: 'bench-header' }, [
        el('h1', { textContent: 'Stress test' }),
        close,
      ]),
      picker(
        'Pack',
        data.packs.map((pack) => ({ label: pack.name, value: pack.id })),
        () => choice.pack,
        (value) => (choice.pack = value),
      ),
      picker(
        'Copies of everything',
        data.scales.map((scale) => ({ label: `${String(scale)}×`, value: scale })),
        () => choice.scale,
        (value) => (choice.scale = value),
      ),
      picker(
        'Shadows',
        onOff,
        () => choice.shadows,
        (value) => (choice.shadows = value),
      ),
      picker(
        'Physics',
        onOff,
        () => choice.physics,
        (value) => (choice.physics = value),
      ),
      picker(
        'Materials',
        [
          { label: 'As made', value: false },
          { label: 'Matte', value: true },
        ],
        () => choice.matte,
        (value) => (choice.matte = value),
      ),
      picker(
        'Pixel ratio',
        data.pixelRatios.map((ratio) => ({
          label: pixelRatioLabel(ratio, device, most),
          value: ratio,
        })),
        () => choice.pixelRatio,
        (value) => (choice.pixelRatio = value),
      ),
      el('div', { className: 'bench-row' }, [runButton, runAllButton]),
      this.#status,
      el('div', { className: 'bench-results' }, [
        el('table', {}, [
          el('thead', {}, [
            el(
              'tr',
              {},
              [
                '#',
                'Pack',
                '×',
                'Shad.',
                'PR',
                'Note',
                'FPS med',
                '5% low',
                '1% low',
                'Worst ms',
                'CPU ms',
                'Phys ms',
                'Calls',
                'Tris k',
                'Tex MB',
                'Load s',
              ].map((text) => el('th', { textContent: text })),
            ),
          ]),
          this.#table,
        ]),
      ]),
      el('p', { className: 'bench-device' }),
      caveat,
    ]);
  }

  #showDevice(): void {
    const line = this.#panel.querySelector('.bench-device');
    if (!line) return;
    const device = this.#device;
    const canvas = this.#renderer.domElement;
    line.textContent =
      `${this.#deps.buildLabel} · GPU: ${device.gpu} · devicePixelRatio ${String(device.devicePixelRatio)}` +
      ` · canvas ${String(canvas.width)}×${String(canvas.height)} · ${device.webgl} · ${device.userAgent}`;
  }

  /** Whether Stop was tapped (read through here, as it changes while a run is awaited). */
  #stopping(): boolean {
    return this.#stop;
  }

  #say(text: string): void {
    this.#status.textContent = text;
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#stage;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  // Runs

  async #runSet(runs: RunSettings[], kind: 'single' | 'all'): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#stop = false;
    this.#root.dataset.benchState = 'running';
    this.#panel.hidden = true;
    this.#hud.hidden = false;
    const started = performance.now();
    if (kind === 'all') {
      this.#deps.logger.log('bench.runAll', { runs: runs.length, pixelRatio: runs[0]?.pixelRatio });
    }
    let done = 0;
    try {
      for (const [index, run] of runs.entries()) {
        if (this.#stopping()) break;
        const result = await this.#runOne(run, `${String(index + 1)}/${String(runs.length)}`);
        this.#runCount++;
        this.#addRow(this.#runCount, result);
        this.#deps.logger.log('bench.result', {
          run: index + 1,
          of: runs.length,
          set: kind,
          elapsedS: Math.round((performance.now() - started) / 100) / 10,
          build: this.#deps.buildLabel,
          ...result,
          device: { ...this.#device },
        });
        // Stored before the next run, in case a heavier one runs the phone out of memory.
        await this.#deps.logger.flush();
        done++;
        if (result.stopped) break;
      }
      const seconds = Math.round((performance.now() - started) / 1000);
      this.#say(
        `${String(done)} of ${String(runs.length)} run${runs.length === 1 ? '' : 's'} done in ${String(seconds)} s` +
          (this.#stopping() ? ' (stopped)' : '') +
          '. Logged as bench.result: send with Debug → Share logs.',
      );
      if (kind === 'all')
        this.#deps.logger.log('bench.runAllDone', { done, of: runs.length, seconds });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#say(`Run failed: ${message}`);
      this.#deps.logger.log('bench.error', {
        message,
        stack: error instanceof Error ? (error.stack ?? '') : '',
      });
    } finally {
      this.#busy = false;
      this.#stop = false;
      this.#renderer.setAnimationLoop(null);
      this.#hud.hidden = true;
      this.#panel.hidden = false;
      this.#root.dataset.benchState = 'done';
      this.#showDevice();
    }
  }

  async #runOne(run: RunSettings, label: string): Promise<BenchResult> {
    const data = this.#data;
    const pack = data.packs.find((candidate) => candidate.id === run.pack);
    if (!pack) throw new Error(`No pack "${run.pack}"`);
    const renderer = this.#renderer;
    const camera = this.#camera;
    const title = `${label} · ${pack.name} · ${String(run.scale)}×${run.shadows ? '' : ' · no shadows'}${run.physics ? '' : ' · no physics'}${run.matte ? ' · matte' : ''}`;
    this.#hudText.textContent = `${title} · loading…`;
    const pixelRatio = pixelRatioFor(
      run.pixelRatio,
      window.devicePixelRatio,
      data.renderer.maxPixelRatio,
    );
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = run.shadows;
    this.#resize();
    // Last run's scene is gone; clear the screen so its last frame doesn't show while loading.
    renderer.setClearColor(0x111111);
    renderer.clear();

    const loadStart = performance.now();
    const [built, physics] = await Promise.all([
      buildPackScene(pack, data, run),
      run.physics ? loadPhysics() : Promise.resolve(undefined),
    ]);
    const blasts = data.layout.copies.map(
      ([x, z]) =>
        [
          data.collapse.blastAt[0] + x,
          data.collapse.blastAt[1],
          data.collapse.blastAt[2] + z,
        ] as const,
    );
    const sim = physics
      ? new CollapseSim(
          physics,
          built.layout.pieces.filter((piece) => piece.collapse),
          data.collapse,
          blasts,
        )
      : undefined;
    const loadMs = performance.now() - loadStart;

    const { scene } = built;
    const place = (seconds: number) => {
      const view = cameraAt(data.camera, seconds);
      camera.position.set(...view.from);
      camera.lookAt(...view.look);
    };
    try {
      // Shaders compiled and textures uploaded before the clock starts: that's loading, not frames.
      const warmStart = performance.now();
      place(0);
      await renderer.compileAsync(scene, camera);
      for (let frame = 0; frame < data.warmupFrames; frame++) {
        if (this.#stop) break;
        renderer.render(scene, camera);
        this.#hudText.textContent = `${title} · warming up`;
        await nextFrame();
      }
      const warmMs = performance.now() - warmStart;

      const frameMs: number[] = [];
      const cpuMs: number[] = [];
      const physicsMs: number[] = [];
      const animationMs: number[] = [];
      const calls: number[] = [];
      const triangles: number[] = [];
      const speed = data.layout.characters.speed;
      let first: number | undefined;
      let last = 0;
      let shownAt = 0;
      let shownFrames = 0;
      let stopped = false;
      await new Promise<void>((resolve) => {
        renderer.setAnimationLoop((time) => {
          first ??= time;
          const seconds = (time - first) / 1000;
          if (last > 0) frameMs.push(time - last);
          const dt = last > 0 ? Math.min((time - last) / 1000, 0.1) : 0;
          last = time;
          const work = performance.now();
          place(seconds);
          const animating = performance.now();
          for (const character of built.characters) {
            if (character.placed.walk) {
              const at = walkerAt(character.placed, speed, seconds);
              character.root.position.set(at.x, 0, at.z);
              character.root.rotation.y = at.turn;
            }
            character.mixer.update(dt);
          }
          animationMs.push(performance.now() - animating);
          if (sim) {
            const stepping = performance.now();
            if (seconds >= data.collapse.at) {
              sim.collapse(data.layout.seed);
              sim.step(dt);
              const pose = this.#pose;
              built.falling.forEach((pivot, index) => {
                sim.pose(index, pose);
                pivot.position.set(pose.x, pose.y, pose.z);
                pivot.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
              });
              physicsMs.push(performance.now() - stepping);
            }
          }
          renderer.render(scene, camera);
          cpuMs.push(performance.now() - work);
          calls.push(renderer.info.render.calls);
          triangles.push(renderer.info.render.triangles);
          shownFrames++;
          if (time - shownAt > 250) {
            const fps = (shownFrames * 1000) / Math.max(time - shownAt, 1);
            this.#hudText.textContent = `${title} · ${seconds.toFixed(1)} s · ${String(Math.round(fps))} fps`;
            shownAt = time;
            shownFrames = 0;
          }
          if (this.#stop) stopped = true;
          if (seconds >= data.seconds || stopped) {
            renderer.setAnimationLoop(null);
            resolve();
          }
        });
      });
      const info = renderer.info;
      return {
        pack: pack.id,
        scale: run.scale,
        shadows: run.shadows,
        physics: run.physics,
        matte: run.matte,
        pixelRatio,
        pixelRatioChoice: run.pixelRatio,
        note: run.note,
        fps: frameStats(frameMs),
        cpuMs: timingStats(cpuMs),
        physicsMs: timingStats(physicsMs),
        animationMs: timingStats(animationMs),
        drawCalls: { median: median(calls), max: Math.max(0, ...calls) },
        triangles: { median: median(triangles), max: Math.max(0, ...triangles) },
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        textureMB: built.textureMB,
        geometryMB: built.geometryMB,
        loadMs: Math.round(loadMs),
        warmMs: Math.round(warmMs),
        heapMB: heapMB(),
        canvas: [renderer.domElement.width, renderer.domElement.height],
        scene: built.counts,
        bodiesMoving: sim?.moving() ?? 0,
        stopped,
      };
    } finally {
      sim?.free();
      built.dispose();
      renderer.renderLists.dispose();
    }
  }

  #addRow(index: number, result: BenchResult): void {
    const pack = this.#data.packs.find((candidate) => candidate.id === result.pack);
    const cells = [
      String(index),
      pack?.name ?? result.pack,
      `${String(result.scale)}×`,
      result.shadows ? 'on' : 'off',
      String(Math.round(result.pixelRatio * 100) / 100),
      [result.note, result.physics ? '' : 'no physics', result.matte && !result.note ? 'matte' : '']
        .filter(Boolean)
        .join(', '),
      String(result.fps.medianFps),
      String(result.fps.p5Fps),
      String(result.fps.low1Fps),
      String(result.fps.worstMs),
      String(result.cpuMs.median),
      String(result.physicsMs.median),
      String(result.drawCalls.median),
      String(Math.round(result.triangles.median / 1000)),
      String(result.textureMB),
      String(Math.round((result.loadMs + result.warmMs) / 100) / 10),
    ];
    this.#table.append(
      el(
        'tr',
        { dataset: { pack: result.pack } },
        cells.map((text) => el('td', { textContent: text })),
      ),
    );
  }

  #dispose(): void {
    this.#renderer.setAnimationLoop(null);
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
    this.#root.remove();
    this.#deps.logger.log('bench.close', { runs: this.#runCount });
    this.#close();
  }
}

/** Opens the stress test over `host`; resolves once it's closed. */
export async function openBench(host: HTMLElement, deps: BenchDeps): Promise<void> {
  const bench = new Bench(host, deps);
  await bench.closed;
}
