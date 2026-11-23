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
  const back = page.getByRole('button', { name: 'Back to camp' });
  await expect(back).toBeHidden();

  for (const station of stations) {
    await tapCampSpot(page, station.camp);
    await viewIs(page, `station:${station.id}`);
    const screens: Record<string, string> = { runner: 'three', woodcutting3d: 'wood3d' };
    const screen = screens[station.mechanic] ?? 'phaser';
    await expect(page.locator('body')).toHaveAttribute('data-screen', screen);
    await expect(page.locator(`#screen-${screen} canvas`)).toBeVisible();
    await back.tap();
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
