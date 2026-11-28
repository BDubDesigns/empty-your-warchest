// Screenshots of the fletcher's bench at a phone's size (Playwright's Pixel 7), to judge its looks:
// the tar dip, the feathers going on, a duster from the bucket and the end card on High, and the
// bench on Low. Prints what each costs to draw (draw calls, triangles, texture MB).
// usage: node tools/fletching/shots.mjs <the game's URL, e.g. http://localhost:5173/> <out dir>
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const [url, out] = process.argv.slice(2);
if (!url || !out) throw new Error('usage: node tools/fletching/shots.mjs <url> <out dir>');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** A phone with these in the warchest, on this graphics tier, at the bench. */
async function openBench(tier) {
  const page = await browser.newPage({ ...devices['Pixel 7'] });
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.addInitScript((tier) => {
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
            { item: 'stave', count: 6 },
            { item: 'feather', count: 40 },
          ],
          skills: Object.fromEntries(skills.map((skill) => [skill, 0])),
          lastSeenAt: Date.now(),
          done: ['tutorial.woodcutting'],
        },
      }),
    );
  }, tier);
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

/** Touches the middle of the screen and drags down `pull` px, holding there. */
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

const high = await openBench('high');
await shot(high, 'high-bench');
await dipTo(high, 0.52, 'high-tar-dip');
await high.waitForTimeout(900);
await shot(high, 'high-feathers-jig');
// Tap the feathers on as the marks come up (the turn is in the data-turn attribute).
for (let feather = 0; feather < 3; feather++) {
  await high.waitForFunction(() => {
    const turn = Number(document.querySelector('#screen-fletching3d')?.dataset.turn ?? 0);
    const off = ((((turn % 120) + 120) % 120) + 120) % 120;
    return off > 96 && off < 110;
  });
  await high.touchscreen.tap(200, 500);
  if (feather === 1) await shot(high, 'high-feather-taps');
  await high.waitForTimeout(150);
}
await high.waitForTimeout(250);
await shot(high, 'high-fletched');
await high.waitForTimeout(800);
// The bucket: tar it, then shove it in.
await dipTo(high, 0.52);
await high.waitForTimeout(500);
await high.getByRole('button', { name: /Bucket/ }).tap();
await high.waitForTimeout(330);
await shot(high, 'high-bucket-duster');
await high.waitForTimeout(1500);
// Bare ones for the rest of the shafts, to the end card.
for (let index = 0; index < 20; index++) {
  const done = await high.locator('body[data-fletching=done]').count();
  if (done) break;
  const bare = high.getByRole('button', { name: 'Bare' });
  if (await bare.isVisible()) await bare.tap();
  await high.waitForTimeout(600);
}
await high.locator('.fl-card').waitFor({ state: 'visible', timeout: 60_000 });
await high.waitForTimeout(800);
await shot(high, 'high-end-card');
await high.close();

const low = await openBench('low');
await shot(low, 'low-bench');
await dipTo(low, 0.52, 'low-tar-dip');
await low.waitForTimeout(900);
await shot(low, 'low-feathers-jig');
await low.close();
await browser.close();
