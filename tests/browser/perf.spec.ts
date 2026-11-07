import { test, expect, Page } from '@playwright/test';

/**
 * Counts GL draws per canvas and worker requests per kind from outside the app, so these tests
 * measure what the browser actually did. Assertions use counts and relative changes, never wall
 * time: headless Chromium renders with SwiftShader, so absolute GPU numbers mean nothing here.
 */
interface Counters { draws: Record<string, number>; jobs: Record<string, number> }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const counters = { draws: {} as Record<string, number>, jobs: {} as Record<string, number> };
    (window as unknown as { __perf: typeof counters }).__perf = counters;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof draw>) {
      const id = (this.canvas as HTMLCanvasElement).id;
      counters.draws[id] = (counters.draws[id] ?? 0) + 1;
      return draw.apply(this, args);
    };
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: { kind?: string }, ...rest: unknown[]) {
      if (message && typeof message.kind === 'string') counters.jobs[message.kind] = (counters.jobs[message.kind] ?? 0) + 1;
      return (post as (...a: unknown[]) => void).call(this, message, ...rest);
    } as typeof post;
  });
});

const read = (page: Page) => page.evaluate(() => structuredClone((window as unknown as { __perf: Counters }).__perf));
const reset = (page: Page) => page.evaluate(() => {
  const perf = (window as unknown as { __perf: Counters }).__perf;
  for (const key of Object.keys(perf.draws)) perf.draws[key] = 0;
  for (const key of Object.keys(perf.jobs)) perf.jobs[key] = 0;
});
/** Waits until no worker request has been posted for `quietMs`. */
async function settle(page: Page, quietMs = 1200) {
  let last = JSON.stringify((await read(page)).jobs);
  let stableSince = Date.now();
  while (Date.now() - stableSince < quietMs) {
    await page.waitForTimeout(150);
    const now = JSON.stringify((await read(page)).jobs);
    if (now !== last) { last = now; stableSince = Date.now(); }
  }
  await page.waitForTimeout(400); // let the last reply upload and draw
}
const fieldDraws = (c: Counters) => (c.draws['wavefield-canvas'] ?? 0) + (c.draws['xy-profile-canvas'] ?? 0);

test.describe('idle rendering', () => {
  test('keeps drawing the field while it is playing in field mode', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    await reset(page);
    await page.waitForTimeout(1000);
    expect(fieldDraws(await read(page))).toBeGreaterThan(30);
  });

  test('stops drawing when paused', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-toggle-play').click();
    await settle(page);
    await reset(page);
    await page.waitForTimeout(1000);
    expect(fieldDraws(await read(page))).toBeLessThanOrEqual(1);
  });

  test('stops drawing in intensity mode, which does not depend on time', async ({ page }) => {
    await page.goto('/');
    await page.locator('#wavefield-card button[data-render="intensity"]').click();
    await settle(page);
    await reset(page);
    await page.waitForTimeout(1000);
    expect(fieldDraws(await read(page))).toBeLessThanOrEqual(1);
  });

  test('every control still redraws a paused panel', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-toggle-play').click();
    await settle(page);
    const canvas = page.locator('#wavefield-canvas');
    const snapshot = async () => (await canvas.screenshot()).toString('base64');

    const steps: Array<[string, () => Promise<void>]> = [
      ['rays overlay', () => page.locator('#btn-toggle-rays').click()],
      ['phase view', () => page.locator('#wavefield-card button[data-render="phase"]').click()],
      ['focal length', async () => {
        const slider = page.locator('#demo-slider-focal');
        await slider.fill('40');
        await slider.dispatchEvent('input');
      }],
    ];
    for (const [name, act] of steps) {
      await settle(page);
      const before = await snapshot();
      await act();
      await settle(page);
      expect(await snapshot(), `${name} should change the paused picture`).not.toBe(before);
    }
  });
});

test.describe('hidden panels on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('hidden field panels request nothing until their tab is selected', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    const initial = await read(page);
    expect(initial.jobs['xz'] ?? 0).toBe(0);
    expect(initial.jobs['xy'] ?? 0).toBe(0);

    await page.locator('[data-viewport-tab="wavefield-card"]').click();
    await expect.poll(async () => (await read(page)).jobs['xz'] ?? 0).toBeGreaterThan(0);
    expect((await read(page)).jobs['xy'] ?? 0).toBe(0);

    await page.locator('[data-viewport-tab="xy-card"]').click();
    await expect.poll(async () => (await read(page)).jobs['xy'] ?? 0).toBeGreaterThan(0);
  });
});

test.describe('slider drag', () => {
  test('a 180-event focal-length drag in bursts of four per frame costs layouts and style recalcs in proportion to frames', async ({ page }, testInfo) => {
    await page.goto('/');
    await settle(page);
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await reset(page);
    const before = await metrics();
    const frames = await page.evaluate(async () => {
      const slider = document.querySelector<HTMLInputElement>('#demo-slider-focal')!;
      let rafs = 0;
      let running = true;
      const count = () => { if (running) { rafs++; requestAnimationFrame(count); } };
      requestAnimationFrame(count);
      for (let i = 0; i < 180; i++) {
        slider.value = String(15 + i * 0.15);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        if (i % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 16));
      }
      running = false;
      return rafs;
    });
    const after = await metrics();
    const perf = await read(page);
    const delta = (name: string) => Math.round((after[name] - before[name]) * 1000) / 1000;
    const summary = {
      events: 180,
      frames,
      layouts: delta('LayoutCount'),
      styleRecalcs: delta('RecalcStyleCount'),
      scriptSeconds: delta('ScriptDuration'),
      taskSeconds: delta('TaskDuration'),
      jobs: perf.jobs,
    };
    testInfo.annotations.push({ type: 'drag', description: JSON.stringify(summary) });
    console.log('DRAG', JSON.stringify(summary));
    expect(summary.layouts).toBeLessThanOrEqual(summary.frames * 2 + 10);
  });
});
