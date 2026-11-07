import { test, expect } from '@playwright/test';

test.describe('Optical Metasurfaces Platform E2E Tests', () => {
  test('loads home page and initializes dual viewport canvases', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');

    await expect(page.locator('.toolbar-title')).toContainText('Metasurface Visualizer');
    await expect(page.locator('.narrative-module')).toHaveCount(0);

    // Check dual viewport canvases
    await expect(page.locator('#lattice-canvas')).toBeVisible();
    await expect(page.locator('#wavefield-canvas')).toBeVisible();

    await expect(page.locator('.hud-grid')).toHaveCount(0);
    await expect(page.locator('#demo-material-picker')).toBeHidden();

    // No severe unhandled runtime crashes
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('device selector switches modes and updates UI', async ({ page }) => {
    await page.goto('/');

    const deflectorBtn = page.locator('button[data-preset="single-deflect"]');
    await deflectorBtn.click();
    await expect(deflectorBtn).toHaveClass(/active/);
    await expect(page.locator('#demo-controls-deflector')).toBeVisible();

    const vortexBtn = page.locator('button[data-preset="single-vortex"]');
    await vortexBtn.click();
    await expect(vortexBtn).toHaveClass(/active/);
    await expect(page.locator('#demo-controls-vortex')).toBeVisible();

    const intensityBtn = page.locator('#wavefield-card button[data-render="intensity"]');
    await intensityBtn.click();
    await expect(page.locator('button[data-render="intensity"][aria-selected="true"]')).toHaveCount(3);

    // Verify intensity panel and slider are visible in intensity modality
    const intensityPanel = page.locator('#wavefield-intensity-panel');
    await expect(intensityPanel).toBeVisible();
    const intensitySlider = page.locator('#slider-intensity-max');
    await expect(intensitySlider).toBeVisible();

    // The slider is calibrated to the solved field: a vortex peaks near the incident intensity.
    await expect.poll(async () => parseFloat(await intensitySlider.getAttribute('max') || '0')).toBeLessThan(20);

    // Adjust max intensity value
    await intensitySlider.evaluate((el: HTMLInputElement) => {
      el.value = String((Number(el.min) + Number(el.max)) / 2);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const shown = await page.locator('#intensity-max-display').textContent();
    await expect(page.locator('#intensity-scale-max')).toHaveText(shown || '');

    // Switch back to 'field' and verify panel is hidden
    const fieldBtn = page.locator('#wavefield-card button[data-render="field"]');
    await fieldBtn.click();
    await expect(intensityPanel).toBeHidden();
  });

  test('demonstration sliders close to visualizer update focal length and diameter', async ({ page }) => {
    await page.goto('/');

    const demoFocalSlider = page.locator('#demo-slider-focal');
    await expect(demoFocalSlider).toBeVisible();
    await demoFocalSlider.fill('35');
    await demoFocalSlider.dispatchEvent('input');

    await expect(page.locator('#demo-label-focal')).toContainText('35.0 µm');

    // Click short focal preset chip (f = 15 µm)
    const chipShort = page.locator('button[data-demo-focal="15"]');
    await chipShort.click();
    await expect(page.locator('#demo-label-focal')).toContainText('15.0 µm');
  });
});
