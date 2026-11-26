import { expect, test } from '@playwright/test';
import { skills } from '../src/data/skills';

test('the workers bank what they made while you were away, at the camp', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  // Last seen 10 minutes ago, with the starting crew (no saved workers: an older save).
  await page.addInitScript((xp) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'warchest.save',
      JSON.stringify({
        version: 1,
        savedAt: 1,
        state: { inventory: [], skills: xp, lastSeenAt: Date.now() - 10 * 60_000, done: [] },
      }),
    );
  }, xp);
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const card = page.getByRole('dialog', { name: 'While you were away' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('10 min away');
  await expect(card).toContainText('Tree line · 👷 1: +10 logs');
  await card.getByRole('button', { name: 'Nice' }).tap();
  await expect(card).toBeHidden();
  // It's banked, and saved: a reload doesn't pay it again.
  const saved = await page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('warchest.save') ?? '{}') as {
          state: { inventory: { item: string; count: number }[] };
        }
      ).state.inventory,
  );
  expect(saved.find((stack) => stack.item === 'log')?.count).toBe(9);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.waitForTimeout(500);
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});
