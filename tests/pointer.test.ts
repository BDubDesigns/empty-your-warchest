import { describe, expect, it } from 'vitest';
import { capturePointer, releasePointer, type PointerTarget } from '../src/app/pointer';

/** Stands in for an element: holds the pointers it captured; `live` are the ones still down. */
function element(live: number[]): PointerTarget & { held: Set<number> } {
  const held = new Set<number>();
  const gone = (id: number) => {
    if (!live.includes(id)) {
      throw new DOMException('No active pointer with the given id is found.', 'NotFoundError');
    }
  };
  return {
    held,
    setPointerCapture(id: number) {
      gone(id);
      held.add(id);
    },
    releasePointerCapture(id: number) {
      gone(id);
      held.delete(id);
    },
    hasPointerCapture(id: number) {
      return held.has(id);
    },
  };
}

describe('pointer capture', () => {
  it('captures a pointer that is still down', () => {
    const target = element([3]);
    expect(capturePointer(target, 3)).toBe(true);
    expect(target.held.has(3)).toBe(true);
  });

  it("says no, rather than throwing, for a pointer that's already gone", () => {
    const target = element([]);
    expect(() => capturePointer(target, 7)).not.toThrow();
    expect(capturePointer(target, 7)).toBe(false);
    expect(target.held.size).toBe(0);
  });

  it('releases a captured pointer', () => {
    const target = element([3]);
    capturePointer(target, 3);
    releasePointer(target, 3);
    expect(target.held.has(3)).toBe(false);
  });

  it('never throws releasing a pointer it never had, or one that has gone', () => {
    const target = element([3]);
    expect(() => {
      releasePointer(target, 9);
    }).not.toThrow();
    capturePointer(target, 3);
    // Gone since it was captured: the browser would throw on release.
    const lifted = { ...target, hasPointerCapture: () => true };
    lifted.releasePointerCapture = () => {
      throw new DOMException('No active pointer with the given id is found.', 'NotFoundError');
    };
    expect(() => {
      releasePointer(lifted, 3);
    }).not.toThrow();
  });
});
