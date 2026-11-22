/** A full-viewport screen the app shell can switch to. */
export interface Screen {
  /** Runs once, before the first `enter`. May lazy-load the screen's code. */
  mount(): Promise<void>;
  /** Show the screen and resume its loop. */
  enter(): void;
  /** Pause the screen's loop and hide it. The screen stays alive for the next `enter`. */
  leave(): void;
}

/** The running part of a screen: a Phaser game or a three.js renderer. */
export interface ScreenView {
  start(): void;
  stop(): void;
}

/**
 * Wraps a view that is loaded on first use, so each renderer's code is only
 * downloaded when its screen is first opened.
 */
export function lazyScreen(element: HTMLElement, load: () => Promise<ScreenView>): Screen {
  let view: ScreenView | undefined;
  return {
    async mount() {
      // The view is created while visible so it can measure its container.
      element.hidden = false;
      view = await load();
    },
    enter() {
      element.hidden = false;
      view?.start();
    },
    leave() {
      view?.stop();
      element.hidden = true;
    },
  };
}
