import { expect, test, type Page } from '@playwright/test';
import { riving } from '../src/data/riving';
import { stations } from '../src/data/stations';

const bench = stations.find((station) => station.mechanic === 'rive');
const feel = riving.feel;

/** Opens the workbench with `logs` logs in the warchest. */
async function openWorkbench(page: Page, logs: number) {
  if (!bench) throw new Error('No riving station in data');
  await page.addInitScript((count) => {
    // CI renders 3D in software, slowly enough that a steady drag reads as too slow: widen the
    // steady band so the test follows the flow (the lever's feel is unit tested).
    localStorage.setItem(
      'warchest.tuning.riving',
      JSON.stringify({ bandLow: 0.01, bandHigh: 50, bindSeconds: 30 }),
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

/** Drags down steadily, inside the steady band, for one full crack. */
async function leverSteadily(page: Page) {
  const box = await page.locator('#screen-rive3d .rv-canvas').boundingBox();
  if (!box) throw new Error('No riving canvas');
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.35;
  const steps = 12;
  // About one log length a second: the middle of the band.
  const seconds = 1 / ((feel.bandLow + feel.bandHigh) / 2);
  const travel = feel.leverTravel * 1.1;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout((seconds * 1000) / steps);
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
  await expect(body).toHaveAttribute('data-riving', 'aim', { timeout: 20_000 });
  // Seven splits make 8 staves (strike again if a crack binds).
  for (let turn = 0; turn < 20; turn++) {
    const phase = await body.getAttribute('data-riving');
    if (phase === 'done') break;
    if (phase === 'aim' || phase === 'bound') {
      await page.getByRole('button', { name: /^Strike/ }).tap();
      await expect(body).toHaveAttribute('data-riving', 'lever');
    }
    await leverSteadily(page);
    await expect(body).not.toHaveAttribute('data-riving', 'lever', { timeout: 10_000 });
  }
  await expect(body).toHaveAttribute('data-riving', 'done');
  await expect(page.locator('.rv-card')).toContainText(/\d+ staves? = \d+/);
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
