import { expect, test } from '@playwright/test';

// Debug → Castle preview builds the siege's castle and draws it, flies to a vantage point, and
// closes back to the camp. CI draws 3D in software, which the graphics tier reads as a low-end
// phone, so this is the Low build: the lighter one.
test('the castle preview opens from Debug, flies to a vantage point and closes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');

  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await page.getByRole('button', { name: 'Castle preview' }).tap();
  const preview = page.getByRole('dialog', { name: 'Castle preview' });
  await expect(preview).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeHidden();
  await expect(preview).toHaveAttribute('data-tier', 'low');
  await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
  // It drew something, and says what it cost.
  expect(Number(await preview.getAttribute('data-draw-calls'))).toBeGreaterThan(0);
  await expect(preview.getByRole('status')).toContainText('draws');

  const views = preview.getByRole('group', { name: 'Views' });
  await expect(views.getByRole('button', { name: 'Orbit' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await views.getByRole('button', { name: 'Hill' }).tap();
  await expect(preview).toHaveAttribute('data-view', 'hill');
  await expect(views.getByRole('button', { name: 'Hill' })).toHaveAttribute('aria-pressed', 'true');
  // A drag from a vantage point orbits round what it looks at.
  const canvas = preview.locator('.castle-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(preview).toHaveAttribute('data-view', 'orbit');

  await preview.getByRole('button', { name: 'Close' }).tap();
  await expect(preview).toBeHidden();
  await expect(page.locator('#screen-phaser')).toBeVisible();
  expect(errors).toEqual([]);
});
