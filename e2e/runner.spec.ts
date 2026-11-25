import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { stations } from '../src/data/stations';

const tent = stations.find((station) => station.mechanic === 'runner');

async function tapCampSpot(page: Page, spot: { x: number; y: number }): Promise<void> {
  const box = await page.locator('#screen-phaser canvas').boundingBox();
  if (!box) throw new Error('Camp canvas has no size');
  await page.touchscreen.tap(box.x + box.width * spot.x, box.y + box.height * spot.y);
}

const phase = (page: Page) => page.evaluate(() => document.body.dataset.runner);

test('Attack Run: steer through gates, clash, break the wall, see results, run again', async ({
  page,
}) => {
  // Headless browsers render 3D in software, so a run takes a while.
  test.setTimeout(150_000);
  if (!tent) throw new Error('No runner station in data');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // A fast run with plenty of free debug spears, through the debug options and sliders.
  await page.addInitScript(() => {
    localStorage.setItem('warchest.runner.spears', 'sliders');
    localStorage.setItem('warchest.runner.lift', 'run');
    localStorage.setItem(
      'warchest.tuning.runner',
      JSON.stringify({ runSpeed: 25, spearsPerfect: 100, tradeSeconds: 0.05 }),
    );
  });
  await page.goto('/');
  await tapCampSpot(page, tent.camp);
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'three');
  await expect(page.locator('.runner-hint')).toBeVisible();
  await expect.poll(() => phase(page)).toBe('ready');
  // Every run starts with one guy.
  await expect(page.locator('.runner-label')).toHaveText('1 (1 armed)');
  await expect(page.locator('.runner-hint')).toContainText('spears from debug');

  // Touch and slide left: relative drag steers toward the left gates.
  const canvas = await page.locator('#screen-three canvas').boundingBox();
  if (!canvas) throw new Error('Runner canvas has no size');
  const client = await page.context().newCDPSession(page);
  const y = canvas.y + canvas.height * 0.7;
  const start = canvas.x + canvas.width * 0.6;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start, y }],
  });
  for (let step = 1; step <= 6; step++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start - (canvas.width * 0.4 * step) / 6, y }],
    });
  }
  await expect(page.locator('.runner-hint')).toBeHidden();
  // The first gate recruits more.
  await expect(page.locator('.runner-label')).not.toHaveText('1 (1 armed)', { timeout: 30_000 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  // The pause button stops everything until you tap to resume.
  await page.getByRole('button', { name: 'Pause' }).tap();
  await expect(page.locator('.runner-paused')).toBeVisible();
  const label = await page.locator('.runner-label').textContent();
  await page.waitForTimeout(600);
  await expect(page.locator('.runner-label')).toHaveText(label ?? '');
  await page.locator('.runner-paused').tap();
  await expect(page.locator('.runner-paused')).toBeHidden();

  const results = page.locator('.runner-results');
  await expect(results).toBeVisible({ timeout: 120_000 });
  await expect(results).toContainText('Survivors');
  await expect(results).toContainText('Spears used');
  await results.getByRole('button', { name: 'Run again' }).tap();
  await expect(results).toBeHidden();
  await expect.poll(() => phase(page)).toBe('running');

  // The run is logged for playtest data.
  await page.locator('#back-button').tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const download = page.getByRole('button', { name: 'Download logs' });
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string }[];
  };
  const types = exported.events.map((event) => event.type);
  for (const type of [
    'runner.start',
    'runner.gate',
    'runner.clash',
    'runner.result',
    'runner.quit',
  ]) {
    expect(types).toContain(type);
  }
  expect(errors).toEqual([]);
});

test('Attack Run: with an empty warchest, it says your recruits will fight unarmed', async ({
  page,
}) => {
  if (!tent) throw new Error('No runner station in data');
  await page.goto('/');
  await tapCampSpot(page, tent.camp);
  await expect(page.locator('.runner-hint')).toContainText('No spears in the warchest');
  await expect(page.locator('.runner-label')).toHaveText('1 (0 armed)');
});
