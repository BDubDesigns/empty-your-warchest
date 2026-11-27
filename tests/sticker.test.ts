import { describe, expect, it } from 'vitest';
import { stickerOutline } from '../src/app/sticker';

/** A `size` square picture, clear but for an opaque red square `from`–`to` (inclusive). */
function picture(size: number, from: number, to: number) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = from; y <= to; y++) {
    for (let x = from; x <= to; x++) pixels.set([200, 30, 20, 255], (y * size + x) * 4);
  }
  return pixels;
}

describe('the sticker outline', () => {
  const size = 32;
  const out = stickerOutline(picture(size, 12, 19), size, size, 3, 3);
  const at = (x: number, y: number) => [...out.slice((y * size + x) * 4, (y * size + x) * 4 + 4)];

  it('leaves the picture itself alone', () => {
    expect(at(15, 15)).toEqual([200, 30, 20, 255]);
    expect(at(12, 12)).toEqual([200, 30, 20, 255]);
  });

  it('hugs the shape with black, then white, then nothing', () => {
    // Straight out from the right edge (x 19): 1–3 px black, 4–6 px white, past that clear.
    expect(at(21, 15)).toEqual([0, 0, 0, 255]);
    expect(at(25, 15)).toEqual([255, 255, 255, 255]);
    expect(at(27, 15)[3]).toBe(0);
    // Round the corner it follows the distance, not a box: a diagonal 6 px out is clear.
    expect(at(24, 24)[3]).toBe(0);
    expect(at(1, 1)[3]).toBe(0);
  });

  it('draws no outline with no widths, and nothing round an empty picture', () => {
    expect([...stickerOutline(picture(size, 12, 19), size, size, 0, 0)]).toEqual([
      ...picture(size, 12, 19),
    ]);
    const empty = stickerOutline(new Uint8ClampedArray(size * size * 4), size, size, 3, 3);
    expect(empty.every((value) => value === 0)).toBe(true);
  });
});
