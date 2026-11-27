import type { Brewing } from '../../../data';
import type { Lab } from './color';

/**
 * Which way a brew is off, without any rendering. The star distance adds lightness and colour
 * together, so a pot can sit dead centre on the colour map (its hue and chroma right) and still
 * lose a star to lightness alone. This splits the error so the map and the end card can say
 * which: too light or too dark, and which way the colour leans ("a touch too red").
 */

/** A shelf entry as far as advice goes: its colour, lightness and the way it pulls a colour. */
export interface AdviceEntry {
  id: string;
  color: Lab;
  tint?: string | undefined;
}

export interface OffBy {
  /** Lightness off: positive is too light. */
  light: number;
  /** Too light or too dark, or undefined when lightness is spot on. */
  lightWay: 'light' | 'dark' | undefined;
  lightMuch: boolean;
  /** How far the colour (hue and chroma, OKLab a and b) is off. */
  colour: number;
  /** The tint the colour leans toward ("red"), or undefined when it's spot on. */
  tint: string | undefined;
  colourMuch: boolean;
  /** The tinted shelf entry that pulls the colour back toward the target. */
  fix: string | undefined;
  /** Lightness is the big part of the error: the map badges the pot too light or too dark. */
  lightBadge: boolean;
}

/** How `pot` is off from `target`, split into lightness and colour. */
export function offBy(
  rules: Pick<Brewing, 'advice'>,
  shelf: readonly AdviceEntry[],
  pot: Lab,
  target: Lab,
): OffBy {
  const { spotOn, much, lightShare } = rules.advice;
  const light = pot.L - target.L;
  const da = pot.a - target.a;
  const db = pot.b - target.b;
  const colour = Math.hypot(da, db);
  const lightWay = Math.abs(light) <= spotOn ? undefined : light > 0 ? 'light' : 'dark';
  // The tint the error leans toward: the tinted entry whose direction from the target lines up
  // best with it. And the one that pulls it back: the tinted entry a drop of which moves the pot
  // most nearly straight back toward the target.
  let tint: string | undefined;
  let fix: string | undefined;
  if (colour > spotOn) {
    let lean = -Infinity;
    let back = -Infinity;
    const cosine = (x: number, y: number, along: { a: number; b: number }) => {
      const length = Math.hypot(x, y);
      return length > 0 ? (x * along.a + y * along.b) / (length * colour) : -Infinity;
    };
    for (const entry of shelf) {
      if (!entry.tint) continue;
      const toward = cosine(entry.color.a - target.a, entry.color.b - target.b, { a: da, b: db });
      if (toward > lean) [lean, tint] = [toward, entry.tint];
      const pull = cosine(entry.color.a - pot.a, entry.color.b - pot.b, { a: -da, b: -db });
      if (pull > back) [back, fix] = [pull, entry.id];
    }
  }
  const squared = light * light + colour * colour;
  return {
    light,
    lightWay,
    lightMuch: Math.abs(light) > much,
    colour,
    tint,
    colourMuch: colour > much,
    fix,
    lightBadge: lightWay !== undefined && squared > 0 && (light * light) / squared >= lightShare,
  };
}

/**
 * The end card's line for a brew `off` like this: which way, then what fixes it, e.g. "Colour
 * spot on, a shade too light. Ash darkens, water lightens." The darkener and lightener are the
 * darkest and lightest things on the shelf.
 */
export function adviceText(
  off: OffBy,
  shelf: readonly AdviceEntry[],
  name: (id: string) => string,
): string {
  const colourPart = off.tint
    ? `${off.colourMuch ? 'too' : 'a touch too'} ${off.tint}`
    : 'colour spot on';
  const lightPart = off.lightWay
    ? `${off.lightMuch ? 'much' : 'a shade'} too ${off.lightWay}`
    : 'lightness spot on';
  const fixes: string[] = [];
  if (off.tint && off.fix) fixes.push(`${name(off.fix)} pulls the colour back`);
  if (off.lightWay && shelf.length > 0) {
    const byLight = [...shelf].sort((one, other) => one.color.L - other.color.L);
    const darkest = byLight[0];
    const lightest = byLight[byLight.length - 1];
    if (darkest && lightest && darkest !== lightest) {
      fixes.push(`${name(darkest.id)} darkens, ${name(lightest.id).toLowerCase()} lightens`);
    }
  }
  const sentences = [`${colourPart}, ${lightPart}`, ...fixes].map(
    (sentence) => `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`,
  );
  return sentences.join(' ');
}
