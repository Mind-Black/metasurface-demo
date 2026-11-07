import { test, expect } from '@playwright/test';

const STUB_KATEX = `window.katex = { renderToString: (tex) => '<span class="stub-katex">' + tex + '</span>' };`;

test.describe('startup', () => {
  test('a slow KaTeX CDN does not hold up the app', async ({ page }) => {
    // Previously a deferred script from the CDN gated DOMContentLoaded, and with it the whole app.
    await page.route('**/cdn.jsdelivr.net/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      await route.abort();
    });
    const start = Date.now();
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('#wavefield-canvas')).toBeVisible({ timeout: 4000 });
    expect(Date.now() - start).toBeLessThan(5000);
    // The formulas are readable straight away, in the fallback typography.
    await expect(page.locator('.math-tex').first()).toHaveAttribute('data-rendered', 'fallback');
  });

  test('an unreachable CDN leaves the fallback typography in place without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#wavefield-canvas')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('.math-tex').first()).toHaveAttribute('data-rendered', 'fallback');
    expect(errors).toEqual([]);
  });

  test('KaTeX arriving late replaces the fallback typography', async ({ page }) => {
    await page.route('**/cdn.jsdelivr.net/**/katex.min.css', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/cdn.jsdelivr.net/**/katex.min.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ contentType: 'application/javascript', body: STUB_KATEX });
    });
    await page.goto('/');
    await expect(page.locator('.math-tex').first()).toHaveAttribute('data-rendered', 'fallback');
    await expect(page.locator('.math-tex').first()).toHaveAttribute('data-rendered', 'katex', { timeout: 8000 });
    await expect(page.locator('.math-tex .stub-katex').first()).toBeVisible();
  });
});
