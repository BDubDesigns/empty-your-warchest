import * as THREE from 'three';
import type { ScreenView } from './screen';
import { theme } from './theme';
import { capturePointer } from './pointer';

/** Placeholder for the Attack Run's three.js view: a box you can spin by dragging. */
export class ThreeView implements ScreenView {
  readonly #element: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  readonly #scene = new THREE.Scene();
  readonly #box: THREE.Mesh;
  readonly #timer = new THREE.Timer();
  #spinSpeed = 0.6;
  #dragX: number | undefined;

  constructor(element: HTMLElement, hint: string) {
    this.#element = element;
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.append(this.#renderer.domElement);

    this.#scene.background = new THREE.Color(theme.bg);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x333322, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 5, 4);
    this.#scene.add(sun);
    this.#scene.add(new THREE.GridHelper(20, 20, theme.mutedHex, theme.gridHex));

    this.#box = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.4, 1.4),
      new THREE.MeshStandardMaterial({ color: theme.accentHex }),
    );
    this.#box.position.y = 1;
    this.#scene.add(this.#box);

    this.#camera.position.set(0, 3, 6);
    this.#camera.lookAt(0, 1, 0);

    const hintElement = document.createElement('div');
    hintElement.className = 'screen-hint';
    hintElement.textContent = hint;
    element.append(hintElement);

    this.#listenForDrag(this.#renderer.domElement);
    new ResizeObserver(() => {
      this.#resize();
    }).observe(element);
  }

  start(): void {
    this.#resize();
    this.#timer.reset();
    this.#renderer.setAnimationLoop((time) => {
      this.#tick(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
  }

  #tick(time: number): void {
    this.#timer.update(time);
    const dt = this.#timer.getDelta();
    if (this.#dragX === undefined) this.#spinSpeed += (0.6 - this.#spinSpeed) * Math.min(1, dt * 2);
    this.#box.rotation.y += this.#spinSpeed * dt;
    this.#box.rotation.x += 0.2 * dt;
    this.#renderer.render(this.#scene, this.#camera);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#element;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  #listenForDrag(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (event) => {
      if (!capturePointer(canvas, event.pointerId)) return;
      this.#dragX = event.clientX;
      this.#spinSpeed = 0;
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.#dragX === undefined) return;
      const dx = event.clientX - this.#dragX;
      this.#dragX = event.clientX;
      this.#box.rotation.y += dx * 0.01;
      this.#spinSpeed = dx * 0.6;
    });
    const release = (): void => {
      this.#dragX = undefined;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }
}
