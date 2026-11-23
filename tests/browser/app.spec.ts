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

    const axiconBtn = page.locator('button[data-preset="single-axicon"]');
    await axiconBtn.click();
    await expect(axiconBtn).toHaveClass(/active/);
    await expect(page.locator('#demo-controls-axicon')).toBeVisible();
    await page.locator('button[data-demo-axicon-na="0.50"]').click();
    await expect(page.locator('#demo-label-axicon-na')).toHaveText('+0.50');
    await expect(page.locator('#demo-axicon-info')).toContainText('Bessel zone');

    const besselVortexBtn = page.locator('button[data-preset="bessel-vortex"]');
    await besselVortexBtn.click();
    await expect(besselVortexBtn).toHaveClass(/active/);
    await expect(page.locator('#demo-controls-axicon')).toBeVisible();
    await expect(page.locator('#demo-controls-vortex')).toBeVisible();

    await vortexBtn.click();
    await expect(vortexBtn).toHaveClass(/active/);

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

  test('switches to PB phase and drives the input polarization and analyzer', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.goto('/');

    const pbBtn = page.locator('button[data-mechanism="pb"]');
    await pbBtn.click();
    await expect(pbBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#pol-fin-readout')).toContainText('helicity-converted');
    await expect(page.locator('#pol-mechanism-note')).toContainText('θ = φ/2');

    // Default input is RCP; switch to horizontal and check the Stokes readout and the ellipse glyph.
    await expect(page.locator('button[data-pol="rcp"]')).toHaveClass(/active/);
    await page.locator('button[data-pol="h"]').click();
    await expect(page.locator('button[data-pol="h"]')).toHaveClass(/active/);
    await expect(page.locator('#pol-stokes')).toHaveText('S = (+1.00, +0.00, +0.00)');
    await expect(page.locator('#pol-handedness')).toHaveText('Linear 0°');

    const chi = page.locator('#pol-slider-chi');
    await chi.fill('-45');
    await chi.dispatchEvent('input');
    await expect(page.locator('button[data-pol="lcp"]')).toHaveClass(/active/);

    const lcpAnalyzer = page.locator('button[data-analyzer="lcp"]');
    await lcpAnalyzer.click();
    await expect(lcpAnalyzer).toHaveAttribute('aria-pressed', 'true');

    await page.locator('button[data-mechanism="dynamic"]').click();
    await expect(page.locator('#pol-mechanism-note')).toContainText('isotropic');
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
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

    // Manual input supports arbitrary values and negative (diverging) focal lengths
    const demoFocalInput = page.locator('#demo-input-focal');
    await expect(demoFocalInput).toBeVisible();
    await demoFocalInput.fill('75');
    await demoFocalInput.dispatchEvent('input');
    await expect(page.locator('#demo-label-focal')).toContainText('75.0 µm');
    await expect(demoFocalSlider).toHaveValue('75');

    await demoFocalInput.fill('-25');
    await demoFocalInput.dispatchEvent('input');
    await expect(page.locator('#demo-label-focal')).toContainText('-25.0 µm');
    await expect(page.locator('button[data-demo-focal="-25"]')).toHaveClass(/active/);

    // Invalid zero value reverts on blur without breaking state
    await demoFocalInput.fill('0');
    await demoFocalInput.dispatchEvent('input');
    await demoFocalInput.blur();
    await expect(demoFocalInput).toHaveValue('-25');
    await expect(page.locator('#demo-label-focal')).toContainText('-25.0 µm');
  });
});
