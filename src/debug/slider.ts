import { capturePointer, releasePointer } from '../app/pointer';
import { dragIntent, draggedValue, valueAt, type SliderDragTuning } from './sliderDrag';

// A range input that a scroll can't change. Chrome on Android moves a native slider's thumb as
// soon as a finger touches it, so swiping the debug menu up or down past a slider changed it. Here
// the input itself takes no pointer events (it still takes focus and the arrow keys); the track
// round it does, with `touch-action: pan-y` so the browser scrolls a vertical swipe as on the rest
// of the menu. A touch only drags the slider once it has gone clearly sideways (see sliderDrag),
// and then from where the value was, so a tap never makes it jump. A mouse works as on a native
// slider: press to jump, drag to slide.

/**
 * Wraps `input` (a range input) in a track that handles touches and the mouse as above. Changes
 * come out of the input as its usual `input` events while dragging and one `change` at the end.
 */
export function touchSlider(input: HTMLInputElement, tuning: SliderDragTuning): HTMLElement {
  const track = document.createElement('div');
  track.className = 'debug-slider';
  track.append(input);

  let drag:
    | {
        pointer: number;
        mouse: boolean;
        x: number;
        y: number;
        start: number;
        dragging: boolean;
        changed: boolean;
      }
    | undefined;
  const range = () => ({
    min: Number(input.min),
    max: Number(input.max),
    step: Number(input.step),
  });
  const set = (value: number): void => {
    if (!drag || Number(input.value) === value) return;
    input.value = String(value);
    drag.changed = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const end = (event: PointerEvent, keep: boolean): void => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { changed, start } = drag;
    // A scroll the browser took over after all: put the value back as it was.
    if (!keep && changed) set(start);
    drag = undefined;
    releasePointer(track, event.pointerId);
    if (changed) input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  track.addEventListener('pointerdown', (event) => {
    if (drag || !event.isPrimary || event.button !== 0 || input.disabled) return;
    const mouse = event.pointerType === 'mouse';
    drag = {
      pointer: event.pointerId,
      mouse,
      x: event.clientX,
      y: event.clientY,
      start: Number(input.value),
      dragging: mouse,
      changed: false,
    };
    if (mouse) {
      // No text selection while dragging; focus as a native slider takes it, for the arrow keys.
      event.preventDefault();
      input.focus();
      // The mouse button's already up (or the pointer's gone): no drag to follow.
      if (!capturePointer(track, event.pointerId)) {
        drag = undefined;
        return;
      }
      const box = input.getBoundingClientRect();
      set(valueAt(event.clientX - box.left, box.width, range()));
    }
  });
  track.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.x;
    if (!drag.dragging) {
      const intent = dragIntent(dx, event.clientY - drag.y, tuning);
      if (intent === 'undecided') return;
      if (intent === 'scroll') {
        drag = undefined;
        return;
      }
      // The finger's already gone: leave the value as it was.
      if (!capturePointer(track, event.pointerId)) {
        drag = undefined;
        return;
      }
      drag.dragging = true;
    }
    const box = input.getBoundingClientRect();
    set(
      drag.mouse
        ? valueAt(event.clientX - box.left, box.width, range())
        : draggedValue(drag.start, dx, box.width, range()),
    );
  });
  track.addEventListener('pointerup', (event) => {
    end(event, true);
  });
  track.addEventListener('pointercancel', (event) => {
    end(event, false);
  });
  return track;
}
