import { expect, test, type Page } from '@playwright/test';
import { riving } from '../src/data/riving';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const bench = stations.find((station) => station.mechanic === 'rive');
const feel = riving.feel;

/** Opens the workbench with `logs` logs in the warchest. */
async function openWorkbench(page: Page, logs: number) {
  if (!bench) throw new Error('No riving station in data');
  await page.addInitScript((count) => {
    // A steady test hand: no wander, so the test follows the flow (steering is unit tested).
    localStorage.setItem(
      'warchest.tuning.riving',
      JSON.stringify({ wobble: 0, wobblePerStave: 0, knotJitter: 0 }),
    );
    localStorage.setItem(
      'warchest.save',
      JSON.stringify({
        version: 1,
        savedAt: 1,
        state: {
          inventory: count > 0 ? [{ item: 'log', count }] : [],
          skills: { woodcutting: 0, fletching: 0, command: 0 },
          lastSeenAt: 1,
          done: ['tutorial.woodcutting'],
        },
      }),
    );
  }, logs);
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(
    camp.x + camp.width * bench.camp.x,
    camp.y + camp.height * bench.camp.y,
  );
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${bench.id}`);
}

/** Pulls the lever down the whole way in about a second (the head follows at its own pace). */
async function pullDown(page: Page) {
  const box = await page.locator('#screen-rive3d .rv-canvas').boundingBox();
  if (!box) throw new Error('No riving canvas');
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  const steps = 12;
  const travel = feel.leverTravel * 1.1;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout(1000 / steps);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (travel * step) / steps }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('rives a log into staves that land in the chest', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openWorkbench(page, 3);
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-riving', 'plan', { timeout: 20_000 });
  // Pick the 4-way head, then strike and pull it through.
  const fourWay = page.getByRole('radio', { name: '4-way head', exact: true });
  await fourWay.tap();
  await expect(fourWay).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.rv-sum')).toContainText('4 staves');
  await page.getByRole('button', { name: 'Strike', exact: true }).tap();
  await expect(body).toHaveAttribute('data-riving', 'press');
  await pullDown(page);
  await expect(body).toHaveAttribute('data-riving', 'done', { timeout: 15_000 });
  await expect(page.locator('.rv-card')).toContainText(/\d+ staves?( ×\S+)* = \d+/, {
    timeout: 10_000,
  });
  // The staves pour into the chest.
  await expect(page.locator('.warchest-hud')).toHaveAttribute('data-settled', 'true', {
    timeout: 20_000,
  });
  const staves = Number(await page.locator('.warchest-hud').getAttribute('data-count'));
  expect(staves).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('with no logs the workbench says so', async ({ page }) => {
  await openWorkbench(page, 0);
  await expect(page.locator('.rv-card')).toContainText('No logs', { timeout: 20_000 });
});
