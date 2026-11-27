// Screenshots of Debug → Castle preview at a phone's size (Playwright's Pixel 7), to judge the
// castle's looks: the orbit and each vantage point on High, and the orbit on Low. Prints what each
// tier costs to draw.
// usage: node tools/castle/shots.mjs <the game's URL, e.g. http://localhost:5173/> <out dir>
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const [url, out] = process.argv.slice(2);
if (!url || !out) throw new Error('usage: node tools/castle/shots.mjs <url> <out dir>');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ ...devices['Pixel 7'] });
page.on('pageerror', (error) => console.error('page error:', error.message));
await page.goto(url);
await page.locator('body[data-screen=phaser]').waitFor({ timeout: 60_000 });
await page.getByRole('button', { name: 'Open debug menu' }).click();
await page.getByRole('button', { name: 'Castle preview' }).click();
const preview = page.getByRole('dialog', { name: 'Castle preview' });

/** Waits for the scene to be built and drawn, and the camera to settle. */
async function settled() {
  await page.locator('#castle-preview[data-state=ready]').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
}

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  const stats = await preview.getByRole('status').textContent();
  console.log(`${name}: ${stats}`);
}

for (const tier of ['High', 'Low']) {
  await preview
    .getByRole('group', { name: 'Graphics' })
    .getByRole('button', { name: tier })
    .click();
  await settled();
  await preview.getByRole('button', { name: 'Orbit' }).click();
  await page.waitForTimeout(2000);
  await shot(`${tier.toLowerCase()}-orbit`);
  if (tier === 'Low') break;
  const names = await preview
    .getByRole('group', { name: 'Views' })
    .getByRole('button')
    .allTextContents();
  for (const name of names.filter((label) => label !== 'Orbit')) {
    await preview.getByRole('button', { name }).click();
    await page.waitForTimeout(2500);
    await shot(`${tier.toLowerCase()}-${name.toLowerCase().replace(/\W+/g, '-')}`);
  }
  // A closer look from the other side, dragged round.
  await preview.getByRole('button', { name: 'Orbit' }).click();
  await page.waitForTimeout(1500);
  const box = await page.locator('.castle-canvas').boundingBox();
  if (box) {
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.width / 2 + 160, box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(1500);
    await shot(`${tier.toLowerCase()}-orbit-turned`);
  }
}
await browser.close();
