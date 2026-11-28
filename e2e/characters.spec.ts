import { expect, test } from '@playwright/test';
import { characters } from '../src/data/characters';

// Debug → Character preview loads the guards and the captain and draws them, plays a clip, cycles
// the guards' looks, shows the crowd, and closes back to the camp. CI draws 3D in software, which the graphics tier reads
// as a low-end phone, so this is the Low build: the lighter one.
test('the character preview opens from Debug, plays a clip, cycles looks, shows a crowd and closes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');

  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await page.getByRole('button', { name: 'Character preview' }).tap();
  const preview = page.getByRole('dialog', { name: 'Character preview' });
  await expect(preview).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeHidden();
  await expect(preview).toHaveAttribute('data-tier', 'low');
  await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
  // It drew both of them, and says what it cost.
  expect(Number(await preview.getAttribute('data-draw-calls'))).toBeGreaterThan(1);
  await expect(preview.getByRole('status')).toContainText('draws');
  await expect(preview.getByRole('status')).toContainText('Guard');

  const clips = preview.getByRole('group', { name: 'Clips' });
  await clips.getByRole('button', { name: 'Walk' }).tap();
  await expect(preview).toHaveAttribute('data-clip', 'walk');
  await expect(clips.getByRole('button', { name: 'Walk' })).toHaveAttribute('aria-pressed', 'true');
  await clips.getByRole('button', { name: 'Die' }).tap();
  await expect(preview).toHaveAttribute('data-clip', 'die');

  // Look shows each of the guards' looks in turn beside the captain, and round to the first.
  const look = preview.getByRole('button', { name: /^Look / });
  await expect(preview).toHaveAttribute('data-look', characters.guards[0] ?? '');
  for (const [index, id] of [...characters.guards.slice(1), characters.guards[0]].entries()) {
    await look.tap();
    await expect(preview).toHaveAttribute('data-look', id ?? '');
    const name = characters.models.find((model) => model.id === id)?.name ?? '';
    await expect(look).toContainText(name);
    if (index === 0) {
      await expect(preview.getByRole('status')).toContainText(name, { timeout: 30_000 });
    }
  }

  // The crowd: a dozen guards, each a draw of its own.
  const before = Number(await preview.getAttribute('data-draw-calls'));
  await preview.getByRole('button', { name: 'Crowd' }).tap();
  await expect(preview).toHaveAttribute('data-mode', 'crowd');
  await expect(preview.getByRole('status')).toContainText('Crowd of 12', { timeout: 30_000 });
  expect(Number(await preview.getAttribute('data-draw-calls'))).toBeGreaterThan(before);
  expect(Number(await preview.getAttribute('data-frame-ms'))).toBeGreaterThan(0);

  await preview.getByRole('button', { name: 'Close' }).tap();
  await expect(preview).toBeHidden();
  await expect(page.locator('#screen-phaser')).toBeVisible();
  expect(errors).toEqual([]);
});
