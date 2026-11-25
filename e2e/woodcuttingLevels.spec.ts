import { expect, test, type Page } from '@playwright/test';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';
import { tuning } from '../src/data/tuning';
import { woodcutting } from '../src/data/woodcutting';
import { XpCurve } from '../src/core/xp';

const tile = stations.find((station) => station.id === 'tree_line');
const curve = new XpCurve(tuning.xpCurve);
const fastFallLevel = woodcutting.unlocks.find((unlock) => unlock.fastFall)?.level ?? 0;

/** Starts with woodcutting at `level`, past the tutorial, and opens the tree line. */
async function openTreeLineAt(page: Page, level: number) {
  if (!tile) throw new Error('No tree line in data');
  // Every skill in data, so the save fits the data and isn't discarded.
  const xp = Object.fromEntries(
    skills.map((skill) => [skill.id, skill.id === 'woodcutting' ? curve.xpForLevel(level) : 0]),
  );
  await page.addInitScript((xp) => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
    localStorage.setItem('warchest.woodcutting.scenery', 'off');
    localStorage.setItem(
      'warchest.save',
      JSON.stringify({
        version: 1,
        savedAt: 1,
        state: {
          inventory: [],
          skills: xp,
          lastSeenAt: 1,
          done: ['tutorial.woodcutting'],
        },
      }),
    );
  }, xp);
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(camp.x + camp.width * tile.camp.x, camp.y + camp.height * tile.camp.y);
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'pick', {
    timeout: 20_000,
  });
}

test('the fast-fall switch shows from its unlock level and remembers its setting', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openTreeLineAt(page, fastFallLevel);
  const fast = page.locator('.w3d-fast');
  await expect(fast).toHaveText(/Fast fall: off/);
  await fast.tap();
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('warchest.woodcutting.fastFall'))).toBe(
    'on',
  );
});

test('the fast-fall switch stays hidden below its level', async ({ page }) => {
  test.setTimeout(60_000);
  await openTreeLineAt(page, fastFallLevel - 1);
  await expect(page.locator('.w3d-fast')).toBeHidden();
});

test('the level bar shows the woodcutting level and flashes when it goes up', async ({ page }) => {
  test.setTimeout(60_000);
  await openTreeLineAt(page, 12);
  const bar = page.locator('.skill-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveText(/Woodcutting 12/);
  await expect(bar).toHaveAttribute('data-level', '12');
  // A level-up while in the station fills the bar, bumps the level and flashes.
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const row = page.locator('.debug-row[data-skill="woodcutting"]');
  await row.getByRole('spinbutton').fill('13');
  await row.getByRole('button', { name: 'Set' }).tap();
  await expect(bar).toHaveText(/Woodcutting 13/);
  await expect(bar).toHaveClass(/skill-bar-up/);
});

test('the first random clearing has a cabin and warns about it once', async ({ page }) => {
  test.setTimeout(60_000);
  await openTreeLineAt(page, 1);
  await expect(page.locator('.w3d-hint')).toHaveText(/cabin/);
});
