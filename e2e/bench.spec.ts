import { expect, test } from '@playwright/test';

// The stress test opens from the debug menu, runs the box scene once at 1× and shows its result.
// CI draws 3D in software, so this is the lightest run there is; it still takes the full 20 s path.
test('the stress test opens from Debug and runs the box scene at 1×', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');

  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await page.getByRole('button', { name: 'Stress test', exact: true }).tap();
  const bench = page.getByRole('dialog', { name: 'Stress test' });
  await expect(bench).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeHidden();

  const pack = bench.getByRole('group', { name: 'Pack' });
  await expect(pack.getByRole('button', { name: 'Boxes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(
    bench.getByRole('group', { name: 'Copies of everything' }).getByRole('button', { name: '1×' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await bench.getByRole('button', { name: 'Run', exact: true }).tap();
  await expect(bench).toHaveAttribute('data-bench-state', 'running');
  await expect(bench).toHaveAttribute('data-bench-state', 'done', { timeout: 100_000 });
  await expect(bench.getByRole('status')).toContainText('1 of 1 run done');

  // On a phone the results open as the summary, which fits the screen without scrolling sideways.
  const results = bench.getByRole('region', { name: 'Results' });
  const views = results.getByRole('group', { name: 'Results view' });
  await expect(views.getByRole('button', { name: 'Summary' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const summary = results.locator('.bench-summary tbody[data-pack=boxes]');
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText('1 · Boxes 1× · shadows on');
  await expect(results.locator('.bench-device')).toContainText('GPU:');
  const panel = bench.locator('.bench-panel');
  const sideways = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(sideways).toBeLessThanOrEqual(0);
  // The full table is a tap away.
  await views.getByRole('button', { name: 'Full table' }).tap();
  await expect(results.locator('.bench-table tr[data-pack=boxes]')).toHaveCount(1);
  await expect(results.locator('.bench-summary')).toBeHidden();

  // Send results posts the whole log, every run in it as bench.result.
  let posted: { events: { type: string }[] } | undefined;
  await page.route('**/api/logs', async (route) => {
    posted = route.request().postDataJSON() as typeof posted;
    await route.fulfill({ json: { code: 'B3NC', key: 'k' } });
  });
  await results.getByRole('button', { name: 'Send results' }).tap();
  await expect(bench.getByRole('status')).toHaveText('Sent ✓ code B3NC');
  expect(posted?.events.filter((event) => event.type === 'bench.result')).toHaveLength(1);

  // Closing it goes back to the camp, running again.
  await bench.getByRole('button', { name: 'Close' }).tap();
  await expect(bench).toBeHidden();
  await expect(page.locator('#screen-phaser')).toBeVisible();
  expect(errors).toEqual([]);
});
