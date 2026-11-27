import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const stand = stations.find((station) => station.mechanic === 'archery');

/** Opens the hunting stand with these arrows in the warchest. */
async function openStand(page: Page, arrows: Record<string, number>) {
  if (!stand) throw new Error('No archery station in data');
  // Every skill in data, so the save fits the data and isn't discarded.
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  await page.addInitScript(
    ({ arrows, xp }) => {
      const inventory = Object.entries(arrows)
        .filter(([, count]) => count > 0)
        .map(([item, count]) => ({ item, count }));
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: { inventory, skills: xp, lastSeenAt: Date.now(), done: ['tutorial.woodcutting'] },
        }),
      );
    },
    { arrows, xp },
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(
    camp.x + camp.width * stand.camp.x,
    camp.y + camp.height * stand.camp.y,
  );
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${stand.id}`);
}

/** Drags back from the middle of the lower screen, `pull` pixels down and `side` across. */
async function drawAndShoot(page: Page, pull: number, side = 0) {
  const box = await page.locator('#screen-archery3d canvas').first().boundingBox();
  if (!box) throw new Error('No archery canvas');
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.6;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step++) {
    await page.waitForTimeout(30);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (side * step) / 6, y: y + (pull * step) / 6 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('draws the bow and shoots an arrow, logged with its draw and aim', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStand(page, { fletched_arrow: 20, bare_arrow: 3 });
  await expect(page.locator('body')).toHaveAttribute('data-archery', 'hunt', { timeout: 20_000 });
  const screen = page.locator('#screen-archery3d');
  // The quiver starts on the best arrows there are, and can switch.
  await expect(screen).toHaveAttribute('data-quiver', 'fletched_arrow');
  const bare = page.getByRole('radio', { name: /Bare arrow/ });
  await bare.tap();
  await expect(screen).toHaveAttribute('data-quiver', 'bare_arrow');
  await page.getByRole('radio', { name: /Fletched arrow/ }).tap();
  await expect(screen).toHaveAttribute('data-quiver', 'fletched_arrow');
  // A tiny pull lets the string down: no shot.
  await drawAndShoot(page, 8);
  await expect(screen).toHaveAttribute('data-shots', '0');
  // A real one shoots, and spends an arrow.
  await drawAndShoot(page, 140, -30);
  await expect(screen).toHaveAttribute('data-shots', '1');
  await expect(page.getByRole('radio', { name: /Fletched arrow/ })).toHaveAttribute(
    'aria-label',
    /: 19$/,
  );
  // Once it's come down, the shot is in the log.
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download logs' }).tap(),
  ]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  const start = exported.events.find((event) => event.type === 'archery.roundStart');
  expect(start?.data?.feel).toBeDefined();
  const shot = exported.events.find((event) => event.type === 'archery.shot');
  expect(shot?.data).toMatchObject({ kind: 'fletched_arrow', shot: 0 });
  expect(shot?.data?.draw).toBeCloseTo(140 / 150, 1);
  // Pulled down and to the left: the shot goes up and to the right.
  expect(Number(shot?.data?.angle)).toBeLessThan(90);
  expect(typeof shot?.data?.hit).toBe('boolean');
  expect(errors).toEqual([]);
});

test('with no arrows the stand says so', async ({ page }) => {
  await openStand(page, {});
  await expect(page.locator('.ar-card')).toContainText('Out of arrows', { timeout: 20_000 });
  await expect(page.locator('body')).toHaveAttribute('data-archery', 'empty');
});
