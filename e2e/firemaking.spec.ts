import { expect, test, type Page } from '@playwright/test';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const pit = stations.find((station) => station.mechanic === 'firemaking');

/** Opens the fire pit with `staves` staves and `logs` logs in the warchest. */
async function openFirePit(page: Page, staves: number, logs: number) {
  if (!pit) throw new Error('No firemaking station in data');
  // Every skill in data at 0, so the save fits the data and isn't discarded.
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  await page.addInitScript(
    ({ staves, logs, xp }) => {
      const inventory = [
        ...(logs > 0 ? [{ item: 'log', count: logs }] : []),
        ...(staves > 0 ? [{ item: 'stave', count: staves }] : []),
      ];
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: { inventory, skills: xp, lastSeenAt: 1, done: ['tutorial.woodcutting'] },
        }),
      );
    },
    { staves, logs, xp },
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(camp.x + camp.width * pit.camp.x, camp.y + camp.height * pit.camp.y);
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${pit.id}`);
}

test('hardens a rack of staves into spears that land in the chest', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFirePit(page, 6, 4);
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-firemaking', 'plan', { timeout: 20_000 });
  // A log into the first spot, then lay the rack.
  const spot = page.getByRole('button', { name: 'Fuel spot 1' });
  await spot.tap();
  await expect(spot).toHaveAttribute('data-logs', '1');
  await page.getByRole('button', { name: 'Lay the rack' }).tap();
  await expect(body).toHaveAttribute('data-firemaking', 'cook');
  // Pull as soon as any stave has hardened: grab the handle and drag it toward you.
  const screen = page.locator('#screen-firemaking3d');
  await expect(screen).toHaveAttribute('data-finishes', /hardened/, { timeout: 60_000 });
  const x = Number(await screen.getAttribute('data-handle-x'));
  const y = Number(await screen.getAttribute('data-handle-y'));
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 5; step++) {
    await page.waitForTimeout(30);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + step * 20 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(body).toHaveAttribute('data-firemaking', 'done', { timeout: 15_000 });
  await expect(page.locator('.fm-card')).toContainText(/\d+ spears?/, { timeout: 15_000 });
  // The spears pour into the chest.
  await expect(page.locator('.warchest-hud')).toHaveAttribute('data-settled', 'true', {
    timeout: 20_000,
  });
  const spears = Number(await page.locator('.warchest-hud').getAttribute('data-count'));
  expect(spears).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('with no staves the fire pit says so', async ({ page }) => {
  await openFirePit(page, 0, 4);
  await expect(page.locator('.fm-card')).toContainText('No staves', { timeout: 20_000 });
});
