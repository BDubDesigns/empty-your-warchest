import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('the live tuning panel changes feel values and logs it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const slider = page.getByLabel('Fall time (s)');
  await slider.fill('2');
  await expect(page.locator('.debug-tune', { hasText: 'Fall time (s)' })).toContainText('2 •');
  await page.reload();
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await expect(page.locator('.debug-tune', { hasText: 'Fall time (s)' })).toContainText('2 •');
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
      data: { group: 'woodcutting', key: 'fallSeconds', value: 2 },
    }),
  );
  expect(exported.events.map((event) => event.type)).toContain('debug.tuneReset');
});
