import { expect, test, type Page } from '@playwright/test';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

/** Opens a station from the camp, with this inventory in the warchest. */
async function open(page: Page, mechanic: string, inventory: Record<string, number>) {
  const station = stations.find((entry) => entry.mechanic === mechanic);
  if (!station) throw new Error(`No ${mechanic} station in data`);
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  await page.addInitScript(
    ({ inventory, xp }) => {
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: {
            inventory: Object.entries(inventory).map(([item, count]) => ({ item, count })),
            skills: xp,
            lastSeenAt: Date.now(),
            done: ['tutorial.woodcutting'],
          },
        }),
      );
    },
    { inventory, xp },
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(
    camp.x + camp.width * station.camp.x,
    camp.y + camp.height * station.camp.y,
  );
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${station.id}`);
}

/** Draws back and shoots at the hunting stand. */
async function shoot(page: Page) {
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
      touchPoints: [{ x: x - 5, y: y + (140 * step) / 6 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

/** Drags an ingredient off its shelf tile into the pot. */
async function dropIn(page: Page, id: string) {
  const tile = await page.locator(`.br-jar[data-ingredient="${id}"]`).boundingBox();
  if (!tile) throw new Error(`No tile for ${id}`);
  const screen = page.locator('#screen-brewing3d');
  const end = {
    x: Number(await screen.getAttribute('data-pot-x')),
    y: Number(await screen.getAttribute('data-pot-y')),
  };
  const start = { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 };
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (const t of [0.3, 0.7, 1]) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/**
 * Gets ready to tap Back to camp the moment the first shot is counted, from inside the page: in
 * software rendering a real tap would wait for frames, long enough for the arrow to land first.
 */
const backOnFirstShot = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const screen = document.getElementById('screen-archery3d');
        if (!screen) throw new Error('No archery screen');
        new MutationObserver((_changes, observer) => {
          if (screen.dataset.shots !== '1') return;
          observer.disconnect();
          document.getElementById('back-button')?.click();
          resolve();
        }).observe(screen, { attributes: true });
      }),
  );
const back = (page: Page) => page.getByRole('button', { name: 'Back to camp' });
const card = (page: Page) => page.getByRole('alertdialog', { name: 'Leave this round?' });

test('archery: Back to camp asks while an arrow is in the air, and Keep playing stays', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, 'archery', { fletched_arrow: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-archery', 'hunt', { timeout: 20_000 });
  const tapped = backOnFirstShot(page);
  await shoot(page);
  await tapped;
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('in the air');
  await expect(card(page).getByRole('button', { name: 'Keep playing' })).toBeFocused();
  // Keep playing: still in the round.
  await card(page).getByRole('button', { name: 'Keep playing' }).tap();
  await expect(card(page)).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-archery', 'hunt');
  await expect(page.locator('body')).toHaveAttribute('data-view', /^station:/);
});

test('brewing: an empty pot loses nothing, so Back to camp leaves at once', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 'brewing', { red_cap: 20, moss: 20, woad: 20, ash: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-brewing', 'brew', { timeout: 20_000 });
  // An empty pot loses nothing: no card.
  await back(page).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await expect(card(page)).toBeHidden();
});

test('brewing: Keep playing keeps the pot, Leave goes', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 'brewing', { red_cap: 20, moss: 20, woad: 20, ash: 20 });
  const screen = page.locator('#screen-brewing3d');
  await expect(page.locator('body')).toHaveAttribute('data-brewing', 'brew', { timeout: 20_000 });
  await dropIn(page, 'red_cap');
  await expect(screen).toHaveAttribute('data-fill', '1');
  await back(page).tap();
  await expect(card(page)).toContainText('Your brew is lost');
  await card(page).getByRole('button', { name: 'Keep playing' }).tap();
  await expect(card(page)).toBeHidden();
  await expect(screen).toHaveAttribute('data-fill', '1');
  await back(page).tap();
  await card(page).getByRole('button', { name: 'Leave' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
});

test("the phone's back acts like Back to camp", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 'brewing', { red_cap: 20, moss: 20, woad: 20, ash: 20 });
  const screen = page.locator('#screen-brewing3d');
  await expect(page.locator('body')).toHaveAttribute('data-brewing', 'brew', { timeout: 20_000 });
  await dropIn(page, 'red_cap');
  await expect(screen).toHaveAttribute('data-fill', '1');
  // Back with something to lose: the same card; the page stays where it is.
  await page.goBack();
  await expect(card(page)).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-view', /^station:/);
  // Back again, with the card up, counts as Keep playing.
  await page.goBack();
  await expect(card(page)).toBeHidden();
  await expect(screen).toHaveAttribute('data-fill', '1');
  // Back, then Leave: at the camp, with no history entry of ours left over.
  await page.goBack();
  await card(page).getByRole('button', { name: 'Leave' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await expect(page.locator('#screen-phaser canvas')).toBeVisible();
  // At the camp, back is the browser's own again: it leaves the page.
  await page.goBack();
  expect(page.url()).toBe('about:blank');
});

test("the phone's back with nothing to lose goes straight to camp", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 'brewing', { red_cap: 20, moss: 20, woad: 20, ash: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-brewing', 'brew', { timeout: 20_000 });
  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await expect(card(page)).toBeHidden();
  // The camp's own back is the browser's: the game isn't kept in a loop.
  await expect(page.locator('#screen-phaser canvas')).toBeVisible();
});
