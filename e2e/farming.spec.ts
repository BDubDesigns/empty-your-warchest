import { readFile } from 'node:fs/promises';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { farming } from '../src/data/farming';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const farm = stations.find((station) => station.mechanic === 'farming');
const woad = farming.crops.find((crop) => crop.id === 'woad');

/** The saved game, as the page has it. */
function saved(page: Page) {
  return page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('warchest.save') ?? '{}') as {
          state: { inventory: { item: string; count: number }[] };
        }
      ).state,
  );
}

/** Where a plot's middle is on the screen (its tag says, in CSS px of the farm's screen). */
async function plotPoint(page: Page, plot: number) {
  const tag = page.locator(`#screen-farming3d .fa-tag[data-plot="${String(plot)}"]`);
  const box = await page.locator('#screen-farming3d').boundingBox();
  const x = Number(await tag.getAttribute('data-x'));
  const y = Number(await tag.getAttribute('data-y'));
  return { x: (box?.x ?? 0) + x, y: (box?.y ?? 0) + y };
}

/** A finger dragged through `points`, a few moves between each. */
async function swipe(session: CDPSession, page: Page, points: { x: number; y: number }[]) {
  const [first, ...rest] = points;
  if (!first) return;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  let from = first;
  for (const to of rest) {
    for (let step = 1; step <= 5; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: from.x + ((to.x - from.x) * step) / 5, y: from.y + ((to.y - from.y) * step) / 5 },
        ],
      });
      await page.waitForTimeout(20);
    }
    from = to;
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Holds the can over a plot (the stream lands `liftPx` above the finger) until its gauge is in. */
async function pour(session: CDPSession, page: Page, plot: number, until: number) {
  const point = await plotPoint(page, plot);
  const touch = { x: point.x, y: point.y + farming.feel.liftPx };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: touch.x + 1, y: touch.y }],
  });
  await page.waitForFunction(
    ({ plot, until }) =>
      Number(
        document.querySelector<HTMLElement>(`.fa-gauge[data-plot="${String(plot)}"]`)?.dataset
          .moisture ?? 0,
      ) >= until,
    { plot, until },
    { timeout: 20_000 },
  );
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('plants a row, waters it, grows it (Debug skips time) and harvests it with a swipe', async ({
  page,
}) => {
  test.setTimeout(150_000);
  if (!farm || !woad) throw new Error('No farm or woad in data');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Every skill in data, so the save fits the data and isn't discarded. No seeds: the starter pack.
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  await page.addInitScript((xp) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'warchest.save',
      JSON.stringify({
        version: 1,
        savedAt: 1,
        state: {
          inventory: [],
          skills: xp,
          lastSeenAt: Date.now(),
          done: ['tutorial.woodcutting'],
        },
      }),
    );
  }, xp);
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(camp.x + camp.width * farm.camp.x, camp.y + camp.height * farm.camp.y);
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${farm.id}`);
  await expect(page.locator('body')).toHaveAttribute('data-farming', 'farm', { timeout: 20_000 });
  const screen = page.locator('#screen-farming3d');
  const seed = page.locator('.fa-seed[data-crop="woad"]');
  // The starter pack.
  await expect(seed).toContainText(`· ${String(woad.starter)}`);

  // Plant a row: pick woad and drag across the four plots.
  await seed.tap();
  const session = await page.context().newCDPSession(page);
  const plots = await Promise.all([0, 1, 2, 3].map((plot) => plotPoint(page, plot)));
  const [a, b, c, d] = plots;
  if (!a || !b || !c || !d) throw new Error('No plots');
  await swipe(session, page, [a, b, d, c]);
  for (const plot of [0, 1, 2, 3]) {
    await expect(screen.locator(`.fa-tag[data-plot="${String(plot)}"]`)).toHaveAttribute(
      'data-crop',
      'woad',
    );
  }
  await expect(seed).toContainText('· 0');

  // Water them: each gauge to its band, then Done.
  await page.getByRole('button', { name: /Water 4 plots/ }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-farming', 'water');
  await expect(screen.locator('.fa-gauge:not([hidden])')).toHaveCount(4);
  for (const plot of [0, 1, 2, 3]) await pour(session, page, plot, woad.band.low + 0.04);
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('.fa-card')).toBeVisible();
  await expect(page.locator('.fa-card')).toContainText('in their band');
  const stars = Number(await screen.getAttribute('data-stars'));
  expect(stars).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Back to the farm' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-farming', 'farm');
  // Watered once a planting: no more Water button.
  await expect(page.getByRole('button', { name: /Water \d/ })).toBeHidden();

  // Time passes (Debug → +30 min counts as time away, which the crops grow on).
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await page.getByRole('button', { name: '+30 min' }).tap();
  await page.getByRole('button', { name: 'Close' }).tap();
  for (const plot of [0, 1, 2, 3]) {
    await expect(screen.locator(`.fa-tag[data-plot="${String(plot)}"]`)).toHaveAttribute(
      'data-ripe',
      'true',
    );
  }

  // Harvest with one swipe: the woad goes into the warchest.
  await swipe(session, page, [a, b, d, c]);
  await expect(screen).toHaveAttribute('data-ripe', '0');
  await expect
    .poll(async () => (await saved(page)).inventory.find((stack) => stack.item === 'woad')?.count)
    .toBeGreaterThanOrEqual(4 * woad.yield);
  // Harvests give crops, not seeds.
  const seeds = (await saved(page)).inventory.find((stack) => stack.item === 'woad_seed');
  expect(seeds?.count ?? 0).toBe(stars >= 3 ? 2 : 0);

  // The logs have the planting, each pour, the stars, growth's end, and the harvests.
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
  const of = (type: string) => exported.events.filter((event) => event.type === type);
  expect(of('farming.starter')).toHaveLength(2);
  expect(of('farming.plant')).toHaveLength(4);
  expect(of('farming.waterStart')[0]?.data?.feel).toBeDefined();
  expect(of('farming.pour').length).toBeGreaterThanOrEqual(4);
  expect(of('farming.pour')[0]?.data).toMatchObject({ plot: 0, crop: 'woad' });
  expect(of('farming.waterEnd')[0]?.data).toMatchObject({ stars });
  expect(of('farming.ripe')).toHaveLength(4);
  expect(of('farming.harvest')).toHaveLength(4);
  expect(errors).toEqual([]);
});
