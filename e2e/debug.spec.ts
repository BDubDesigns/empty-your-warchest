import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openDebug(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeVisible();
}

test('debug menu adds items, sets levels, keeps them after reload, exports logs and resets', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');

  await openDebug(page);
  await page.getByLabel('Item').selectOption('spear');
  await page.getByLabel('Quality').selectOption('good');
  await page.getByLabel('Count').fill('5');
  await page.getByRole('button', { name: 'Add' }).tap();
  await expect(page.getByText('Good Spear × 5')).toBeVisible();

  await page.getByLabel('Woodcutting level').fill('10');
  await page.locator('[data-skill=woodcutting]').getByRole('button', { name: 'Set' }).tap();
  await expect(page.locator('[data-skill=woodcutting]')).toContainText('Lv 10');

  await page.reload();
  await openDebug(page);
  await expect(page.getByText('Good Spear × 5')).toBeVisible();
  await expect(page.locator('[data-skill=woodcutting]')).toContainText('Lv 10');

  const downloadButton = page.getByRole('button', { name: 'Download logs' });
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.tap()]);
  expect(download.suggestedFilename()).toMatch(/^warchest-log-.*\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    events: { type: string; session: string }[];
  };
  const types = exported.events.map((event) => event.type);
  expect(types).toEqual(
    expect.arrayContaining([
      'session.start',
      'save.new',
      'save.loaded',
      'debug.addItems',
      'debug.setLevel',
    ]),
  );
  expect(new Set(exported.events.map((event) => event.session)).size).toBe(2);

  const reset = page.getByRole('button', { name: 'Reset save' });
  await reset.tap();
  await page.getByRole('button', { name: 'Tap again to wipe the save' }).tap();
  await expect(page.getByText('Good Spear × 5')).toBeHidden();
  await expect(page.locator('[data-skill=woodcutting]')).toContainText('Lv 1 ');

  await page.getByRole('button', { name: 'Close' }).tap();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeHidden();
  expect(errors).toEqual([]);
});
