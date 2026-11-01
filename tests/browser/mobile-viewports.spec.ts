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
});
