import { test, expect } from '@playwright/test';

test('mobile tabs show one viewport and desktop shows all viewports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const cards = page.locator('.viewport-card');
  const tabs = page.locator('[data-viewport-tab]');
  await expect(cards.filter({ visible: true })).toHaveCount(1);
  for (const id of ['wavefield-card', 'xy-card', 'farfield-card', 'lattice-card']) {
    await page.locator(`[data-viewport-tab="${id}"]`).click();
    await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(cards.filter({ visible: true })).toHaveCount(1);
    await expect(page.locator(`[data-viewport-tab="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  }
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#wavefield-card')).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(cards.filter({ visible: true })).toHaveCount(4);
  await expect(tabs.first()).toBeHidden();

  // Desktop places the control panel beside the viewports without horizontal overflow.
  const viewportsBox = await page.locator('.split-viewports').boundingBox();
  const controlsBox = await page.locator('#viewport-controls-panel').boundingBox();
  expect(viewportsBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(controlsBox!.x).toBeGreaterThanOrEqual(viewportsBox!.x + viewportsBox!.width - 1);
  expect(controlsBox!.y).toBeLessThan(viewportsBox!.y + viewportsBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  // Tablet / narrow viewports stack the control panel below the viewports cleanly.
  await page.setViewportSize({ width: 768, height: 900 });
  const stackedViewportsBox = await page.locator('.split-viewports').boundingBox();
  const stackedControlsBox = await page.locator('#viewport-controls-panel').boundingBox();
  expect(stackedControlsBox!.y).toBeGreaterThanOrEqual(stackedViewportsBox!.y + stackedViewportsBox!.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
