import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { stations } from '../src/data/stations';

const tile = stations.find((station) => station.id === 'tree_line');

async function touch(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  holdMs = 0,
) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 6; step++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 },
      ],
    });
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

const phase = (page: Page) => page.evaluate(() => document.body.dataset.woodcutting);

test('3D woodcutting: aim, Chop, chop in the close-up, the tree falls, logs to the warchest', async ({
  page,
}) => {
  // Headless browsers render 3D in software, so a full round takes a while.
  test.setTimeout(120_000);
  if (!tile) throw new Error('No 3D tree line in data');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The simpler trees: the detailed ones (and carving them) are slow in software rendering.
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(camp.x + camp.width * tile.camp.x, camp.y + camp.height * tile.camp.y);
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'wood3d');
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'pick', {
    timeout: 20_000,
  });

  // The view publishes where each standing tree is on screen.
  await page.waitForFunction(() => document.getElementById('screen-wood3d')?.dataset.trees);
  const positions = JSON.parse(
    (await page.evaluate(() => document.getElementById('screen-wood3d')?.dataset.trees)) ?? '{}',
  ) as Record<string, [number, number]>;
  const a1 = positions.a1;
  const a2 = positions.a2;
  if (!a1 || !a2) throw new Error('Trees a1 and a2 not on screen');
  const length = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]);
  await touch(
    page,
    { x: a1[0], y: a1[1] },
    { x: a1[0] - ((a2[0] - a1[0]) / length) * 60, y: a1[1] - ((a2[1] - a1[1]) / length) * 60 },
  );
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'aim');
  await page.getByRole('button', { name: 'Chop' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', 'chop');

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport');
  const grab = { x: viewport.width / 2, y: viewport.height * 0.45 };
  for (let chops = 0; chops < 40 && (await phase(page)) === 'chop'; chops++) {
    await touch(page, grab, { x: grab.x + 60, y: grab.y + 90 }, (chops * 173) % 900);
    await page.waitForTimeout(250);
  }
  await expect(page.locator('body')).toHaveAttribute('data-woodcutting', /pick|cleared/, {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await expect(page.getByText(/^Log × \d+$/)).toBeVisible();
  const download = page.getByRole('button', { name: 'Download logs' });
  await expect(download).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  const roundStart = exported.events.find((event) => event.type === 'woodcutting.roundStart');
  expect(roundStart?.data?.view).toBe('3d');
  const types = exported.events.map((event) => event.type);
  for (const type of [
    'woodcutting.aim',
    'woodcutting.chop',
    'woodcutting.fell',
    'woodcutting.bank',
    'woodcutting3d.perf',
  ]) {
    expect(types).toContain(type);
  }
  expect(errors).toEqual([]);
});
