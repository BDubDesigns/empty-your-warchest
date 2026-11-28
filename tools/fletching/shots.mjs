// Screenshots of the fletcher's bench at a phone's size (Playwright's Pixel 7), to judge its looks:
// the batch picker, the tar dip, the feathers going on, the batch pouring in and the end card, the
// picker again with a hot streak, a duster batch from the bucket on High, and the bench on Low.
// Prints what each costs to draw (draw calls, triangles, texture MB).
// usage: node tools/fletching/shots.mjs <the game's URL, e.g. http://localhost:5173/> <out dir> [level]
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const [url, out, levelArg] = process.argv.slice(2);
if (!url || !out) throw new Error('usage: node tools/fletching/shots.mjs <url> <out dir> [level]');
await mkdir(out, { recursive: true });
const level = Number(levelArg ?? 20);

/** Total XP for `level`, by the curve in src/data/tuning.ts (xpCurve; keep the two the same). */
function xpForLevel(target) {
  const curve = { base: 300, doublingLevels: 7, divisor: 4 };
  let points = 0;
  let xp = 0;
  for (let next = 2; next <= target; next++) {
    const n = next - 1;
    points += Math.floor(n + curve.base * 2 ** (n / curve.doublingLevels));
    xp = Math.floor(points / curve.divisor);
  }
  return xp;
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** A phone with these in the warchest, on this graphics tier, at the bench. */
async function openBench(tier) {
  const page = await browser.newPage({ ...devices['Pixel 7'] });
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.addInitScript(
    ({ tier, fletchingXp }) => {
      const skills = [
        'woodcutting',
        'splitting',
        'firemaking',
        'command',
        'alchemy',
        'archery',
        'fletching',
      ];
      localStorage.setItem('warchest.graphics', tier);
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: {
            inventory: [
              { item: 'stave', count: 60 },
              { item: 'feather', count: 400 },
            ],
            skills: {
              ...Object.fromEntries(skills.map((skill) => [skill, 0])),
              fletching: fletchingXp,
            },
            lastSeenAt: Date.now(),
            done: ['tutorial.woodcutting'],
          },
        }),
      );
    },
    { tier, fletchingXp: xpForLevel(level) },
  );
  await page.goto(url);
  await page.locator('body[data-view=camp]').waitFor({ timeout: 60_000 });
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  await page.touchscreen.tap(camp.x + camp.width * 0.73, camp.y + camp.height * 0.62);
  await page.locator('body[data-fletching=make]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  const screen = page.locator('#screen-fletching3d');
  const [calls, triangles, mb] = await Promise.all(
    ['data-calls', 'data-triangles', 'data-texture-mb'].map((name) => screen.getAttribute(name)),
  );
  console.log(`${name}: ${calls} draw calls, ${triangles} triangles, ${mb} MB of textures`);
}

/** Touches the middle of the screen and drags down, holding there. */
async function press(page) {
  const session = await page.context().newCDPSession(page);
  const box = await page.locator('.fl-canvas').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.5;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + step * 16 }],
    });
    await page.waitForTimeout(20);
  }
  return {
    release: () => session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  };
}

/** Holds the shaft in the tar until its level is at `level`. */
async function dipTo(page, level, name) {
  const finger = await press(page);
  await page.waitForFunction(
    (level) => Number(document.querySelector('#screen-fletching3d')?.dataset.tar ?? 0) >= level,
    level,
  );
  if (name) await shot(page, name);
  await finger.release();
}

/** Taps the feathers on as the marks come up (the turn is in the data-turn attribute). */
async function tapFeathers(page, name) {
  for (let feather = 0; feather < 3; feather++) {
    await page.waitForFunction(() => {
      const turn = Number(document.querySelector('#screen-fletching3d')?.dataset.turn ?? 0);
      const off = ((turn % 120) + 120) % 120;
      return off > 104 && off < 116;
    });
    await page.touchscreen.tap(200, 500);
    if (feather === 1 && name) await shot(page, name);
    await page.waitForTimeout(150);
  }
}

/** One careful round; true if it was 3 stars. */
async function carefulRound(page, names = {}) {
  // The band starts at 0.48: lifting as it gets there leaves room for a slow phone's lag.
  await dipTo(page, 0.48, names.dip);
  await page.waitForTimeout(500);
  if (names.jig) await shot(page, names.jig);
  await tapFeathers(page, names.taps);
  await page.waitForTimeout(450);
  if (names.pour) await shot(page, names.pour);
  await page.locator('.fl-card').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(900);
  if (names.card) await shot(page, names.card);
  return (await page.locator('.fl-card .w3d-star-on').count()) === 3;
}

async function again(page) {
  await page.getByRole('button', { name: 'Fletch again' }).tap();
  await page.locator('#screen-fletching3d[data-step=shaft]').waitFor();
  await page.waitForTimeout(700);
}

const high = await openBench('high');
await shot(high, 'high-picker');
let streaked = await carefulRound(high, {
  dip: 'high-tar-dip',
  jig: 'high-feathers-jig',
  taps: 'high-feather-taps',
  pour: 'high-batch-pour',
  card: 'high-end-card',
});
// Careful rounds until one is 3 stars, for the picker with a hot streak on it.
for (let tries = 0; !streaked && tries < 6; tries++) {
  await again(high);
  streaked = await carefulRound(high);
}
await again(high);
await shot(high, streaked ? 'high-picker-streak' : 'high-picker-no-streak');
// A second 3 stars: ×3, then the pour of the biggest batch.
if (streaked) {
  const third = await carefulRound(high, { pour: 'high-streak-pour', card: 'high-streak-card' });
  if (third) {
    await again(high);
    await shot(high, 'high-picker-streak-3');
  } else await again(high);
}
// The bucket: tar it, then shove it in.
await dipTo(high, 0.52);
await high.waitForTimeout(500);
await high.getByRole('button', { name: /Bucket/ }).tap();
await high.waitForTimeout(330);
await shot(high, 'high-bucket-duster');
await high.locator('.fl-card').waitFor({ state: 'visible', timeout: 30_000 });
await high.waitForTimeout(900);
await shot(high, 'high-bucket-card');
await high.close();

const low = await openBench('low');
await shot(low, 'low-picker');
await dipTo(low, 0.52, 'low-tar-dip');
await low.waitForTimeout(900);
await shot(low, 'low-feathers-jig');
await low.close();
await browser.close();
