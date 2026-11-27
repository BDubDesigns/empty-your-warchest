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
  const row = bench.locator('tbody tr[data-pack=boxes]');
  await expect(row).toHaveCount(1);
  await expect(bench.getByRole('status')).toContainText('1 of 1 run done');

  // Closing it goes back to the camp, running again.
  await bench.getByRole('button', { name: 'Close' }).tap();
  await expect(bench).toBeHidden();
  await expect(page.locator('#screen-phaser')).toBeVisible();
  expect(errors).toEqual([]);
});
