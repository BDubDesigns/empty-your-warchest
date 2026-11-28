import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { castle } from '../src/data/castle';
import { characters } from '../src/data/characters';
import { siege } from '../src/data/siege';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const tent = stations.find((station) => station.mechanic === 'siege');
const feel = siege.feel;
/** An aimed volley at Command 1. */
const ballista = siege.weapons.find((weapon) => weapon.id === siege.weapon);
const volley = ballista?.aimed.start ?? 0;

/**
 * Opens the War tent with `spears` spears (and `potions` Sense potions) in the warchest, and the
 * siege's feel with `tuning` changed (as Debug's live-tuning sliders leave it).
 */
async function openTent(
  page: Page,
  spears: number,
  potions = 0,
  tuning: Partial<typeof siege.feel> = {},
) {
  if (!tent) throw new Error('No siege station in data');
  // Every skill in data at 0, so the save fits the data and isn't discarded.
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  await page.addInitScript(
    ({ count, potions, xp, tuning }) => {
      if (Object.keys(tuning).length > 0) {
        localStorage.setItem('warchest.tuning.siege', JSON.stringify(tuning));
      }
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: {
            inventory: [
              ...(count > 0 ? [{ item: 'spear', count }] : []),
              ...(potions > 0 ? [{ item: 'sense_potion', count: potions }] : []),
            ],
            skills: xp,
            lastSeenAt: Date.now(),
            done: ['tutorial.woodcutting'],
          },
        }),
      );
    },
    { count: spears, potions, xp, tuning },
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(camp.x + camp.width * tent.camp.x, camp.y + camp.height * tent.camp.y);
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${tent.id}`);
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'siege3d');
}

test('Siege: the castle from its vantage points, drag to look, Fire and follow, and Sense', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openTent(page, 60, 1);
  // The castle is built (and drawn) first.
  await expect(page.locator('body')).toHaveAttribute('data-siege', 'aim', { timeout: 90_000 });
  const view = page.locator('#screen-siege3d');
  await expect(view).toHaveAttribute('data-draw-calls', /\d+/, { timeout: 60_000 });
  // Drawn at the phone's graphics tier (CI draws in software, which Auto puts on low).
  await expect(view).toHaveAttribute('data-graphics', /^(high|low)$/);
  await expect(view).toHaveAttribute('data-camera', 'vantage');
  const count = page.locator('#screen-siege3d .warchest-count');
  await expect(count).toHaveText('60');
  await expect(page.getByRole('radio', { name: /Aimed/ })).toContainText(
    `${String(volley)} spears`,
  );
  await expect(page.getByRole('radio', { name: /Barrage/ })).toContainText(
    `${String(volley * (ballista?.barrageTimes ?? 0))} spears`,
  );
  // Every objective listed, each saying where it is from here (in view, a way to turn, or hidden).
  const objectives = page.getByRole('list', { name: 'Objectives' }).getByRole('listitem');
  await expect(objectives).toHaveCount(siege.objectives.count);
  for (const line of await objectives.all()) {
    await expect(line).toHaveAttribute('data-where', /^(|left|right|up|down|hidden)$/);
  }

  // The vantage points: the first to start, and a tap moves to another.
  const [first, second] = castle.vantages;
  if (!first || !second) throw new Error('Two vantage points needed');
  await expect(view).toHaveAttribute('data-vantage', first.id);
  await expect(page.getByRole('radio', { name: first.name })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('radio', { name: second.name }).tap();
  await expect(view).toHaveAttribute('data-vantage', second.id);

  // A drag turns the view under the crosshair (the camera stays where it stands): the aim goes
  // the way the finger does, right and up.
  await expect(page.locator('#screen-siege3d .sg-crosshair')).toBeVisible();
  const aim = async () =>
    ((await view.getAttribute('data-aim')) ?? '0 0').split(' ').map(Number) as [number, number];
  const [x0, y0] = await aim();
  const box = await page.locator('#screen-siege3d .sg-canvas').boundingBox();
  if (!box) throw new Error('No siege canvas');
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.6;
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x, y }]);
  for (let step = 1; step <= 5; step++) {
    await touch('touchMove', [{ x: x + step * 8, y: y - step * 4 }]);
  }
  await touch('touchEnd', []);
  const [x1, y1] = await aim();
  const perPx = (second.fov / box.height) * feel.aimPerPx;
  expect(x1).toBeCloseTo(x0 + 40 * perPx, 0);
  expect(y1).toBeCloseTo(y0 + 20 * perPx, 0);
  await expect(view).toHaveAttribute('data-camera', 'vantage');
  // It turns no further than the vantage point lets it.
  for (let stroke = 0; stroke < 8; stroke++) {
    await touch('touchStart', [{ x: x + 150, y }]);
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', [{ x: x + 150 - step * 50, y }]);
    }
    await touch('touchEnd', []);
  }
  expect((await aim())[0]).toBeCloseTo(-second.yaw, 0);
  // The buttons are still there to use.
  await expect(page.getByRole('radio', { name: first.name })).toBeVisible();
  await expect(objectives.first()).toBeVisible();

  // Fire: an aimed volley, out of the warchest, and the camera goes after its lead spear.
  const fire = page.getByRole('button', { name: 'Fire' });
  await expect(fire).toBeEnabled();
  await fire.tap();
  await expect(view).toHaveAttribute('data-camera', 'follow', { timeout: 20_000 });
  await expect(count).toHaveText(String(60 - volley));
  await expect(view).toHaveAttribute('data-thrown', String(volley));
  await expect(page.locator('#screen-siege3d .sg-crosshair')).toBeHidden();
  // A tap skips back to the vantage point.
  await touch('touchStart', [{ x, y }]);
  await touch('touchEnd', []);
  await expect(view).toHaveAttribute('data-camera', 'vantage', { timeout: 30_000 });
  await expect(page.locator('#screen-siege3d .sg-crosshair')).toBeVisible();

  // A Sense potion: guards in red through walls, counting down.
  const sense = page.getByRole('button', { name: /Sense/ });
  await expect(sense).toHaveText('Sense ×1');
  await sense.tap();
  await expect(sense).toHaveText(/Sense \d+s/);
  await expect(sense).toHaveAttribute('aria-pressed', 'true');

  // The ghost line of the last shot can be turned off, and stays off.
  const ghost = page.getByRole('button', { name: 'Ghost line' });
  await expect(ghost).toHaveAttribute('aria-pressed', 'true');
  await ghost.tap();
  await expect(ghost).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('warchest.siege.ghost'))).toContain('off');

  // Withdraw asks first, and Keep fighting (the safe answer) goes back to the round.
  await page.getByRole('button', { name: 'Withdraw' }).tap();
  const confirm = page.getByRole('alertdialog', { name: 'Withdraw from the siege?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Objectives done:');
  await expect(confirm).toContainText('stay in the warchest');
  await expect(confirm.getByRole('button', { name: 'Keep fighting' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Keep fighting' }).tap();
  await expect(confirm).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-siege', 'aim');
  await expect(page.getByRole('button', { name: 'Fire' })).toBeVisible();

  // Confirmed, it ends the round with what's done, on a card.
  await page.getByRole('button', { name: 'Withdraw' }).tap();
  await confirm.getByRole('button', { name: 'Withdraw' }).tap();
  const card = page.locator('#screen-siege3d .sg-card:not(.sg-confirm)');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText('Objectives:');
  await expect(page.locator('body')).toHaveAttribute('data-siege', 'done');

  // It's logged for playtest data.
  await card.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  const download = page.getByRole('button', { name: 'Download logs' });
  const [file] = await Promise.all([page.waitForEvent('download'), download.tap()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  const types = exported.events.map((event) => event.type);
  for (const type of [
    'siege.roundStart',
    'siege.vantage',
    'siege.throw',
    'siege.look',
    'siege.follow',
    'siege.throwDone',
    'siege.potion',
    'siege.ghost',
    'siege.withdrawAsk',
    'siege.end',
    'siege.cost',
    'graphics.tier',
  ]) {
    expect(types).toContain(type);
  }
  const started = exported.events.find((event) => event.type === 'siege.roundStart');
  expect(started?.data?.feel).toMatchObject({ aimPerPx: feel.aimPerPx });
  // Each guard's look (the new characters, picked from the round's seed).
  const looks = (started?.data?.guards as { look?: string }[]).map((guard) => guard.look);
  expect(looks.length).toBeGreaterThan(0);
  for (const look of looks) expect(characters.guards).toContain(look);
  // Withdraw asked twice: kept fighting, then confirmed.
  expect(
    exported.events
      .filter((event) => event.type === 'siege.withdrawAsk')
      .map((event) => event.data?.confirmed),
  ).toEqual([false, true]);
  const thrown = exported.events.find((event) => event.type === 'siege.throw');
  expect(thrown?.data).toMatchObject({
    mode: 'aimed',
    spears: volley,
    vantage: second.id,
    power: ballista?.speed,
  });
  expect(thrown?.data?.aim).toMatchObject({ yaw: expect.any(Number), tilt: expect.any(Number) });
  // How far the view was turned for the shot, whether its follow shot was skipped, and what it
  // broke.
  const looked = exported.events.find((event) => event.type === 'siege.look');
  expect(looked?.data).toMatchObject({ vantage: second.id, yaw: -second.yaw });
  expect(exported.events.find((event) => event.type === 'siege.follow')?.data).toMatchObject({
    throw: 1,
    skipped: expect.any(Boolean),
  });
  expect(exported.events.find((event) => event.type === 'siege.throwDone')?.data).toMatchObject({
    throw: 1,
    partsBroken: expect.any(Number),
  });
  expect(exported.events.find((event) => event.type === 'siege.end')?.data).toMatchObject({
    ending: expect.stringMatching(/withdrew|all/),
  });
  expect(errors).toEqual([]);
});

test('Siege: with no spears in the warchest, it says so', async ({ page }) => {
  test.setTimeout(120_000);
  await openTent(page, 0);
  const card = page.locator('#screen-siege3d .sg-card:not(.sg-confirm)');
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText('No spears');
  await card.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
});

test('Siege: a spear alerts the guards, a runner rings the bell, and reinforcements end it', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Every guard hears the first spear and reacts at once; the runner is quick, and so are the
  // reinforcements.
  await openTent(page, 60, 0, {
    alertSpearRadius: 500,
    reactSeconds: 0,
    runnerDelaySeconds: 0,
    runnerSpeed: 40,
    reinforcementSeconds: 6,
  });
  await expect(page.locator('body')).toHaveAttribute('data-siege', 'aim', { timeout: 90_000 });
  const view = page.locator('#screen-siege3d');
  await expect(view).toHaveAttribute('data-alarm', 'quiet');
  await page.getByRole('button', { name: 'Fire' }).tap();
  // The bell rings: the time left until reinforcements, at the top.
  await expect(view).toHaveAttribute('data-alarm', 'rang', { timeout: 60_000 });
  const timer = page.getByRole('timer', { name: 'Reinforcements' });
  await expect(timer).toBeVisible();
  await expect(timer).toHaveText(/^Reinforcements in 0:0\d$/);
  // They arrive: the round is lost, and the card says why it got its stars.
  const card = page.locator('#screen-siege3d .sg-card:not(.sg-confirm)');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('Reinforcements arrived');
  await expect(card).toContainText(/Nothing done: no stars|objectives: 1 star/);
  await expect(card).toContainText('The bell rang');
  expect(errors).toEqual([]);
});
