import { test, expect } from '@playwright/test';

test('desktop design modes keep their profile settings and response choice', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const controls = page.locator('#metasurface-controls-host');
  await expect(controls).toHaveAttribute('data-design-kind', 'legacy');
  await controls.locator('[data-design-kind="orthogonal"]').click();
  await expect(controls).toHaveAttribute('data-design-kind', 'orthogonal');
  const focal = controls.locator('[data-profile-index="0"][data-profile-field="focalLength"]');
  await focal.fill('31');
  await focal.dispatchEvent('input');
  await controls.locator('[data-response="library"]').click();
  await expect(controls.locator('[data-response="library"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#metasurface-metrics')).toContainText('RMS Jones error', { timeout: 20000 });

  await controls.locator('[data-design-kind="hybrid"]').click();
  await expect(controls).toHaveAttribute('data-design-kind', 'hybrid');
  const charge = controls.locator('[data-profile-index="1"][data-profile-field="topologicalCharge"]');
  await charge.fill('3');
  await charge.dispatchEvent('input');
  await controls.locator('[data-design-kind="orthogonal"]').click();
  await expect(controls.locator('[data-profile-index="0"][data-profile-field="focalLength"]')).toHaveValue('31');
  await expect(controls.locator('[data-response="library"]')).toHaveAttribute('aria-pressed', 'true');
  await controls.locator('[data-design-kind="hybrid"]').click();
  await expect(controls.locator('[data-profile-index="1"][data-profile-field="topologicalCharge"]')).toHaveValue('3');

  // An all-zero/disabled profile is a valid design and must not generate non-finite UI values.
  const lens = controls.locator('[data-profile-index="0"][data-profile-field="lens"]');
  if (await lens.isChecked()) await lens.uncheck();
  const checkboxes = controls.locator('.metasurface-profile-card input[type="checkbox"]');
  for (let i = 0; i < await checkboxes.count(); i++) if (await checkboxes.nth(i).isChecked()) await checkboxes.nth(i).uncheck();
  await expect(page.locator('#wavefield-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile design controls stay within the viewport and separate illumination from basis settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const controls = page.locator('#metasurface-controls-host');
  await controls.locator('[data-design-kind="orthogonal"]').click();
  const psi = controls.locator('[data-basis-field="psi"]');
  await psi.fill('45');
  await psi.dispatchEvent('input');
  const wavelength = page.locator('#demo-slider-wavelength');
  const before = await wavelength.inputValue();
  await wavelength.fill('650');
  await wavelength.dispatchEvent('input');
  await expect(psi).toHaveValue('45.0');
  await expect(wavelength).not.toHaveValue(before);
  await page.locator('[data-pol="h"]').click();
  await expect(page.locator('[data-pol="h"]')).toHaveClass(/active/);
  await expect(psi).toHaveValue('45.0');
  await controls.locator('[data-response="ideal"]').click();
  await expect(controls.locator('[data-response="ideal"]')).toHaveAttribute('aria-pressed', 'true');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('each profile has an independent editable hologram', async ({ page }) => {
  await page.goto('/');
  const controls = page.locator('#metasurface-controls-host');
  await controls.locator('[data-design-kind="orthogonal"]').click();
  await controls.locator('[data-profile-index="0"][data-profile-field="hologram"]').check();
  await controls.locator('[data-profile-index="1"][data-profile-field="hologram"]').check();
  await controls.locator('[data-profile-index="0"][data-profile-field="hologramTarget"]').selectOption('smiley');
  await controls.locator('[data-profile-index="1"][data-profile-field="hologramTarget"]').selectOption('mu');
  await controls.locator('[data-design-kind="hybrid"]').click();
  await controls.locator('[data-design-kind="orthogonal"]').click();
  await expect(controls.locator('[data-profile-index="0"][data-profile-field="hologramTarget"]')).toHaveValue('smiley');
  await expect(controls.locator('[data-profile-index="1"][data-profile-field="hologramTarget"]')).toHaveValue('mu');
  await expect(page.locator('#metasurface-metrics')).toContainText('RMS Jones error', { timeout: 20000 });
});
