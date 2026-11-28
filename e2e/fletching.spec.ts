import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { XpCurve } from '../src/core/xp';
import { fletching } from '../src/data/fletching';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';
import { tuning } from '../src/data/tuning';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const bench = stations.find((station) => station.mechanic === 'fletching');

/** Opens the fletcher's bench with these in the warchest, at this Fletching level. */
async function openBench(page: Page, stock: Record<string, number>, level = 1) {
  if (!bench) throw new Error('No fletching station in data');
  // Every skill in data, so the save fits the data and isn't discarded.
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  xp.fletching = new XpCurve(tuning.xpCurve).xpForLevel(level);
  await page.addInitScript(
    ({ stock, xp }) => {
      const inventory = Object.entries(stock)
        .filter(([, count]) => count > 0)
        .map(([item, count]) => ({ item, count }));
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: { inventory, skills: xp, lastSeenAt: Date.now(), done: ['tutorial.woodcutting'] },
        }),
      );
    },
    { stock, xp },
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(
    camp.x + camp.width * bench.camp.x,
    camp.y + camp.height * bench.camp.y,
  );
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${bench.id}`);
}

/** Drags the shaft down into the tar and holds it there until the tar's at `level`, then lifts. */
async function dip(page: Page, level: number) {
  const box = await page.locator('.fl-canvas').boundingBox();
  if (!box) throw new Error('No fletching canvas');
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.5;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 5; step++) {
    await page.waitForTimeout(20);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + step * 16 }],
    });
  }
  const screen = page.locator('#screen-fletching3d');
  await expect(screen).toHaveAttribute('data-step', 'dip');
  await page.waitForFunction(
    (level) =>
      Number(document.querySelector<HTMLElement>('#screen-fletching3d')?.dataset.tar ?? 0) >= level,
    level,
  );
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(screen).toHaveAttribute('data-step', 'feathers');
}

/** Waits for the round's end card, then starts the next round from it. */
async function again(page: Page) {
  await expect(page.locator('.fl-card')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Fletch again' }).tap();
  await expect(page.locator('#screen-fletching3d')).toHaveAttribute('data-step', 'shaft');
}

interface Logged {
  type: string;
  data?: Record<string, unknown>;
}

test('picks a batch, makes it with one set of beats each way, and pours it all in', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // A bench of 3 at a time.
  const size = fletching.batch.sizes.find((entry) => entry.arrows === 3);
  if (!size) throw new Error('No 3-arrow bench in data');
  await openBench(page, { stave: 9, feather: 60 }, size.level);
  await expect(page.locator('body')).toHaveAttribute('data-fletching', 'make', { timeout: 20_000 });
  const screen = page.locator('#screen-fletching3d');
  await expect(screen).toHaveAttribute('data-step', 'shaft');

  // The picker: 1 to 3 open (the biggest picked), and the next size locked.
  const radios = page.locator('.fl-sizes [role=radio]');
  await expect(radios).toHaveCount(4);
  await expect(page.locator('.fl-size[data-size="3"]')).toHaveAttribute('aria-checked', 'true');
  await expect(screen).toHaveAttribute('data-arrows', '3');
  await page.locator('.fl-size[data-size="2"]').tap();
  await expect(screen).toHaveAttribute('data-arrows', '2');
  await expect(page.locator('.fl-status')).toContainText('Making 2');

  // Careful: tar, then three feathers tapped on as the shaft turns, for the whole batch.
  await dip(page, 0.5);
  await expect(page.locator('.fl-sizes')).toBeHidden();
  const box = await page.locator('.fl-canvas').boundingBox();
  if (!box) throw new Error('No fletching canvas');
  for (let feather = 0; feather < 3; feather++) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.45);
    await page.waitForTimeout(250);
  }
  await expect(screen).toHaveAttribute('data-made-count', '2');
  // The count, big, on the card: one shaft shown, but the whole batch made.
  await expect(page.locator('.fl-card .fm-card-title')).toHaveText(/^×2 /, { timeout: 10_000 });

  // The bucket: tar, then shove it in. Always dusters. (The size picked is kept; a 3-star
  // round above would have doubled it.)
  await again(page);
  await dip(page, 0.3);
  await page.getByRole('button', { name: /Bucket/ }).tap();
  await expect(screen).toHaveAttribute('data-made', 'duster');
  await expect(page.locator('.fl-card .fm-card-title')).toContainText('duster', {
    timeout: 10_000,
  });

  // Bare: no tar, no feathers.
  await again(page);
  await page.getByRole('button', { name: 'Bare' }).tap();
  await expect(screen).toHaveAttribute('data-made', 'bare');
  await expect(page.locator('.fl-card')).toBeVisible({ timeout: 10_000 });

  // The logs have each round's batch, streak and beats, and what it used.
  await page.locator('.fl-card').getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download logs' }).tap(),
  ]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as { events: Logged[] };
  const starts = exported.events.filter((event) => event.type === 'fletching.roundStart');
  // The first round started at 3, then again at the 2 picked.
  expect(starts[0]?.data).toMatchObject({ size: 3, streak: 1, arrows: 3, staves: 9 });
  expect(starts[1]?.data).toMatchObject({ size: 2, streak: 1, arrows: 2 });
  expect(starts[1]?.data?.feel).toBeDefined();
  const ends = exported.events.filter((event) => event.type === 'fletching.roundEnd');
  expect(ends.map((event) => event.data?.way)).toEqual(['careful', 'bucket', 'bare']);
  expect(ends[0]?.data?.taps).toHaveLength(3);
  expect(typeof ends[0]?.data?.tar).toBe('number');
  for (const end of ends) {
    const arrows = Number(end.data?.arrows);
    expect(end.data?.staves).toBe(Math.ceil(arrows / fletching.arrowsPerStave));
    expect(end.data).toHaveProperty('streakAfter');
    expect(end.data).toHaveProperty('stars');
  }
  expect(ends[1]?.data).toMatchObject({ made: 'duster', stars: fletching.stars.bucket });
  expect(ends[1]?.data?.feathers).toBe(Number(ends[1]?.data?.arrows) * fletching.feathers.bucket);
  expect(ends[2]?.data).toMatchObject({ made: 'bare', feathers: 0 });
  expect(errors).toEqual([]);
});

test('with no feathers the batch can only be bare', async ({ page }) => {
  await openBench(page, { stave: 1 });
  await expect(page.locator('body')).toHaveAttribute('data-fletching', 'make', { timeout: 20_000 });
  await expect(page.locator('.fl-hint')).toContainText('No feathers');
  await page.getByRole('button', { name: 'Bare' }).tap();
  await expect(page.locator('#screen-fletching3d')).toHaveAttribute('data-made', 'bare');
  await expect(page.locator('.fl-card .fm-card-title')).toHaveText('×1 bare arrow', {
    timeout: 10_000,
  });
  await expect(page.locator('.fl-card')).toContainText('Out of staves');
});

test('with no staves the bench says so', async ({ page }) => {
  await openBench(page, { feather: 9 });
  await expect(page.locator('.fl-card')).toContainText('No staves', { timeout: 20_000 });
  await expect(page.locator('body')).toHaveAttribute('data-fletching', 'empty');
});
