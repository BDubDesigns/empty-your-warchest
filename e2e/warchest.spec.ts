import { expect, test } from '@playwright/test';
import { items } from '../src/data/items';
import { stations } from '../src/data/stations';

const tile = stations.find((station) => station.id === 'tree_line');

test('tapping the HUD chest opens the warchest panel, and it closes again', async ({ page }) => {
  test.setTimeout(60_000);
  if (!tile) throw new Error('No tree line in data');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(camp.x + camp.width * tile.camp.x, camp.y + camp.height * tile.camp.y);
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'pick', {
    timeout: 20_000,
  });

  const chest = page.locator('.warchest-hud');
  const panel = page.getByRole('dialog', { name: 'Warchest' });
  const shown = (await chest.getAttribute('data-count')) ?? '?';
  await chest.tap();
  await expect(chest).toHaveAttribute('data-open', 'true');
  await expect(panel).toBeVisible();
  // Every item is listed; the station's own row ends on the chest's count once it ticks up.
  const logRow = panel.locator('.warchest-row-here');
  await expect(logRow).toContainText('Log');
  await expect(logRow.locator('.warchest-row-detail')).toHaveText(shown);
  await expect(panel.locator('.warchest-row')).toHaveCount(items.length);

  await panel.getByRole('button', { name: 'Close' }).tap();
  await expect(chest).toHaveAttribute('data-open', 'false');
  await expect(panel).toBeHidden();

  // Tapping the chest again opens it; tapping the chest while open closes it.
  await chest.tap();
  await expect(panel).toBeVisible();
  await chest.tap();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});
