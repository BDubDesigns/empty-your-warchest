import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { stations } from '../src/data/stations';
import { woodcutting } from '../src/data/woodcutting';
import { fitClearing, toScreen } from '../src/stations/woodcutting/logic/layout';

const treeLine = stations.find((station) => station.id === 'tree_line');
const clearing = woodcutting.clearings[0];

async function canvasBox(page: Page) {
  const box = await page.locator('#screen-phaser canvas').boundingBox();
  if (!box) throw new Error('Canvas has no size');
  return box;
}

/** A real touch drag (Playwright's touchscreen only taps). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 6; step++) {
    const point = {
      x: from.x + ((to.x - from.x) * step) / 6,
      y: from.y + ((to.y - from.y) * step) / 6,
    };
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/** Screen distance from a tree that winds the axe up to the middle of the gold band. */
function goldPull(scale: number): number {
  const deadZone = 24;
  return deadZone + woodcutting.feel.swingTarget * woodcutting.feel.maxPull * scale;
}

async function phase(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.body.dataset.woodcutting);
}

test('a woodcutting turn: pick, aim, chop, fall, logs to the warchest', async ({ page }) => {
  if (!treeLine || !clearing) throw new Error('Missing tree line or clearing in data');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');

  let box = await canvasBox(page);
  await page.touchscreen.tap(
    box.x + box.width * treeLine.camp.x,
    box.y + box.height * treeLine.camp.y,
  );
  await expect(page.locator('body')).toHaveAttribute('data-view', 'station:tree_line');
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'pick');

  box = await canvasBox(page);
  const fit = fitClearing(box.width, box.height, clearing);
  const [tree, next] = clearing.trees;
  if (!tree || !next) throw new Error('Clearing needs two trees');
  const from = toScreen(fit, tree);
  const toward = toScreen(fit, next);
  // Pull the axe back, away from the second tree, into the gold band; every release swings.
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  const pull = goldPull(fit.scale);
  const pullTo = { x: from.x - (dx / length) * pull, y: from.y - (dy / length) * pull };
  for (
    let swings = 0;
    swings < 10 && (swings === 0 || /aim|chop/.test((await phase(page)) ?? ''));
    swings++
  ) {
    await touchDrag(
      page,
      { x: box.x + from.x, y: box.y + from.y },
      { x: box.x + pullTo.x, y: box.y + pullTo.y },
    );
    await page.waitForTimeout(400);
  }
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', /pick|cleared/, {
    timeout: 10_000,
  });

  await page.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');

  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await expect(page.getByText(/^Log × \d+$/)).toBeVisible();
  const download = page.getByRole('button', { name: 'Download logs' });
  await expect(download).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  const types = exported.events.map((event) => event.type);
  for (const type of [
    'woodcutting.roundStart',
    'woodcutting.select',
    'woodcutting.aim',
    'woodcutting.chop',
    'woodcutting.fell',
    'woodcutting.bank',
    'woodcutting.roundEnd',
  ]) {
    expect(types).toContain(type);
  }
  const bank = exported.events.find((event) => event.type === 'woodcutting.bank');
  expect(bank?.data?.logs).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('the live tuning panel changes feel values and logs it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const slider = page.getByLabel('Fall time (s)');
  await slider.fill('1.5');
  await expect(page.locator('.debug-tune', { hasText: 'Fall time (s)' })).toContainText('1.5 •');
  await page.reload();
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await expect(page.locator('.debug-tune', { hasText: 'Fall time (s)' })).toContainText('1.5 •');
  await page.getByRole('button', { name: 'Reset to data' }).tap();
  await expect(page.locator('.debug-tune', { hasText: 'Fall time (s)' })).not.toContainText('•');

  const download = page.getByRole('button', { name: 'Download logs' });
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  expect(exported.events).toContainEqual(
    expect.objectContaining({
      type: 'debug.tune',
      data: { group: 'woodcutting', key: 'fallSeconds', value: 1.5 },
    }),
  );
  expect(exported.events.map((event) => event.type)).toContain('debug.tuneReset');
});

test('pulling back aims the opposite way', async ({ page }) => {
  if (!treeLine || !clearing) throw new Error('Missing tree line or clearing in data');
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  let box = await canvasBox(page);
  await page.touchscreen.tap(
    box.x + box.width * treeLine.camp.x,
    box.y + box.height * treeLine.camp.y,
  );
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'pick');
  box = await canvasBox(page);
  const fit = fitClearing(box.width, box.height, clearing);
  const [tree] = clearing.trees;
  if (!tree) throw new Error('Clearing has no trees');
  const from = toScreen(fit, tree);
  // Pull straight up: the tree should be aimed straight down (90°).
  await touchDrag(
    page,
    { x: box.x + from.x, y: box.y + from.y },
    { x: box.x + from.x, y: box.y + from.y - 60 },
  );
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'chop');

  await page.getByRole('button', { name: 'Back to camp' }).tap();
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const download = page.getByRole('button', { name: 'Download logs' });
  await expect(download).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: { angle?: number } }[];
  };
  expect(exported.events.find((event) => event.type === 'woodcutting.aim')?.data?.angle).toBe(90);
});
