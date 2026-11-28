import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const bench = stations.find((station) => station.mechanic === 'fletching');

/** Opens the fletcher's bench with these in the warchest. */
async function openBench(page: Page, stock: Record<string, number>) {
  if (!bench) throw new Error('No fletching station in data');
  // Every skill in data, so the save fits the data and isn't discarded.
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
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

/** Arrows made so far, of every kind. */
async function made(page: Page): Promise<number> {
  const screen = page.locator('#screen-fletching3d');
  const counts = await Promise.all(
    ['data-fletched', 'data-dusters', 'data-bares'].map((name) => screen.getAttribute(name)),
  );
  return counts.reduce((sum, count) => sum + Number(count ?? 0), 0);
}

test('makes an arrow each way: careful, the bucket and bare, each logged', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openBench(page, { stave: 2, feather: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-fletching', 'make', { timeout: 20_000 });
  const screen = page.locator('#screen-fletching3d');
  await expect(screen).toHaveAttribute('data-step', 'shaft');
  await expect(page.locator('.fl-status')).toContainText('0 fletched');

  // Careful: tar, then three feathers tapped on as the shaft turns.
  await dip(page, 0.5);
  const box = await page.locator('.fl-canvas').boundingBox();
  if (!box) throw new Error('No fletching canvas');
  for (let feather = 0; feather < 3; feather++) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.45);
    await page.waitForTimeout(250);
  }
  await expect.poll(() => made(page)).toBe(1);
  await expect(screen).toHaveAttribute('data-step', 'shaft', { timeout: 5000 });

  // The bucket: tar, then shove it in. Always a duster.
  await dip(page, 0.3);
  await page.getByRole('button', { name: /Bucket/ }).tap();
  await expect(screen).toHaveAttribute('data-dusters', /[1-9]/);
  await expect.poll(() => made(page)).toBe(2);
  await expect(screen).toHaveAttribute('data-step', 'shaft', { timeout: 5000 });

  // Bare: no tar, no feathers.
  const bares = Number(await screen.getAttribute('data-bares'));
  await page.getByRole('button', { name: 'Bare' }).tap();
  await expect(screen).toHaveAttribute('data-bares', String(bares + 1));
  await expect.poll(() => made(page)).toBe(3);

  // The logs have each arrow, how it was made, and the feel the round started with.
  await page.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download logs' }).tap(),
  ]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  const start = exported.events.find((event) => event.type === 'fletching.roundStart');
  expect(start?.data).toMatchObject({ staves: 2, feathers: 20 });
  expect(start?.data?.feel).toBeDefined();
  const arrows = exported.events.filter((event) => event.type === 'fletching.arrow');
  expect(arrows.map((event) => event.data?.way)).toEqual(['careful', 'bucket', 'bare']);
  expect(arrows[0]?.data?.taps).toHaveLength(3);
  expect(typeof arrows[0]?.data?.tar).toBe('number');
  expect(arrows[1]?.data).toMatchObject({ made: 'duster', feathers: 6 });
  expect(arrows[2]?.data).toMatchObject({ made: 'bare', feathers: 0 });
  expect(exported.events.map((event) => event.type)).toContain('fletching.leave');
  expect(errors).toEqual([]);
});

test('with no staves or shafts the bench says so', async ({ page }) => {
  await openBench(page, { feather: 9 });
  await expect(page.locator('.fl-card')).toContainText('No shafts', { timeout: 20_000 });
  await expect(page.locator('body')).toHaveAttribute('data-fletching', 'empty');
});
