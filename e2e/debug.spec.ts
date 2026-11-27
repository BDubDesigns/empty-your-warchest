import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openDebug(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeVisible();
}

test('debug menu adds items, sets levels, keeps them after reload, exports logs and resets', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');

  await openDebug(page);
  await page.getByLabel('Item').selectOption('spear');
  await page.getByLabel('Count').fill('5');
  await page.getByRole('button', { name: 'Add' }).tap();
  await expect(page.getByText('Spear × 5')).toBeVisible();

  await page.getByLabel('Woodcutting level').fill('10');
  await page.locator('[data-skill=woodcutting]').getByRole('button', { name: 'Set' }).tap();
  await expect(page.locator('[data-skill=woodcutting]')).toContainText('Lv 10');

  await page.reload();
  await openDebug(page);
  await expect(page.getByText('Spear × 5')).toBeVisible();
  await expect(page.locator('[data-skill=woodcutting]')).toContainText('Lv 10');

  const downloadButton = page.getByRole('button', { name: 'Download logs' });
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.tap()]);
  expect(download.suggestedFilename()).toMatch(/^warchest-log-.*\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    events: { type: string; session: string }[];
  };
  const types = exported.events.map((event) => event.type);
  expect(types).toEqual(
    expect.arrayContaining([
      'session.start',
      'save.new',
      'save.loaded',
      'debug.addItems',
      'debug.setLevel',
    ]),
  );
  expect(new Set(exported.events.map((event) => event.session)).size).toBe(2);

  const reset = page.getByRole('button', { name: 'Reset save' });
  await reset.tap();
  await page.getByRole('button', { name: 'Tap again to wipe the save' }).tap();
  await expect(page.getByText('Spear × 5')).toBeHidden();
  await expect(page.locator('[data-skill=woodcutting]')).toContainText('Lv 1 ');

  await page.getByRole('button', { name: 'Close' }).tap();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('exported logs include debug actions taken since the menu was opened', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');
  await openDebug(page);
  await expect(page.getByRole('button', { name: 'Download logs' })).toBeEnabled();

  await page.getByLabel('Woodcutting level').fill('50');
  await page.locator('[data-skill=woodcutting]').getByRole('button', { name: 'Set' }).tap();
  await page.getByRole('button', { name: 'Add' }).tap();
  await page.getByRole('button', { name: '+10 min' }).tap();
  await page.getByRole('button', { name: 'Reset save' }).tap();
  await page.getByRole('button', { name: 'Tap again to wipe the save' }).tap();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download logs' }).tap(),
  ]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    events: { type: string; data?: Record<string, unknown> }[];
  };
  const debugEvents = exported.events.filter((event) => event.type.startsWith('debug.'));
  expect(debugEvents.map((event) => event.type)).toEqual([
    'debug.setLevel',
    'debug.addItems',
    'debug.skipTime',
    'debug.resetSave',
    'debug.exportLogs',
  ]);
  expect(debugEvents[0]?.data).toEqual({ skill: 'woodcutting', level: 50 });
});

test('Send logs posts the log export and shows its code', async ({ page }) => {
  const posted: { method: string; body: unknown }[] = [];
  await page.route('**/api/logs', async (route) => {
    const request = route.request();
    posted.push({ method: request.method(), body: request.postDataJSON() });
    await route.fulfill({ json: { code: 'K7QX', key: '20261127-134805-bench-K7QX' } });
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');
  await openDebug(page);
  const send = page.getByRole('button', { name: 'Send logs' });
  await expect(send).toBeEnabled();
  await send.tap();
  const status = page.getByRole('dialog', { name: 'Debug menu' }).getByRole('status');
  await expect(status).toHaveText('Sent ✓ code K7QX');
  expect(posted).toHaveLength(1);
  const body = posted[0]?.body as { exportedAt: string; build: string; events: { type: string }[] };
  expect(posted[0]?.method).toBe('POST');
  expect(typeof body.exportedAt).toBe('string');
  expect(typeof body.build).toBe('string');
  expect(body.events.map((event) => event.type)).toContain('session.start');

  // When it can't get through, it says so and Share logs… is still there.
  await page.route('**/api/logs', (route) =>
    route.fulfill({ status: 500, json: { error: 'KV down' } }),
  );
  await send.tap();
  await expect(status).toContainText("Couldn't send: the server said 500: KV down");
  await expect(page.getByRole('button', { name: 'Share logs…' })).toBeVisible();
});

// Real touches, through Chrome's own input: a swipe that starts on a slider scrolls the menu, a
// tap leaves it alone, and only a sideways drag moves it.
test('a slider ignores scrolls and taps and moves on a sideways drag', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');
  await openDebug(page);
  const panel = page.getByRole('dialog', { name: 'Debug menu' });
  const slider = page.getByLabel('Fall time (s)');
  await slider.scrollIntoViewIfNeeded();
  const before = await slider.inputValue();
  const cdp = await page.context().newCDPSession(page);
  const touch = async (points: [number, number][]) => {
    const [first, ...rest] = points;
    if (!first) return;
    const at = ([x, y]: [number, number]) => [{ x, y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(first) });
    for (const point of rest) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(point) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const box = await slider.boundingBox();
  if (!box) throw new Error('No slider');
  const x = box.x + box.width * 0.85;
  const y = box.y + box.height / 2;
  const scrolled = () => panel.evaluate((element) => element.scrollTop);

  // A swipe up, starting on the slider, near its right end.
  const top = await scrolled();
  await touch(Array.from({ length: 12 }, (_, step): [number, number] => [x, y - step * 15]));
  await expect.poll(scrolled).toBeGreaterThan(top);
  await expect(slider).toHaveValue(before);

  // A tap on the slider, far from its thumb.
  const tapBox = await slider.boundingBox();
  if (!tapBox) throw new Error('No slider');
  const tapY = tapBox.y + tapBox.height / 2;
  await touch([[tapBox.x + tapBox.width * 0.9, tapY]]);
  await expect(slider).toHaveValue(before);

  // A drag to the right moves it up from where it was.
  const from = tapBox.x + tapBox.width * 0.3;
  await touch(Array.from({ length: 8 }, (_, step): [number, number] => [from + step * 12, tapY]));
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(Number(before));
  await expect(page.locator('.debug-tune', { hasText: 'Fall time (s)' })).toContainText('•');
});
