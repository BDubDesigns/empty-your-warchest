/**
 * Colour maths for brewing, in OKLab (Björn Ottosson's perceptual colour space: L is lightness
 * 0–1, a runs green → red, b runs blue → yellow). Pure: no rendering.
 *
 * How a brew mixes: every drop in the pot adds its ingredient's colour, weighted by its strength,
 * and the pot's colour is the weighted average of them all in OKLab. Averaging in OKLab looks
 * right for a pot of pigments: two colours meet halfway as the eye sees it (sRGB averages go
 * grey and dark in the middle), and opposite colours (red and green) cancel toward a muddy brown,
 * as real dyes do. Water (light, weak) pulls the mix lighter; ash (dark grey) pulls it darker and,
 * having almost no colour of its own, duller.
 *
 * How close a brew is: the plain distance between two colours in OKLab (ΔE OK). About 0.02 is
 * the smallest difference most people notice side by side.
 */

/** A colour in OKLab. */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** sRGB (0–1 a channel, gamma encoded) to linear light. */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function toGamma(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** '#rrggbb' to its red, green and blue channels, 0–1. Throws on anything else. */
export function parseHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Not a #rrggbb colour: "${hex}"`);
  const value = parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** '#rrggbb' to OKLab. */
export function hexToLab(hex: string): Lab {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab to sRGB channels (0–1), clipped into the screen's range. */
export function labToRgb(lab: Lab): [number, number, number] {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((channel) => Math.min(Math.max(toGamma(Math.max(channel, 0)), 0), 1)) as [
    number,
    number,
    number,
  ];
}

/** OKLab to '#rrggbb'. */
export function labToHex(lab: Lab): string {
  return `#${labToRgb(lab)
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** How far apart two colours look: their distance in OKLab. */
export function labDistance(from: Lab, to: Lab): number {
  return Math.hypot(from.L - to.L, from.a - to.a, from.b - to.b);
}

/** One colour in a mix and how much it counts. */
export interface Part {
  color: Lab;
  weight: number;
}

/** The weighted average of colours in OKLab; undefined when nothing has any weight. */
export function mixLab(parts: readonly Part[]): Lab | undefined {
  let total = 0;
  const sum = { L: 0, a: 0, b: 0 };
  for (const { color, weight } of parts) {
    if (weight <= 0) continue;
    total += weight;
    sum.L += color.L * weight;
    sum.a += color.a * weight;
    sum.b += color.b * weight;
  }
  if (total <= 0) return undefined;
  return { L: sum.L / total, a: sum.a / total, b: sum.b / total };
}

/** Rounds a colour's numbers to 3 places, for logs. */
export function roundLab(lab: Lab): Lab {
  const r = (value: number) => Math.round(value * 1000) / 1000;
  return { L: r(lab.L), a: r(lab.a), b: r(lab.b) };
}
