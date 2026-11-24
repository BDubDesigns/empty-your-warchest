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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The simpler trees in the tree line: the detailed ones are slow in software rendering, and this
  // test is about getting in and out.
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
  });
  await page.goto('/');
  await viewIs(page, 'camp');
  const back = page.locator('#back-button');
  await expect(back).toBeHidden();

  for (const station of stations) {
    await tapCampSpot(page, station.camp);
    await viewIs(page, `station:${station.id}`);
    const screens: Record<string, string> = {
      runner: 'three',
      woodcutting3d: 'wood3d',
      rive: 'rive3d',
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
    events: { type: string; data?: { station?: string } }[];
  };
  const entered = exported.events.filter((event) => event.type === 'station.enter');
  expect(entered.map((event) => event.data?.station)).toEqual(
    stations.map((station) => station.id),
  );
  expect(exported.events.filter((event) => event.type === 'station.exit')).toHaveLength(
    stations.length,
  );
  expect(exported.events.map((event) => event.type)).toContain('warchest.open');
  expect(errors).toEqual([]);
});

test('the camp comes back at the right size after the window resizes in a station', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
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
