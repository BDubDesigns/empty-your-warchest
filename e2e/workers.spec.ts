import { expect, test, type Page } from '@playwright/test';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

const treeLine = stations.find((station) => station.id === 'tree_line');

/** The saved game, as the page has it. */
function saved(page: Page) {
  return page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('warchest.save') ?? '{}') as {
          state: {
            inventory: { item: string; count: number }[];
            work: { piles: Record<string, { item: string; count: number }[]> };
          };
        }
      ).state,
  );
}

test('workers make things while you are away, and Collect pours them into the chest', async ({
  page,
}) => {
  if (!treeLine) throw new Error('No tree line in data');
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
  // 10 logs chopped, one passed to the Workbench and split at the 10-minute mark.
  await expect
    .poll(async () => (await saved(page)).work.piles.tree_line)
    .toEqual([{ item: 'log', count: 9 }]);
  expect((await saved(page)).inventory).toEqual([]);

  // Collect sits on the station's tile, under its level.
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(
    camp.x + camp.width * treeLine.camp.x,
    camp.y + camp.height * treeLine.camp.y + 12,
  );
  await expect.poll(async () => (await saved(page)).inventory).toEqual([{ item: 'log', count: 9 }]);
  expect((await saved(page)).work.piles.tree_line).toEqual([]);
  // A reload doesn't pay it again.
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  expect((await saved(page)).inventory).toEqual([{ item: 'log', count: 9 }]);
  expect(errors).toEqual([]);
});
