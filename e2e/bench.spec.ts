import { expect, test } from '@playwright/test';

// The stress test opens from the debug menu, runs the box scene once at 1× and shows its result.
// CI draws 3D in software, so this is the lightest run there is; it still takes the full 20 s path.
test('the stress test opens from Debug and runs the box scene at 1×', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');

  await page.getByRole('button', { name: 'Open debug menu' }).tap();
  await page.getByRole('button', { name: 'Stress test', exact: true }).tap();
  const bench = page.getByRole('dialog', { name: 'Stress test' });
  await expect(bench).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Debug menu' })).toBeHidden();

  const pack = bench.getByRole('group', { name: 'Pack' });
  await expect(pack.getByRole('button', { name: 'Boxes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(
    bench.getByRole('group', { name: 'Copies of everything' }).getByRole('button', { name: '1×' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await bench.getByRole('button', { name: 'Run', exact: true }).tap();
  await expect(bench).toHaveAttribute('data-bench-state', 'running');
  await expect(bench).toHaveAttribute('data-bench-state', 'done', { timeout: 100_000 });
  await expect(bench.getByRole('status')).toContainText('1 of 1 run done');

  // On a phone the results open as the summary, which fits the screen without scrolling sideways.
  const results = bench.getByRole('region', { name: 'Results' });
  const views = results.getByRole('group', { name: 'Results view' });
  await expect(views.getByRole('button', { name: 'Summary' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const summary = results.locator('.bench-summary tbody[data-pack=boxes]');
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText('1 · Boxes 1× · shadows on');
  await expect(results.locator('.bench-device')).toContainText('GPU:');
  const panel = bench.locator('.bench-panel');
  const sideways = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(sideways).toBeLessThanOrEqual(0);
  // The full table is a tap away.
  await views.getByRole('button', { name: 'Full table' }).tap();
  await expect(results.locator('.bench-table tr[data-pack=boxes]')).toHaveCount(1);
  await expect(results.locator('.bench-summary')).toBeHidden();

  // Send results posts the whole log, every run in it as bench.result.
  let posted: { events: { type: string }[] } | undefined;
  await page.route('**/api/logs', async (route) => {
    posted = route.request().postDataJSON() as typeof posted;
    await route.fulfill({ json: { code: 'B3NC', key: 'k' } });
  });
  await results.getByRole('button', { name: 'Send results' }).tap();
  await expect(bench.getByRole('status')).toHaveText('Sent ✓ code B3NC');
  expect(posted?.events.filter((event) => event.type === 'bench.result')).toHaveLength(1);

  // Closing it goes back to the camp, running again.
  await bench.getByRole('button', { name: 'Close' }).tap();
  await expect(bench).toBeHidden();
  await expect(page.locator('#screen-phaser')).toBeVisible();
  expect(errors).toEqual([]);
});

// ?bench=quick (for BrowserStack's minute a device): the quick run starts as the page loads, with
// no taps and no camp, and sends the log after each of its runs. Shortened here (CI draws 3D in
// software), so it's the order of things that's tested, not the timing.
test('?bench=quick runs the quick run from load and sends the log after each run', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  type Event = { type: string; data?: { run?: number; status?: string } };
  const posted: Event[][] = [];
  const codes = ['Q1AA', 'Q2BB', 'Q3CC'];
  await page.route('**/api/logs', async (route) => {
    const log = route.request().postDataJSON() as { events: Event[] };
    posted.push(log.events);
    await route.fulfill({ json: { code: codes[posted.length - 1] ?? 'XXXX', key: 'k' } });
  });
  await page.goto('/?bench=quick&warmup=0.2&measure=0.5');

  const bench = page.getByRole('dialog', { name: 'Stress test' });
  await expect(bench).toHaveAttribute('data-bench-state', 'running');
  await expect(bench).toHaveAttribute('data-bench-set', 'quick');
  // Straight in: the camp never loaded.
  await expect(page.locator('body')).not.toHaveAttribute('data-screen', /.+/);
  const quick = bench.getByRole('region', { name: 'Quick run' });
  await expect(quick).toContainText('Run 1 of 3 · Village optimised 1×');
  await expect(quick.locator('.bench-quick-code')).toHaveText('Q1AA', { timeout: 60_000 });
  await expect(bench).toHaveAttribute('data-bench-state', 'done', { timeout: 100_000 });

  // One upload a run, each sent once its run was logged and before the next began.
  expect(posted).toHaveLength(3);
  posted.forEach((events, index) => {
    const quickRuns = events.filter((event) => event.type === 'bench.quick');
    expect(quickRuns.map((event) => event.data?.run)).toEqual(
      Array.from({ length: index + 1 }, (_, run) => run + 1),
    );
    expect(events.filter((event) => event.type === 'bench.result')).toHaveLength(
      quickRuns.filter((event) => event.data?.status === 'done').length,
    );
  });
  const statuses = (posted[2] ?? [])
    .filter((event) => event.type === 'bench.quick')
    .map((event) => event.data?.status);
  // The plain village is heavy for CI's software 3D: it may hit the load time-out, which is still
  // sent as such.
  expect(statuses.slice(0, 2)).toEqual(['done', 'done']);
  expect(['done', 'timedOut']).toContain(statuses[2]);

  // The latest code big, every upload listed, and the summary under it.
  await expect(quick).toHaveAttribute('data-uploads', '3');
  await expect(quick.locator('.bench-quick-code')).toHaveText('Q3CC');
  await expect(quick).toContainText('1 ✓ Q1AA · 2 ✓ Q2BB · 3 ✓ Q3CC');
  await expect(quick).toContainText('last sent');
  await expect(bench.getByRole('status')).toHaveText('Sent ✓ code Q3CC');
  const summary = bench.locator('.bench-summary tbody');
  await expect(summary).toHaveCount(statuses[2] === 'done' ? 3 : 2);
  await expect(summary.first()).toContainText('1 · Village optimised 1× · shadows on');

  // Closed, the camp starts as it would have.
  await bench.getByRole('button', { name: 'Close' }).tap();
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'phaser');
  expect(errors).toEqual([]);
});
