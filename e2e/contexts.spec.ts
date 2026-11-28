import { expect, test, type Page } from '@playwright/test';
import { stations } from '../src/data/stations';

/**
 * Phones allow only a few live WebGL contexts (Android Chrome about 8; desktop Chrome 16). Past
 * that the browser takes the oldest one away, which is the camp's, and the camp comes back white.
 * This fills most of desktop Chrome's allowance with contexts of its own after the camp loads, so
 * the camp is the oldest, then goes in and out of every station (the siege most) and checks the
 * camp still draws and the game's live contexts don't grow.
 */

/** Contexts this test holds open, leaving the game about a phone's allowance. */
const FILLER = 8;
/** Live contexts the game may hold at the camp: its own, and none left behind by the stations. */
const AT_CAMP = 1;

async function viewIs(page: Page, view: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-view', view, { timeout: 30_000 });
}

async function tapCampSpot(page: Page, spot: { x: number; y: number }): Promise<void> {
  const box = await page.locator('#screen-phaser canvas').boundingBox();
  if (!box) throw new Error('Camp canvas has no size');
  await page.touchscreen.tap(box.x + box.width * spot.x, box.y + box.height * spot.y);
}

/**
 * Taps a station at the camp until it opens. Over a long test (CI draws in software) a worker
 * makes something, and its Collect button comes up where the tap lands: that tap collects, and
 * the next one opens the station, as it would for a player.
 */
async function enter(page: Page, station: { id: string; camp: { x: number; y: number } }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await tapCampSpot(page, station.camp);
    const opened = await expect(page.locator('body'))
      .toHaveAttribute('data-view', `station:${station.id}`, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  await viewIs(page, `station:${station.id}`);
}

/**
 * The game's WebGL contexts (not this test's) on the page and still live. Phaser's one-off probe
 * for WebGL support isn't on the page; it's older than the camp's, so it would go first anyway.
 */
function liveContexts(page: Page): Promise<number> {
  return page.evaluate(() => {
    const seen = (window as unknown as { glSeen: { gl: WebGLRenderingContext; filler: boolean }[] })
      .glSeen;
    return seen.filter(
      (entry) =>
        !entry.filler &&
        !entry.gl.isContextLost() &&
        entry.gl.canvas instanceof HTMLCanvasElement &&
        entry.gl.canvas.isConnected,
    ).length;
  });
}

/** How many colours the camp is drawn in: a camp that's lost its context is one flat colour. */
async function campColours(page: Page): Promise<number> {
  const shot = (await page.locator('#screen-phaser canvas').screenshot()).toString('base64');
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.drawImage(image, 0, 0, 64, 64);
    const { data } = context.getImageData(0, 0, 64, 64);
    const colours = new Set<number>();
    for (let index = 0; index < data.length; index += 4) {
      colours.add(
        ((data[index] ?? 0) >> 4) * 256 +
          ((data[index + 1] ?? 0) >> 4) * 16 +
          ((data[index + 2] ?? 0) >> 4),
      );
    }
    return colours.size;
  }, shot);
}

test('going in and out of the stations many times keeps the camp drawing', async ({ page }) => {
  // Software 3D on CI, and a dozen station visits (the siege's castle the heaviest).
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('warchest.woodcutting.treeStyle', 'kenney');
    localStorage.setItem('warchest.woodcutting.scenery', 'off');
    // Every WebGL context made on the page, the game's and this test's.
    const seen: { gl: WebGLRenderingContext; filler: boolean }[] = [];
    (window as unknown as { glSeen: typeof seen }).glSeen = seen;
    const prototype = HTMLCanvasElement.prototype as unknown as {
      getContext: (this: HTMLCanvasElement, kind: string, options?: unknown) => unknown;
    };
    const original = prototype.getContext;
    prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: unknown) {
      const context = original.call(this, kind, options);
      if (context && kind.startsWith('webgl') && !seen.some((entry) => entry.gl === context)) {
        seen.push({ gl: context as WebGLRenderingContext, filler: this.dataset.filler === 'true' });
      }
      return context;
    };
  });
  await page.goto('/');
  await viewIs(page, 'camp');
  await expect.poll(() => campColours(page)).toBeGreaterThan(20);
  const drawn = await campColours(page);
  // Fill up, so the camp's context is now the oldest the browser could take.
  await page.evaluate((count) => {
    for (let index = 0; index < count; index++) {
      const canvas = document.createElement('canvas');
      canvas.dataset.filler = 'true';
      canvas.width = canvas.height = 1;
      canvas.getContext('webgl2')?.clear(0);
    }
  }, FILLER);
  expect(await liveContexts(page)).toBeLessThanOrEqual(AT_CAMP);

  const siege = stations.find((station) => station.mechanic === 'siege');
  if (!siege) throw new Error('No siege station in data');
  const back = page.locator('#back-button');
  const visits = [...stations, siege, siege, ...stations, siege, siege];
  for (const station of visits) {
    await enter(page, station);
    if (station.mechanic === 'woodcutting3d') {
      await expect(back).toHaveText('End round');
      await back.tap();
      await page.locator('.w3d-summary').getByRole('button', { name: 'Back to camp' }).tap();
    } else {
      await back.tap();
    }
    await viewIs(page, 'camp');
    expect(await liveContexts(page), `live contexts after ${station.id}`).toBeLessThanOrEqual(
      AT_CAMP,
    );
  }
  // The camp still draws, about as it did at the start.
  await expect.poll(() => campColours(page)).toBeGreaterThan(drawn / 2);
  await page.screenshot({ path: test.info().outputPath('camp-after-visits.png') });
  // And each screen still draws on its next visit, its context given back.
  await enter(page, siege);
  await expect(page.locator('body')).toHaveAttribute('data-siege', 'aim', { timeout: 30_000 });
  expect(await liveContexts(page)).toBeLessThanOrEqual(AT_CAMP + 2);
  expect(errors).toEqual([]);
});
