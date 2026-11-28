// Screenshots of the siege at a phone's size (Playwright's Pixel 7): each vantage point as it
// starts and turned all the way left and right, the follow shot behind a spear, the spear rack's
// gold, a Sense potion's outlines, a wrecked wall, a collapsed tower, the alarm (guards panicking
// and hiding, the runner, the bell and its timer, the captain at a window after it), the end card
// for each number of stars, and the Low tier. Prints what each view costs to draw (draw calls,
// triangles, texture memory).
// usage: node tools/siege/shots.mjs <the game's URL, e.g. http://localhost:5173/> <out dir> [parts]
// `parts`: some of castle,tower,low,guards,boxes,keep,alarm,stars (all by default; drawn in
// software, each takes minutes).
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const [url, out, parts] = process.argv.slice(2);
const want = (part) => !parts || parts.split(',').includes(part);
if (!url || !out) throw new Error('usage: node tools/siege/shots.mjs <url> <out dir>');
await mkdir(out, { recursive: true });

// The War tent's spot in the camp, every skill (all at 0, so the save fits the data), and how far
// the view turns for a pixel dragged.
const read = (path) => readFile(new URL(`../../src/data/${path}`, import.meta.url), 'utf8');
const tent = /id: 'war_tent'[\s\S]*?camp: \{ x: ([\d.]+), y: ([\d.]+) \}/.exec(
  await read('stations.ts'),
);
if (!tent) throw new Error('No war tent in src/data/stations.ts');
const skills = [...(await read('skills.ts')).matchAll(/id: '([a-z_]+)'/g)].map((match) => match[1]);
const aimPerPx = Number(/aimPerPx: ([\d.]+)/.exec(await read('siege.ts'))?.[1] ?? 1);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/**
 * A page at the War tent, drawn at `tier` (with the guards' hit boxes drawn, if `boxes`), the
 * siege's feel with `tuning` changed (as Debug's sliders leave it).
 */
async function openTent(tier, boxes = false, tuning = {}) {
  const page = await browser.newPage({ ...devices['Pixel 7'] });
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.addInitScript(
    ({ tier, skills, boxes, tuning }) => {
      localStorage.setItem('warchest.tuning.siege', JSON.stringify(tuning));
      localStorage.setItem('warchest.graphics', tier);
      localStorage.setItem('warchest.siege.hitBoxes', boxes ? 'on' : 'off');
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
    { tier, skills, boxes, tuning },
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

const view = (page) => page.locator('#screen-siege3d');

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  const [calls, triangles, textures, aim] = await Promise.all(
    ['data-draw-calls', 'data-triangles', 'data-texture-mb', 'data-aim'].map((key) =>
      view(page).getAttribute(key),
    ),
  );
  console.log(
    `${name}: ${calls} draws · ${Math.round(Number(triangles) / 1000)}k tris · ${textures} MB textures · turned ${aim}`,
  );
}

async function vantage(page, name) {
  await page.getByRole('radio', { name }).click();
  await page.waitForTimeout(1500);
}

/** The camera back at the vantage point (a tap skips the follow shot or a kill look). */
async function settle(page, skip = true) {
  const canvas = await page.locator('#screen-siege3d .sg-canvas').boundingBox();
  if (skip && (await view(page).getAttribute('data-camera')) !== 'vantage') {
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.4);
  }
  await page.locator('#screen-siege3d[data-camera=vantage]').waitFor({ timeout: 60_000 });
}

/** Drags the view by (dx, dy) px, in strokes that stay on the canvas. */
async function drag(page, dx, dy) {
  const box = await page.locator('#screen-siege3d .sg-canvas').boundingBox();
  const strokes = Math.max(1, Math.ceil(Math.max(Math.abs(dx) / 280, Math.abs(dy) / 280)));
  for (let stroke = 0; stroke < strokes; stroke++) {
    const startX = box.x + box.width / 2 - dx / strokes / 2;
    const startY = box.y + box.height * 0.45 - dy / strokes / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dx / strokes, startY + dy / strokes, { steps: 6 });
    await page.mouse.up();
  }
}

