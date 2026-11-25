import { expect, test, type Page } from '@playwright/test';
import { skills } from '../src/data/skills';
import { splitting } from '../src/data/splitting';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const bench = stations.find((station) => station.mechanic === 'splitting');
const feel = splitting.feel;

/** Opens the workbench with `logs` logs in the warchest. */
async function openWorkbench(page: Page, logs: number) {
  if (!bench) throw new Error('No splitting station in data');
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
            inventory: count > 0 ? [{ item: 'log', count }] : [],
            skills: xp,
            lastSeenAt: 1,
            done: ['tutorial.woodcutting'],
          },
        }),
      );
    },
    { count: logs, xp },
  );
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

/** One stroke of the pump: a quick swipe down past the stroke, then the finger lifts. */
async function pump(page: Page) {
  const box = await page.locator('#screen-splitting3d .sp-canvas').boundingBox();
  if (!box) throw new Error('No splitting canvas');
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  const steps = 5;
  const travel = feel.pumpTravel * 1.3;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout(30);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (travel * step) / steps }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
}

test('splits a log into staves that land in the chest', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openWorkbench(page, 3);
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-splitting', 'plan', { timeout: 20_000 });
  // Pick the 4-way head, turn the cuts a step, then strike and pump it through.
  const fourWay = page.getByRole('radio', { name: '4-way head', exact: true });
  await fourWay.tap();
  await expect(fourWay).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.sp-sum')).toContainText('4 staves');
  const turn = page.locator('.sp-turn');
  await expect(turn).toHaveText(/^\d+°$/);
  const before = Number((await turn.textContent())?.replace('°', ''));
  await page.getByRole('button', { name: 'Turn the cuts counter-clockwise' }).tap();
  await expect(turn).toHaveText(`${String((before + 1) % 360)}°`);
  await page.getByRole('button', { name: 'Strike', exact: true }).tap();
  await expect(body).toHaveAttribute('data-splitting', 'pump');
  for (let stroke = 0; stroke < feel.pumpsMany + 2; stroke++) {
    if ((await body.getAttribute('data-splitting')) !== 'pump') break;
    await pump(page);
  }
  await expect(body).toHaveAttribute('data-splitting', 'done', { timeout: 15_000 });
  await expect(page.locator('.sp-card')).toContainText(/\d+ staves?( ×\S+)* = \d+/, {
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
  await expect(page.locator('.sp-card')).toContainText('No logs', { timeout: 20_000 });
});
