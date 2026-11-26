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
const volley = siege.ballista.aimed.start;

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

test('Siege: tap the War tent, drag to aim, let go, and the ballista shoots the warchest’s spears', async ({
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
    `${String(volley * siege.ballista.barrageTimes)} spears`,
  );

  // Move to another spot first: a tap on its number.
  await page.getByRole('radio', { name: 'Spot 3' }).tap();
  await expect(page.locator('#screen-siege3d')).toHaveAttribute('data-spot', '2');
  await page.waitForTimeout(feel.spotSeconds * 1000 + 300);

  // A touch drag down the screen tilts the ballista up; let go and it shoots.
  const box = await page.locator('#screen-siege3d .sg-canvas').boundingBox();
  if (!box) throw new Error('No siege canvas');
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.45;
  const pull = feel.deadPx + 40;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (pull * step) / 6 }],
    });
  }
  await expect(page.locator('#screen-siege3d .sg-pull')).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#screen-siege3d .sg-pull')).toBeHidden();

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
  for (const type of ['siege.start', 'siege.spot', 'siege.throw', 'siege.quit']) {
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