/** Where the round's targets of `kind` are on screen (off its edges too), doing `mood` if given. */
async function targets(page, kind, mood) {
  const list = JSON.parse((await view(page).getAttribute('data-targets')) ?? '[]');
  return list.filter((target) => target.kind === kind && (!mood || target.mood === mood));
}

/**
 * Turns the view until the first target of `kind` is under the crosshair (`below` px under it, to
 * aim lower than the target). Returns false if there's none.
 */
async function aimAt(page, kind, below = 0, mood = undefined) {
  const size = page.viewportSize();
  for (let tries = 0; tries < 8; tries++) {
    await page.waitForTimeout(400);
    const [target] = await targets(page, kind, mood);
    if (!target) return false;
    const dx = target.x - size.width / 2;
    const dy = target.y + below - size.height / 2;
    if (Math.hypot(dx, dy) < 4) return true;
    await drag(page, dx / aimPerPx, dy / aimPerPx);
  }
  return true;
}

async function fire(page, mode = 'Aimed') {
  await page.getByRole('radio', { name: new RegExp(mode) }).click();
  const button = page.getByRole('button', { name: 'Fire' });
  await button.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('#screen-siege3d .sg-fire')?.hasAttribute('disabled'),
  );
  await button.click();
}

const slug = (name) => name.toLowerCase().replace(/\W+/g, '-');

if (want('castle')) {
  const high = await openTent('high');
  // Each vantage point as it starts, then turned all the way left and all the way right.
  for (const name of ['Hill', 'Low ground', 'Siege tower']) {
    await vantage(high, name);
    await shot(high, `high-${slug(name)}`);
    await drag(high, -1400, 0);
    await high.waitForTimeout(400);
    await shot(high, `high-${slug(name)}-left`);
    await drag(high, 2800, 0);
    await high.waitForTimeout(400);
    await shot(high, `high-${slug(name)}-right`);
    await drag(high, -1400, 0);
  }
  // The spear rack's gold, from the siege tower (or what its line says, if it can't be seen there).
  await vantage(high, 'Siege tower');
  await aimAt(high, 'rack');
  await shot(high, 'high-rack');
  // A Sense potion: every guard's outline in red, and the gold marks, through the walls.
  await high.getByRole('button', { name: /Sense/ }).click();
  await high.waitForTimeout(800);
  await shot(high, 'high-sense');
  // The follow shot: an aimed volley at the captain (or a guard) from the hill, the camera behind
  // its lead spear.
  await vantage(high, 'Hill');
  (await aimAt(high, 'captain')) || (await aimAt(high, 'guard'));
  await shot(high, 'high-aimed');
  await fire(high);
  await high.locator('#screen-siege3d[data-camera=follow]').waitFor({ timeout: 30_000 });
  for (let index = 0; index < 4; index++) {
    await high.waitForTimeout(250);
    await shot(high, `high-follow-${String(index)}`);
  }
  await settle(high, false);
  // A wrecked wall: volleys low on the wall under a guard on the battlement, then a barrage.
  if (await aimAt(high, 'guard', 85)) {
    await fire(high);
    await settle(high);
    await fire(high);
    await high.waitForTimeout(600);
    await shot(high, 'high-wall-falling');
    await settle(high);
    await fire(high, 'Barrage');
    await high.waitForTimeout(5000);
    await settle(high);
    await shot(high, 'high-wall-wrecked');
  }
  await high.close();
}

// A collapsed tower: barrages low on the south-west tower from the low ground, on a fresh round.
if (want('tower')) {
  const tower = await openTent('high');
  await vantage(tower, 'Low ground');
  await aimAt(tower, 'tower:south_west');
  await shot(tower, 'high-tower-before');
  for (let volley = 0; volley < 3; volley++) {
    await fire(tower, 'Barrage');
    await tower.waitForTimeout(900);
    await shot(tower, `high-tower-falling-${String(volley)}`);
    await tower.waitForTimeout(4000);
    await settle(tower);
  }
  await shot(tower, 'high-tower-collapsed');
  await tower.close();
}

