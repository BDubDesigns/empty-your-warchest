/**
 * Captures a pointer to an element, if the browser still has it. Browsers throw ("No active
 * pointer with the given id") when the pointer has already gone by the time the handler runs:
 * lifted or cancelled (a system gesture, a second finger, a synthetic event). Then there's
 * nothing to follow, so the caller shouldn't start its gesture. Returns whether it captured.
 */
export function capturePointer(element: Element, pointerId: number): boolean {
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}
