import { expect, test, type Page } from '@playwright/test';
import { brewing } from '../src/data/brewing';
import { skills } from '../src/data/skills';
import { stations } from '../src/data/stations';
import { loadGameData } from '../src/data';
import { bestAnswer, everyMix, hexToLab } from '../src/stations/brewing';

// CI draws 3D in software: a pixel ratio of 1 keeps it fast enough (this tests the flow, not the
// pixels).
test.use({ deviceScaleFactor: 1 });

const cauldron = stations.find((station) => station.mechanic === 'brewing');

/** Opens the cauldron with a brewing kit in the warchest. */
async function openCauldron(page: Page) {
  if (!cauldron) throw new Error('No brewing station in data');
  const xp = Object.fromEntries(skills.map((skill) => [skill.id, 0]));
  await page.addInitScript(
    ({ xp }) => {
      localStorage.setItem(
        'warchest.save',
        JSON.stringify({
          version: 1,
          savedAt: 1,
          state: {
            inventory: [
              { item: 'red_cap', count: 20 },
              { item: 'moss', count: 20 },
              { item: 'ash', count: 20 },
            ],
            skills: xp,
            lastSeenAt: Date.now(),
            done: ['tutorial.woodcutting'],
          },
        }),
      );
    },
    { xp },
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'camp');
  const camp = await page.locator('#screen-phaser canvas').boundingBox();
  if (!camp) throw new Error('No camp canvas');
  await page.touchscreen.tap(
    camp.x + camp.width * cauldron.camp.x,
    camp.y + camp.height * cauldron.camp.y,
  );
  await expect(page.locator('body')).toHaveAttribute('data-view', `station:${cauldron.id}`);
  await expect(page.locator('body')).toHaveAttribute('data-brewing', 'brew', { timeout: 20_000 });
}

/** Drags a finger round the pot `turns` times. */
async function stir(page: Page, turns: number) {
  const screen = page.locator('#screen-brewing3d');
  const x = Number(await screen.getAttribute('data-pot-x'));
  const y = Number(await screen.getAttribute('data-pot-y'));
  const radius = 60;
  const client = await page.context().newCDPSession(page);
  const at = (angle: number) => ({
    x: x + Math.cos(angle) * radius,
    y: y + Math.sin(angle) * radius,
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] });
  const steps = Math.ceil(turns * 16);
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout(25);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [at((step / 16) * Math.PI * 2)],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test('brews a Sense potion: add, stir, bottle, and it pours into the chest', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openCauldron(page);
  const screen = page.locator('#screen-brewing3d');
  // The best answer for this brew's target, from the same maths the game uses.
  const target = await screen.getAttribute('data-target');
  if (!target) throw new Error('No target colour');
  const answer = bestAnswer(everyMix(loadGameData().brewing), hexToLab(target));
  const names: Record<string, string> = {
    red_cap: 'Add red cap',
    moss: 'Add moss',
    ash: 'Add ash',
    water: `Add ${brewing.water.name.toLowerCase()}`,
  };
  let fill = 0;
  for (const [id, count] of Object.entries(answer.counts)) {
    for (let i = 0; i < count; i++) {
      await page.getByRole('button', { name: names[id] ?? id }).tap();
      fill += 1;
      await expect(screen).toHaveAttribute('data-fill', String(fill));
    }
  }
  // Unstirred, then stirred in.
  await expect(screen).toHaveAttribute('data-unmixed', '1.00');
  for (let round = 0; round < 6; round++) {
    if ((await screen.getAttribute('data-unmixed')) === '0.00') break;
    await stir(page, 2);
  }
  await expect(screen).toHaveAttribute('data-unmixed', '0.00');
  await page.getByRole('button', { name: 'Bottle it' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-brewing', 'done');
  // The hex target is the real one rounded, so allow a star's slack.
  await expect(screen).toHaveAttribute('data-stars', /[23]/);
  await expect(page.locator('.br-card')).toContainText(/Sense potion/);
  await expect(page.locator('.warchest-hud')).toHaveAttribute('data-settled', 'true', {
    timeout: 20_000,
  });
  const potions = await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('warchest.save') ?? '{}') as {
      state?: { inventory?: { item: string; count: number }[] };
    };
    return save.state?.inventory?.find((stack) => stack.item === 'sense_potion')?.count ?? 0;
  });
  expect(potions).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});