// The guards and the captain up close: each vantage turned to a battlement guard, the captain at
// his window, Sense on them, and a guard falling with his battlement (the kill look follows him).
if (want('guards')) {
  const page = await openTent('high');
  for (const name of ['Hill', 'Siege tower']) {
    await vantage(page, name);
    await aimAt(page, 'guard');
    await shot(page, `high-guards-${slug(name)}`);
  }
  await vantage(page, 'Hill');
  await aimAt(page, 'captain');
  await shot(page, 'high-captain');
  await page.getByRole('button', { name: /Sense/ }).click();
  await page.waitForTimeout(800);
  await shot(page, 'high-captain-sense');
  await aimAt(page, 'guard');
  await shot(page, 'high-guards-sense');
  // Volleys low on the wall under a guard: the kill look holds on him as he falls.
  if (await aimAt(page, 'guard', 85)) {
    for (let volley = 0; volley < 3; volley++) {
      await fire(page);
      await page.waitForTimeout(700);
      if ((await view(page).getAttribute('data-camera')) === 'kill') {
        for (let index = 0; index < 3; index++) {
          await shot(page, `high-guard-falling-${String(volley)}-${String(index)}`);
          await page.waitForTimeout(350);
        }
        break;
      }
      await settle(page);
    }
  }
  await page.close();
}

// The guards' hit boxes (Debug → Options), from the hill and the siege tower.
if (want('boxes')) {
  const page = await openTent('high', true);
  for (const name of ['Hill', 'Siege tower']) {
    await vantage(page, name);
    await aimAt(page, 'guard');
    await shot(page, `high-hitboxes-${slug(name)}`);
  }
  await vantage(page, 'Hill');
  await aimAt(page, 'captain');
  await shot(page, 'high-hitboxes-captain');
  await page.close();
}

// The keep's top storey broken open: barrages at the captain's window from the hill, then the
// inside of the keep through what's left.
if (want('keep')) {
  const page = await openTent('high');
  await vantage(page, 'Hill');
  await aimAt(page, 'captain');
  await shot(page, 'high-keep-before');
  for (let volley = 0; volley < 3; volley++) {
    await fire(page, 'Barrage');
    await page.waitForTimeout(5000);
    await settle(page);
    await shot(page, `high-keep-broken-${String(volley)}`);
  }
  await page.close();
}

if (want('low')) {
  const low = await openTent('low');
  await vantage(low, 'Low ground');
  await shot(low, 'low-low-ground');
  await drag(low, -1400, 0);
  await low.waitForTimeout(400);
  await shot(low, 'low-low-ground-left');
  await vantage(low, 'Hill');
  await shot(low, 'low-hill');
  await aimAt(low, 'tower:south_west');
  await fire(low, 'Barrage');
  await low.locator('#screen-siege3d[data-camera=follow]').waitFor({ timeout: 30_000 });
  await low.waitForTimeout(500);
  await shot(low, 'low-follow');
  await low.waitForTimeout(5000);
  await settle(low);
  await shot(low, 'low-hill-wrecked');
  await low.close();
}
// The alarm: a volley everyone hears, guards panicking and ducking, the runner on his way, the bell
// with its timer, and the captain at a window after it (he shows for a long while, to be found).
const ALARM = {
  alertSpearRadius: 500,
  reactSeconds: 0,
  runnerDelaySeconds: 4,
  runnerSpeed: 8,
  captainHideMinSeconds: 2,
  captainHideMaxSeconds: 3,
  captainShowMinSeconds: 25,
  captainShowMaxSeconds: 25,
};
if (want('alarm')) {
  const page = await openTent('high', false, ALARM);
  await vantage(page, 'Hill');
  await shot(page, 'alarm-quiet');
  await drag(page, 0, 600);
  await fire(page);
  await settle(page);
  await drag(page, 0, -600);
  await page.waitForTimeout(500);
  (await aimAt(page, 'guard', 0, 'panic')) || (await aimAt(page, 'guard'));
  await shot(page, 'alarm-panic-hide');
  await page.getByRole('button', { name: /Sense/ }).click();
  await page.waitForTimeout(600);
  await shot(page, 'alarm-hiding-sense');
  await page.locator('#screen-siege3d:not([data-runner=""])').waitFor({ timeout: 60_000 });
  for (const name of ['Hill', 'Siege tower']) {
    await vantage(page, name);
    if (await aimAt(page, 'guard', 0, 'run')) {
      await shot(page, `alarm-runner-${slug(name)}`);
      break;
    }
  }
  await page.waitForTimeout(3000);
  await shot(page, 'alarm-runner-later');
  await page.locator('#screen-siege3d[data-alarm=rang]').waitFor({ timeout: 300_000 });
  await page.waitForTimeout(300);
  await shot(page, 'alarm-bell-timer');
  (await aimAt(page, 'guard', 0, 'ring')) && (await shot(page, 'alarm-ringer'));
  // The captain, once he shows at a window: from wherever sees him.
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector('#screen-siege3d')?.dataset.targets ?? '[]').some(
        (target) => target.kind === 'captain',
      ),
    undefined,
    { timeout: 60_000 },
  );
  for (const name of ['Hill', 'Siege tower', 'Low ground']) {
    await vantage(page, name);
    await aimAt(page, 'captain');
    const [captain] = await targets(page, 'captain');
    if (captain?.on) {
      await shot(page, `alarm-captain-window-${slug(name)}`);
      break;
    }
  }
  await page.close();
}

