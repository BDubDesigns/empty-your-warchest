import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { camp } from '../src/data/camp';
import { stations } from '../src/data/stations';

async function viewIs(page: Page, view: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-view', view);
}

/** Taps a camp spot; spots are fractions of the camp canvas. */
async function tapCampSpot(page: Page, spot: { x: number; y: number }): Promise<void> {
  const box = await page.locator('#screen-phaser canvas').boundingBox();
  if (!box) throw new Error('Camp canvas has no size');
  await page.touchscreen.tap(box.x + box.width * spot.x, box.y + box.height * spot.y);
}

test('every station and the chest can be entered and exited by touch', async ({ page }) => {
  // Seven 3D stations to open, rendered in software on CI.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The simpler trees in the tree line: the detailed ones are slow in software rendering, and this
  // test is about getting in and out.
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
    localStorage.setItem('warchest.woodcutting.scenery', 'off');
  });
  await page.goto('/');
  await viewIs(page, 'camp');
  const back = page.locator('#back-button');
  await expect(back).toBeHidden();

  for (const station of stations) {
    await tapCampSpot(page, station.camp);
    await viewIs(page, `station:${station.id}`);
    const screens: Record<string, string> = {
      siege: 'siege3d',
      woodcutting3d: 'wood3d',
      splitting: 'splitting3d',
      firemaking: 'firemaking3d',
      brewing: 'brewing3d',
      archery: 'archery3d',
      fletching: 'fletching3d',
    };
    const screen = screens[station.mechanic] ?? 'phaser';
    await expect(page.locator('body')).toHaveAttribute('data-screen', screen);
    await expect(page.locator(`#screen-${screen} canvas`).first()).toBeVisible();
    if (screen === 'wood3d') {
      // Woodcutting's top button ends the round; its summary has the way back.
      await expect(back).toHaveText('End round');
      await back.tap();
      await page.locator('.w3d-summary').getByRole('button', { name: 'Back to camp' }).tap();
    } else {
      await expect(back).toHaveText('Back to camp');
      await back.tap();
    }
    await viewIs(page, 'camp');
    await expect(page.locator('#screen-phaser canvas')).toBeVisible();
  }

  await tapCampSpot(page, camp.chest);
  await viewIs(page, 'warchest');
  await back.tap();
  await viewIs(page, 'camp');

  // Station visits are logged for the playtest data.
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const download = page.getByRole('button', { name: 'Download logs' });
  await expect(download).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: { station?: string; ms?: number } }[];
  };
  const entered = exported.events.filter((event) => event.type === 'station.enter');
  expect(entered.map((event) => event.data?.station)).toEqual(
    stations.map((station) => station.id),
  );
  expect(exported.events.filter((event) => event.type === 'station.exit')).toHaveLength(
    stations.length,
  );
  expect(exported.events.map((event) => event.type)).toContain('warchest.open');
  // Every station here has its own screen, loaded on its first visit and timed for tuning.
  const loads = exported.events.filter((event) => event.type === 'screen.load');
  expect(loads.map((event) => event.data?.station)).toEqual(stations.map((station) => station.id));
  for (const load of loads) expect(load.data?.ms).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('a slow station shows the loading card until its screen is ready', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
    localStorage.setItem('warchest.woodcutting.scenery', 'off');
  });
  // A slow connection: the station's models take a while, so neither the preload nor the tap
  // can open it quickly.
  await page.route('**/models/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto('/');
  await viewIs(page, 'camp');
  const station = stations.find((entry) => entry.mechanic === 'woodcutting3d');
  if (!station) throw new Error('No 3D woodcutting station in data');
  await tapCampSpot(page, station.camp);
  const card = page.locator('.loading-overlay');
  await expect(card).toBeVisible();
  await expect(card).toHaveText(`Heading to the ${station.name}…`);
  // The models wait twice (a model, then its buffers), and CI draws 3D in software.
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${station.id}`, {
    timeout: 30_000,
  });
  await expect(card).toBeHidden();
});

test('the camp comes back at the right size after the window resizes in a station', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
    localStorage.setItem('warchest.woodcutting.scenery', 'off');
  });
  await page.goto('/');
  await viewIs(page, 'camp');
  const station = stations.find((entry) => entry.mechanic === 'woodcutting3d');
  if (!station) throw new Error('No 3D woodcutting station in data');
  await tapCampSpot(page, station.camp);
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'pick', {
    timeout: 20_000,
  });
  // e.g. a phone's address bar hiding, or the window being resized, while the camp is hidden.
  await page.setViewportSize({ width: 400, height: 820 });
  await page.locator('#back-button').tap();
  await page.locator('.w3d-summary').getByRole('button', { name: 'Back to camp' }).tap();
  await viewIs(page, 'camp');
  const canvas = page.locator('#screen-phaser canvas');
  await expect
    .poll(async () => canvas.evaluate((element: HTMLCanvasElement) => element.clientWidth))
    .toBe(400);
});
