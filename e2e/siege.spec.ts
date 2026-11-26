import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { siege } from '../src/data/siege';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const tent = stations.find((station) => station.mechanic === 'siege');
const feel = siege.feel;
/** An aimed volley at Command 1. */
const ballista = siege.weapons.find((weapon) => weapon.id === siege.weapon);
const volley = ballista?.aimed.start ?? 0;

/** Opens the War tent with `spears` spears in the warchest. */
async function openTent(page: Page, spears: number) {
  if (!tent) throw new Error('No siege station in data');
  // Every skill in data at 0, so the save fits the data and isn't discarded.
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  await page.addInitScript(
    ({ count, xp }) => {
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: {
            inventory: count > 0 ? [{ item: 'spear', count }] : [],
            skills: xp,
            lastSeenAt: Date.now(),
            done: ['tutorial.woodcutting'],
          },
        }),
      );
    },
    { count: spears, xp },
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(camp.x + camp.width * tent.camp.x, camp.y + camp.height * tent.camp.y);
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${tent.id}`);
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'siege3d');
}

test('Siege: tap the War tent, drag to look, Fire, and the ballista shoots the warchest’s spears', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openTent(page, 60);
  await expect(page.locator('body')).toHaveAttribute('data-siege', 'aim');
  const count = page.locator('#screen-siege3d .warchest-count');
  await expect(count).toHaveText('60');
  await expect(page.getByRole('radio', { name: /Aimed/ })).toContainText(
    `${String(volley)} spears`,
  );
  await expect(page.getByRole('radio', { name: /Barrage/ })).toContainText(
    `${String(volley * (ballista?.barrageTimes ?? 0))} spears`,
  );

  // Move to another spot first: a tap on its number.
  await page.getByRole('radio', { name: 'Spot 3' }).tap();
  await expect(page.locator('#screen-siege3d')).toHaveAttribute('data-spot', '2');
  await page.waitForTimeout(feel.spotSeconds * 1000 + 300);

  // Down the sights: the crosshair sits in the middle. A drag turns the view (right and up
  // here), then Fire.
  const view = page.locator('#screen-siege3d');
  await expect(page.locator('#screen-siege3d .sg-crosshair')).toBeVisible();
  const aim = async () =>
    ((await view.getAttribute('data-aim')) ?? '0 0').split(' ').map(Number) as [number, number];
  const [yaw, tilt] = await aim();
  const box = await page.locator('#screen-siege3d .sg-canvas').boundingBox();
  if (!box) throw new Error('No siege canvas');
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.6;
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x, y }]);
  for (let step = 1; step <= 5; step++) {
    await touch('touchMove', [{ x: x + step * 8, y: y - step * 4 }]);
  }
  await touch('touchEnd', []);
  const [turned, tilted] = await aim();
  expect(turned).toBeCloseTo(yaw + 40 * feel.lookYawPerPx, 1);
  expect(tilted).toBeCloseTo(Math.min(tilt + 20 * feel.lookTiltPerPx, ballista?.tilt.max ?? 0), 1);
  await expect(page.locator('#screen-siege3d .sg-crosshair')).toBeVisible();
  const fire = page.getByRole('button', { name: 'Fire' });
  await expect(fire).toBeEnabled();
  await fire.tap();

  // Scout rises over the fort and back; no shooting while up there.
  const scout = page.getByRole('button', { name: 'Scout' });
  await scout.tap();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect(fire).toBeDisabled();
  await page.getByRole('button', { name: 'Back', exact: true }).tap();

  // The ghost line of the last shot can be turned off, and stays off.
  const ghost = page.getByRole('button', { name: 'Ghost line' });
  await expect(ghost).toHaveAttribute('aria-pressed', 'true');
  await ghost.tap();
  await expect(ghost).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('warchest.siege.ghost'))).toContain('off');

  // An aimed volley, out of the warchest.
  await expect(count).toHaveText(String(60 - volley));
  await expect(page.locator('#screen-siege3d')).toHaveAttribute('data-thrown', String(volley));

  // It's logged for playtest data.
  await page.locator('#back-button').tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const download = page.getByRole('button', { name: 'Download logs' });
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  const types = exported.events.map((event) => event.type);
  for (const type of [
    'siege.start',
    'siege.spot',
    'siege.throw',
    'siege.scout',
    'siege.ghost',
    'siege.quit',
  ]) {
    expect(types).toContain(type);
  }
  const thrown = exported.events.find((event) => event.type === 'siege.throw');
  expect(thrown?.data).toMatchObject({ mode: 'aimed', spears: volley, spot: 2, position: 0 });
  expect(errors).toEqual([]);
});

test('Siege: with no spears in the warchest, it says so', async ({ page }) => {
  await openTent(page, 0);
  const card = page.locator('#screen-siege3d .sg-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('No spears');
  await card.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
});