/**
 * Plays a round to its end card: takes the objectives in turn (the captain, the spear rack from the
 * siege tower, then the battlement's guards), as many as `objectives` of them, then waits for the
 * round to end (all done, or reinforcements).
 */
async function playTo(page, objectives) {
  const done = async () => Number((await view(page).getAttribute('data-done')) ?? 0);
  const over = async () => (await page.locator('body').getAttribute('data-siege')) === 'done';
  for (let shots = 0; shots < 30 && (await done()) < objectives && !(await over()); shots++) {
    const [captain] = await targets(page, 'captain');
    const [rack] = await targets(page, 'rack');
    if (captain) {
      await vantage(page, 'Hill');
      if (!(await aimAt(page, 'captain'))) continue;
    } else if (rack) {
      await vantage(page, 'Siege tower');
      await aimAt(page, 'rack');
    } else {
      await vantage(page, 'Hill');
      if (!(await aimAt(page, 'guard'))) await vantage(page, 'Siege tower');
      await aimAt(page, 'guard');
    }
    await fire(page);
    await page.waitForTimeout(1500);
    if (!(await over())) await settle(page);
  }
  await page.locator('#screen-siege3d .sg-card:not(.sg-confirm):not([hidden])').waitFor({
    timeout: 240_000,
  });
  await page.waitForTimeout(1500);
}

// The end card for each number of stars: every objective without the bell (no runner ever sets
// off), every objective after the bell rang (a fast runner), the captain and then reinforcements,
// and nothing but reinforcements (on the Low tier).
if (want('stars')) {
  const three = await openTent('high', false, { runnerDelaySeconds: 999 });
  await playTo(three, 3);
  await shot(three, 'card-3-stars');
  await three.close();
  const two = await openTent('high', false, { runnerDelaySeconds: 0, runnerSpeed: 40 });
  await playTo(two, 3);
  await shot(two, 'card-2-stars');
  await two.close();
  const one = await openTent('high', false, {
    ...ALARM,
    alertSpearRadius: 0,
    alertDeathRadius: 500,
    alertBreakRadius: 500,
    runnerDelaySeconds: 0,
    runnerSpeed: 40,
    reinforcementSeconds: 3,
  });
  await playTo(one, 1);
  await shot(one, 'card-1-star');
  await one.close();
  const none = await openTent('low', false, {
    ...ALARM,
    runnerDelaySeconds: 0,
    runnerSpeed: 40,
    reinforcementSeconds: 3,
  });
  await vantage(none, 'Hill');
  await drag(none, 0, 600);
  await fire(none);
  await none.locator('#screen-siege3d[data-alarm=rang]').waitFor({ timeout: 300_000 });
  await settle(none);
  await drag(none, 0, -600);
  await none.waitForTimeout(500);
  await shot(none, 'low-alarm-timer');
  await none.locator('#screen-siege3d .sg-card:not(.sg-confirm):not([hidden])').waitFor({
    timeout: 120_000,
  });
  await none.waitForTimeout(1500);
  await shot(none, 'low-card-0-stars');
  await none.close();
}
await browser.close();
