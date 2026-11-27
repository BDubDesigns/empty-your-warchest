import { describe, expect, it } from 'vitest';
import {
  BrewRound,
  WATER,
  adviceText,
  labDistance,
  offBy,
  shelfOf,
  starsFor,
} from '../src/stations/brewing';
import { data, testLogger } from './helpers';

const rules = data.brewing;
const potion = rules.potions[0];
if (!potion) throw new Error('No potion in data');
const shelf = shelfOf(rules);
const names: Record<string, string> = {
  red_cap: 'Red cap',
  moss: 'Moss',
  woad: 'Woad',
  ash: 'Ash',
  [WATER]: 'Water',
};
const name = (id: string) => names[id] ?? id;
const target = { L: 0.517, a: 0.053, b: -0.034 };
const { spotOn, much } = rules.advice;

function brew(seed: number) {
  const { logger } = testLogger();
  const round = new BrewRound(
    rules,
    potion as NonNullable<typeof potion>,
    { logger, feel: () => rules.feel, stock: () => 20, take: () => undefined, bank: (p) => p },
    seed,
  );
  return { round, logger };
}

describe('which way a brew is off', () => {
  it('says spot on when it is', () => {
    const off = offBy(rules, shelf, target, target);
    expect(off).toMatchObject({ lightWay: undefined, tint: undefined, lightBadge: false });
    expect(adviceText(off, shelf, name)).toBe('Colour spot on, lightness spot on.');
  });

  it('splits lightness from colour: too light, too dark, a shade or much', () => {
    const lighter = offBy(rules, shelf, { ...target, L: target.L + spotOn * 2 }, target);
    expect(lighter).toMatchObject({ lightWay: 'light', lightMuch: false, tint: undefined });
    expect(lighter.light).toBeCloseTo(spotOn * 2, 12);
    const darker = offBy(rules, shelf, { ...target, L: target.L - much * 1.5 }, target);
    expect(darker).toMatchObject({ lightWay: 'dark', lightMuch: true });
    expect(adviceText(darker, shelf, name)).toBe(
      'Colour spot on, much too dark. Ash darkens, water lightens.',
    );
    // Within spot on: no word about it.
    const near = offBy(rules, shelf, { ...target, L: target.L + spotOn / 2 }, target);
    expect(near.lightWay).toBeUndefined();
  });

  it('names the tint the colour leans toward, and what pulls it back', () => {
    const red = shelf.find((entry) => entry.id === 'red_cap')?.color;
    const blue = shelf.find((entry) => entry.id === 'woad')?.color;
    if (!red || !blue) throw new Error('No red cap or woad on the shelf');
    // A little of the way toward red cap, lightness kept.
    const toward = (color: typeof red, share: number) => ({
      L: target.L,
      a: target.a + (color.a - target.a) * share,
      b: target.b + (color.b - target.b) * share,
    });
    const redder = offBy(rules, shelf, toward(red, 0.1), target);
    expect(redder).toMatchObject({ tint: 'red', fix: 'woad', lightWay: undefined });
    expect(redder.colourMuch).toBe(redder.colour > much);
    expect(adviceText(redder, shelf, name)).toMatch(
      /^(A touch too|Too) red, lightness spot on\. Woad pulls the colour back\.$/,
    );
    const bluer = offBy(rules, shelf, toward(blue, 0.15), target);
    expect(bluer.tint).toBe('blue');
    // Against blue on the map: the yellow-green moss straight across, or red cap round the hue.
    expect(['moss', 'red_cap']).toContain(bluer.fix);
    // Toward grey (the middle of the map): too grey.
    const greyer = offBy(
      rules,
      shelf,
      { L: target.L, a: target.a * 0.5, b: target.b * 0.5 },
      target,
    );
    expect(greyer.tint).toBe('grey');
  });

  it('never names water (it has no tint)', () => {
    const water = shelf.find((entry) => entry.id === WATER);
    expect(water?.tint).toBeUndefined();
    for (const share of [0.05, 0.2, 0.5]) {
      const color = water?.color ?? target;
      const off = offBy(
        rules,
        shelf,
        {
          L: target.L,
          a: target.a + (color.a - target.a) * share,
          b: target.b + (color.b - target.b) * share,
        },
        target,
      );
      expect(off.fix).not.toBe(WATER);
    }
  });

  it('badges lightness when it is most of the error, not when colour is', () => {
    const allLight = offBy(rules, shelf, { ...target, L: target.L + 0.03 }, target);
    expect(allLight.lightBadge).toBe(true);
    const mostlyColour = offBy(
      rules,
      shelf,
      { L: target.L + 0.015, a: target.a + 0.04, b: target.b },
      target,
    );
    expect(mostlyColour.lightWay).toBe('light');
    expect(mostlyColour.lightBadge).toBe(false);
  });

  it('reads Brandon’s brew: dead centre on the map, but a shade too light after the water', () => {
    // His brew (seed 495627925): woad, red cap, woad was 3 stars; water made it 2, with the
    // colour still dead centre on the map. Only the lightness was off.
    const { round } = brew(495627925);
    expect(labDistance(round.target, target)).toBeLessThan(0.001);
    for (const id of ['woad', 'red_cap', 'woad']) round.add(id);
    // 3 stars, and a shade too dark (the map only badges it once it costs a star).
    expect(round.ring).toBe(3);
    expect(round.off).toMatchObject({ lightWay: 'dark', lightBadge: true });
    round.add(WATER);
    const pot = round.mixed;
    const off = round.off;
    if (!pot || !off) throw new Error('Nothing in the pot');
    expect(starsFor(rules, labDistance(pot, round.target))).toBe(2);
    expect(off).toMatchObject({ lightWay: 'light', lightMuch: false, tint: undefined });
    expect(off.colour).toBeLessThan(spotOn);
    expect(off.lightBadge).toBe(true);
    expect(adviceText(off, round.shelf, name)).toBe(
      'Colour spot on, a shade too light. Ash darkens, water lightens.',
    );
  });

  it('follows the pot, and logs which way it was off at bottling', async () => {
    const { round, logger } = brew(5);
    expect(round.off).toBeUndefined();
    round.add('woad');
    round.add('red_cap');
    for (let i = 0; i < 4; i++) round.add(WATER);
    const off = round.off;
    expect(off?.lightWay).toBe('light');
    round.bottle();
    const bottle = (await logger.readAll()).find((event) => event.type === 'brewing.bottle');
    expect(bottle?.data?.off).toMatchObject({ lightWay: 'light' });
  });
});
