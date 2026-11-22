import { expect, test, type Page } from '@playwright/test';
import { SWITCH_BUTTON_Y } from '../src/app/theme';

async function screenIs(page: Page, id: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-screen', id);
}

test('switches from the Phaser screen to the three.js screen and back by touch', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await screenIs(page, 'phaser');
  const phaserCanvas = page.locator('#screen-phaser canvas');
  await expect(phaserCanvas).toBeVisible();

  // The switch button is drawn by Phaser on its canvas, so tap where it is.
  const box = await phaserCanvas.boundingBox();
  if (!box) throw new Error('Phaser canvas has no size');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * SWITCH_BUTTON_Y);

  await screenIs(page, 'three');
  await expect(page.locator('#screen-three canvas')).toBeVisible();
  await expect(page.locator('#screen-phaser')).toBeHidden();

  await page.getByRole('button', { name: 'Back to 2D' }).tap();
  await screenIs(page, 'phaser');
  await expect(phaserCanvas).toBeVisible();
  await expect(page.locator('#screen-three')).toBeHidden();

  expect(errors).toEqual([]);
});
