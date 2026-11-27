import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { dragIntent, draggedValue, snapToSlider, valueAt } from '../src/debug/sliderDrag';

const tuning = loadGameData().tuning.debugSliders;
const range = { min: 0, max: 2, step: 0.05 };

describe('debug slider touches', () => {
  it('waits for the first few pixels before deciding', () => {
    expect(dragIntent(0, 0, tuning)).toBe('undecided');
    const short = tuning.slopPx * 0.7;
    expect(dragIntent(short, 0, tuning)).toBe('undecided');
    expect(dragIntent(0, -short, tuning)).toBe('undecided');
  });

  it('scrolls a vertical swipe, and a slanted one', () => {
    const far = tuning.slopPx * 3;
    expect(dragIntent(0, far, tuning)).toBe('scroll');
    expect(dragIntent(2, -far, tuning)).toBe('scroll');
    // Exactly diagonal isn't clearly sideways, so it scrolls.
    expect(dragIntent(far, far, tuning)).toBe('scroll');
    expect(dragIntent(-far, far, tuning)).toBe('scroll');
  });

  it('drags on a clearly sideways move, either way', () => {
    const far = tuning.slopPx * 3;
    expect(dragIntent(far, 0, tuning)).toBe('drag');
    expect(dragIntent(-far, 3, tuning)).toBe('drag');
    expect(dragIntent(far, far / (tuning.sideways * 1.1), tuning)).toBe('drag');
  });

  it('drags from where the value was, so a tap or the first touch never jumps it', () => {
    expect(draggedValue(0.5, 0, 200, range)).toBe(0.5);
    // Half the track is half the range.
    expect(draggedValue(0.5, 100, 200, range)).toBe(1.5);
    expect(draggedValue(0.5, -50, 200, range)).toBe(0);
    expect(draggedValue(0.5, 1000, 200, range)).toBe(2);
    expect(draggedValue(0.5, 30, 0, range)).toBe(0.5);
  });

  it('snaps to the steps without floating point crumbs, and clamps', () => {
    expect(snapToSlider(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapToSlider(0.37, range)).toBe(0.35);
    expect(snapToSlider(-1, range)).toBe(0);
    expect(snapToSlider(7, { min: 1, max: 9, step: 2 })).toBe(7);
    expect(snapToSlider(6.2, { min: 1, max: 9, step: 2 })).toBe(7);
  });

  it('puts a mouse press where it lands, as a native slider does', () => {
    expect(valueAt(0, 200, range)).toBe(0);
    expect(valueAt(50, 200, range)).toBe(0.5);
    expect(valueAt(260, 200, range)).toBe(2);
  });
});
