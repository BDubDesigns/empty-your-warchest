// Screenshots of the siege at a phone's size (Playwright's Pixel 7): each vantage point on High,
// the low ground on Low, a Sense potion's outlines, and a collapse as it falls. Prints what each
// view costs to draw (draw calls, triangles, texture memory).
// usage: node tools/siege/shots.mjs <the game's URL, e.g. http://localhost:5173/> <out dir>
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const [url, out] = process.argv.slice(2);
if (!url || !out) throw new Error('usage: node tools/siege/shots.mjs <url> <out dir>');
await mkdir(out, { recursive: true });

// The War tent's spot in the camp, and every skill (all at 0, so the save fits the data).
const stations = await readFile(new URL('../../src/data/stations.ts', import.meta.url), 'utf8');
const tent = /id: 'war_tent'[\s\S]*?camp: \{ x: ([\d.]+), y: ([\d.]+) \}/.exec(stations);
if (!tent) throw new Error('No war tent in src/data/stations.ts');
const skillsText = await readFile(new URL('../../src/data/skills.ts', import.meta.url), 'utf8');
const skills = [...skillsText.matchAll(/id: '([a-z_]+)'/g)].map((match) => match[1]);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** A page at the War tent, drawn at `tier`. */
async function openTent(tier) {
  const page = await browser.newPage({ ...devices['Pixel 7'] });
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.addInitScript(
    ({ tier, skills }) => {
      localStorage.setItem('warchest.graphics', tier);
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: {
            inventory: [
              { item: 'spear', count: 400 },
              { item: 'sense_potion', count: 2 },
            ],
            skills: Object.fromEntries(skills.map((skill) => [skill, 0])),
            lastSeenAt: Date.now(),
            done: ['tutorial.woodcutting'],
          },
        }),
      );
    },
    { tier, skills },
  );
  await page.goto(url);
  await page.locator('body[data-view=camp]').waitFor({ timeout: 60_000 });
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  await page.touchscreen.tap(
    camp.x + camp.width * Number(tent[1]),
    camp.y + camp.height * Number(tent[2]),
  );
  await page.locator('body[data-siege=aim]').waitFor({ timeout: 120_000 });
  await page.locator('#screen-siege3d[data-draw-calls]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  const view = page.locator('#screen-siege3d');
  const [calls, triangles, textures] = await Promise.all(
    ['data-draw-calls', 'data-triangles', 'data-texture-mb'].map((key) => view.getAttribute(key)),
  );
  console.log(
    `${name}: ${calls} draws · ${Math.round(Number(triangles) / 1000)}k tris · ${textures} MB textures`,
  );
}

async function vantage(page, name) {
  await page.getByRole('radio', { name }).click();
  await page.waitForTimeout(1500);
}

/** Where the round's targets of `kind` are on screen. */
async function targets(page, kind) {
  const list = JSON.parse(
    (await page.locator('#screen-siege3d').getAttribute('data-targets')) ?? '[]',
  );
  return list.filter((target) => target.kind === kind && target.on);
}

/** Drags the crosshair to (x, y) on the view. */
async function aimAt(page, x, y) {
  const [cx, cy] = ((await page.locator('#screen-siege3d').getAttribute('data-aim')) ?? '0 0')
    .split(' ')
    .map(Number);
  const box = await page.locator('#screen-siege3d .sg-canvas').boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height * 0.45;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + (x - cx), startY + (y - cy), { steps: 8 });
  await page.mouse.up();
}

async function fire(page) {
  const button = page.getByRole('button', { name: 'Fire' });
  await button.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('#screen-siege3d .sg-fire')?.hasAttribute('disabled'),
  );
  await button.click();
}

const high = await openTent('high');
for (const name of ['Hill', 'Low ground', 'Siege tower']) {
  await vantage(high, name);
  await shot(high, `high-${name.toLowerCase().replace(/\W+/g, '-')}`);
}
// A Sense potion: every guard's outline in red through the walls.
await vantage(high, 'Siege tower');
await high.getByRole('button', { name: /Sense/ }).click();
await high.waitForTimeout(800);
await shot(high, 'high-sense');
// A collapse: two volleys low on the wall under a guard on the battlement, from the hill.
await vantage(high, 'Hill');
// Under a guard on the walk if one's in view, else low on the front wall in the middle of the view.
const [guard] = await targets(high, 'guard');
const size = high.viewportSize();
const spot = guard
  ? { x: guard.x, y: guard.y + 150 }
  : { x: size.width * 0.5, y: size.height * 0.675 };
await aimAt(high, spot.x, spot.y);
await fire(high);
await high.waitForTimeout(2500);
await fire(high);
for (let index = 0; index < 4; index++) {
  await high.waitForTimeout(350);
  await shot(high, `high-collapse-${String(index)}`);
}
await high.close();

const low = await openTent('low');
await vantage(low, 'Low ground');
await shot(low, 'low-low-ground');
await vantage(low, 'Hill');
await shot(low, 'low-hill');
await low.close();
await browser.close();
