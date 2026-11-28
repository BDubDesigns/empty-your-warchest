// Screenshots of Debug → Character preview at a phone's size (Playwright's Pixel 7), to judge the
// characters' looks: each guard look beside the captain on High and on Low, mid-way through the
// die and cower clips, close up, and the crowd (every look) on each tier. Prints what each costs
// to draw.
// usage: node tools/characters/shots.mjs <the game's URL, e.g. http://localhost:5173/> <out dir>
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const [url, out] = process.argv.slice(2);
if (!url || !out) throw new Error('usage: node tools/characters/shots.mjs <url> <out dir>');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ ...devices['Pixel 7'] });
page.on('pageerror', (error) => console.error('page error:', error.message));
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.error(`console ${message.type()}:`, message.text());
  }
});
await page.goto(url);
await page.locator('body[data-screen=phaser]').waitFor({ timeout: 60_000 });
await page.getByRole('button', { name: 'Open debug menu' }).click();
await page.getByRole('button', { name: 'Character preview' }).click();
const preview = page.getByRole('dialog', { name: 'Character preview' });
const root = page.locator('#character-preview');

/** Waits for the characters to be loaded and drawn, and the stats to be in. */
async function settled() {
  await page.locator('#character-preview[data-state=ready]').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
}

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  const stats = await preview.getByRole('status').textContent();
  console.log(`${name}: ${stats}`);
}

async function clip(label) {
  await preview.getByRole('group', { name: 'Clips' }).getByRole('button', { name: label }).click();
}

/** Zooms the orbit in or out by wheel notches (negative: in). */
async function zoom(notches) {
  const box = await page.locator('.character-canvas').boundingBox();
  if (!box) return;
  await page.mouse.move(box.width / 2, box.height / 2);
  for (let i = 0; i < Math.abs(notches); i++) {
    await page.mouse.wheel(0, Math.sign(notches) * 100);
  }
}

for (const tier of ['High', 'Low']) {
  await preview
    .getByRole('group', { name: 'Graphics' })
    .getByRole('button', { name: tier })
    .click();
  // Each tier's build starts as a pair.
  if ((await root.getAttribute('data-mode')) === 'crowd') {
    await preview.getByRole('button', { name: 'Crowd' }).click();
  }
  await settled();
  await shot(`${tier.toLowerCase()}-pair`);
  // Each of the guards' looks beside the captain (Look goes round them all, back to the first).
  const look = preview.getByRole('button', { name: /^Look / });
  const looks = Number(/\/(\d+)/.exec((await look.textContent()) ?? '')?.[1] ?? 1);
  for (let index = 1; index <= looks; index++) {
    await look.click();
    if (index === looks) break;
    await settled();
    await shot(`${tier.toLowerCase()}-look-${String(index + 1)}`);
  }
  if (tier === 'High') {
    // Mid-way through a fall and a cower (the clips' frames move on in software: about a second).
    await clip('Die');
    await page.waitForTimeout(1100);
    await shot('high-die');
    await clip('Cower');
    await page.waitForTimeout(1500);
    await shot('high-cower');
    await clip('Alarm');
    await page.waitForTimeout(1200);
    await shot('high-alarm');
    await clip('Idle');
    // Close up: the faces and the armour.
    await zoom(-4);
    await page.waitForTimeout(1500);
    await shot('high-close');
    await zoom(4);
  }
  await preview.getByRole('button', { name: 'Crowd' }).click();
  await settled();
  await page.waitForTimeout(3000);
  await shot(`${tier.toLowerCase()}-crowd`);
  await preview.getByRole('button', { name: 'Crowd' }).click();
}
await browser.close();
