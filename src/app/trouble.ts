import type { EventLogger } from '../core';

// What would otherwise fail silently on a phone, logged through the shared logger: uncaught errors,
// promises that failed with nobody to catch them, files (images, models, sounds) that didn't load,
// and WebGL contexts the browser took away or gave back. And the screens' side of the contexts:
// each 3D screen gives its context back while it's hidden, because phones allow only a few live
// ones (Android Chrome about 8) and take the oldest, the camp's, when there are too many.

/** Marks a canvas whose context the game gave back itself, so its loss isn't logged as trouble. */
const RELEASED = 'data-released';

/** The screen on show, for a log entry. */
function screenNow(): string {
  return document.body.dataset.screen ?? 'none';
}

/** Where a canvas sits, to tell the screens' canvases apart in a log entry. */
function canvasName(canvas: HTMLCanvasElement): string {
  const screen = canvas.closest('[id^="screen-"]');
  return [screen?.id, canvas.className].filter(Boolean).join(' ') || 'canvas';
}

function described(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? '' };
  return { message: String(error), stack: '' };
}

/** Every live WebGL context the game has made, so a log entry can say how many there are. */
const contexts = new Set<WebGLRenderingContext | WebGL2RenderingContext>();

/** How many of the game's WebGL contexts are live (on the page and not lost). */
export function liveContexts(): number {
  let live = 0;
  for (const gl of contexts) {
    const canvas = gl.canvas;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) contexts.delete(gl);
    else if (!gl.isContextLost()) live++;
  }
  return live;
}

/** Starts logging the trouble above. Call once, as soon as the logger is open. */
export function watchForTrouble(logger: EventLogger): void {
  window.addEventListener(
    'error',
    (event: Event) => {
      if (event instanceof ErrorEvent) {
        const error = event.error as unknown;
        logger.log('app.error', {
          message: event.message,
          stack: error instanceof Error ? (error.stack ?? '') : '',
          source: `${event.filename}:${String(event.lineno)}:${String(event.colno)}`,
          screen: screenNow(),
        });
        return;
      }
      // A file that didn't load: the error is on its element, caught here on the way down.
      const target = event.target;
      if (target instanceof HTMLElement) {
        logger.log('app.loadError', {
          element: target.tagName.toLowerCase(),
          source: target.getAttribute('src') ?? '',
          screen: screenNow(),
        });
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) => {
    logger.log('app.rejection', { ...described(event.reason), screen: screenNow() });
  });
  // Context events don't bubble, but a listener on the window sees them on the way down.
  window.addEventListener(
    'webglcontextlost',
    (event) => {
      const canvas = event.target;
      if (!(canvas instanceof HTMLCanvasElement) || canvas.hasAttribute(RELEASED)) return;
      logger.log('gfx.contextLost', {
        canvas: canvasName(canvas),
        screen: screenNow(),
        live: liveContexts(),
      });
    },
    true,
  );
  window.addEventListener(
    'webglcontextrestored',
    (event) => {
      const canvas = event.target;
      if (!(canvas instanceof HTMLCanvasElement)) return;
      if (canvas.hasAttribute(RELEASED)) {
        canvas.removeAttribute(RELEASED);
        return;
      }
      logger.log('gfx.contextRestored', {
        canvas: canvasName(canvas),
        screen: screenNow(),
        live: liveContexts(),
      });
    },
    true,
  );
}

/** The parts of a three.js renderer this needs (so the app shell needn't load three.js). */
export interface ContextHolder {
  readonly domElement: HTMLCanvasElement;
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
  forceContextLoss(): void;
  forceContextRestore(): void;
  readonly info: { readonly memory: { geometries: number; textures: number } };
}

/** Notes a context made elsewhere (the camp's, by Phaser), so `liveContexts` counts it. */
export function noteContext(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
  contexts.add(gl);
}

/**
 * Gives a hidden screen's context back to the browser. Its scene stays in memory; the renderer
 * uploads it again once the context is back. Logs what the screen had on the graphics card, so a
 * screen that keeps adding to it shows in the playtest logs.
 */
export function releaseContext(renderer: ContextHolder, logger: EventLogger, screen: string): void {
  const gl = renderer.getContext();
  contexts.add(gl);
  if (gl.isContextLost()) return;
  const { geometries, textures } = renderer.info.memory;
  logger.log('gfx.release', { screen, geometries, textures, live: liveContexts() - 1 });
  renderer.domElement.setAttribute(RELEASED, '');
  renderer.forceContextLoss();
}

/** Asks for a screen's context back as it's shown. It draws again a moment later. */
export function restoreContext(renderer: ContextHolder): void {
  const gl = renderer.getContext();
  contexts.add(gl);
  if (gl.isContextLost()) renderer.forceContextRestore();
}
