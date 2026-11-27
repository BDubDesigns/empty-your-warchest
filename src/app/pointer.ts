/** What the pointer helpers need of an element (any DOM element has it). */
export type PointerTarget = Pick<
  Element,
  'setPointerCapture' | 'releasePointerCapture' | 'hasPointerCapture'
>;

/**
 * Captures a pointer to an element, if the browser still has it. Browsers throw ("No active
 * pointer with the given id") when the pointer has already gone by the time the handler runs:
 * lifted or cancelled (a system gesture, a second finger, a synthetic event). Then there's
 * nothing to follow, so the caller shouldn't start its gesture. Returns whether it captured.
 */
export function capturePointer(element: PointerTarget, pointerId: number): boolean {
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lets a captured pointer go, if the element still holds it. A pointer that's already gone (or
 * was never captured) is nothing to release, and never throws.
 */
export function releasePointer(element: PointerTarget, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Already gone: nothing held.
  }
}
