/**
 * A sticker outline round a picture's shape: `outline` px of black hugging the silhouette, then
 * `halo` px of white outside that, so an icon reads on any background. Works on straight-alpha
 * RGBA pixels (as a canvas's ImageData holds them) and returns new pixels; the picture needs that
 * much clear margin round its shape. Pure: no DOM.
 *
 * How: the shape is every pixel at least half opaque. Each pixel outside it gets its distance to
 * the shape's edge (marked out from the edge pixels only, so it stays cheap), and the two bands are
 * laid under the picture by that distance, with a pixel of soft edge each.
 */
export function stickerOutline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  outline: number,
  halo: number,
): Uint8ClampedArray {
  const size = width * height;
  const inside = new Uint8Array(size);
  for (let at = 0; at < size; at++) inside[at] = (pixels[at * 4 + 3] ?? 0) >= 128 ? 1 : 0;
  const reach = outline + halo + 1;
  const near = new Float32Array(size).fill(Infinity);
  // The offsets round a pixel within reach, and how far each is.
  const kernel: [number, number, number][] = [];
  const span = Math.ceil(reach);
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance <= reach) kernel.push([dx, dy, distance]);
    }
  }
  const isInside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInside(x, y)) continue;
      // An edge pixel: inside, with a neighbour outside.
      const edge =
        !isInside(x - 1, y) || !isInside(x + 1, y) || !isInside(x, y - 1) || !isInside(x, y + 1);
      if (!edge) continue;
      for (const [dx, dy, distance] of kernel) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const at = ty * width + tx;
        // From the edge pixel's centre to the shape's edge is half a pixel.
        const fromEdge = Math.max(distance - 0.5, 0);
        if (fromEdge < (near[at] ?? Infinity)) near[at] = fromEdge;
      }
    }
  }
  const out = new Uint8ClampedArray(pixels.length);
  const cover = (band: number, distance: number) => Math.min(Math.max(band - distance + 0.5, 0), 1);
  for (let at = 0; at < size; at++) {
    const distance = inside[at] === 1 ? 0 : (near[at] ?? Infinity);
    // White under black under the picture (straight alpha "over", one layer at a time).
    const white = cover(outline + halo, distance);
    const black = cover(outline, distance);
    let alpha = black + white * (1 - black);
    const value = alpha > 0 ? (255 * white * (1 - black)) / alpha : 0;
    const i = at * 4;
    const own = (pixels[i + 3] ?? 0) / 255;
    const under = alpha;
    alpha = own + under * (1 - own);
    for (let channel = 0; channel < 3; channel++) {
      const mine = pixels[i + channel] ?? 0;
      out[i + channel] = alpha > 0 ? (mine * own + value * under * (1 - own)) / alpha : 0;
    }
    out[i + 3] = alpha * 255;
  }
  return out;
}
