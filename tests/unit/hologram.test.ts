import { afterEach, describe, expect, it } from 'vitest';
import { opticsStore } from '@/lib/store/useOpticsStore';
import { generateTargetBitmap, runGerchbergSaxton, sampleHologramPhase, dft2d, hologramPupilSamples } from '@/lib/optics/gerchbergSaxton';
import { aperturePhase, computeFarField, FarFieldInput } from '@/lib/optics/farField';

const original = { ...opticsStore.getState() };
afterEach(() => opticsStore.update(original));

describe('hologram controls and reconstruction', () => {
  it('uses the correct Fourier sign, inverse normalization, and energy conservation', () => {
    const n = 7;
    const re = Array.from({ length: n }, (_, row) =>
      Array.from({ length: n }, (_, col) => Math.cos(2 * Math.PI * (2 * col + row) / n)));
    const im = Array.from({ length: n }, (_, row) =>
      Array.from({ length: n }, (_, col) => Math.sin(2 * Math.PI * (2 * col + row) / n)));
    const spectrum = dft2d(re, im);
    expect(spectrum.re[1][2]).toBeCloseTo(n * n, 10);
    let energy = 0;
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      energy += spectrum.re[row][col] ** 2 + spectrum.im[row][col] ** 2;
      if (row !== 1 || col !== 2) expect(Math.hypot(spectrum.re[row][col], spectrum.im[row][col])).toBeLessThan(1e-10);
    }
    expect(energy).toBeCloseTo(n ** 4, 9);
    const restored = dft2d(spectrum.re, spectrum.im, true);
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      expect(restored.re[row][col]).toBeCloseTo(re[row][col], 12);
      expect(restored.im[row][col]).toBeCloseTo(im[row][col], 12);
    }
  });

  it('preserves unit amplitude throughout the circular pupil and reconstructs an off-axis target on odd grids', () => {
    const n = 9;
    const target = Array.from({ length: n }, () => new Array(n).fill(0));
    target[2][6] = 1;
    const result = runGerchbergSaxton(target, 10);
    let peak = [0, 0];
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      expect(result.phaseMask[row][col]).toBeGreaterThanOrEqual(0);
      expect(result.phaseMask[row][col]).toBeLessThan(2 * Math.PI);
      if (result.reconstructed[row][col] > result.reconstructed[peak[0]][peak[1]]) peak = [row, col];
    }
    expect(peak).toEqual([2, 6]);
    const samples = hologramPupilSamples(result.phaseMask, n);
    const re = result.phaseMask.map((row, iy) => row.map((phase, ix) =>
      Math.hypot(ix + 0.5 - n / 2, iy + 0.5 - n / 2) <= n / 2 ? Math.cos(phase) : 0));
    const im = result.phaseMask.map((row, iy) => row.map((phase, ix) =>
      Math.hypot(ix + 0.5 - n / 2, iy + 0.5 - n / 2) <= n / 2 ? Math.sin(phase) : 0));
    const field = dft2d(re, im);
    const energy = field.re.flat().reduce((sum, value, index) => sum + value ** 2 + field.im.flat()[index] ** 2, 0);
    expect(energy).toBeCloseTo(samples.length * n * n, 8);
  });

  it('rejects invalid retrieval inputs and snapshots externally supplied masks', () => {
    expect(() => runGerchbergSaxton([[0, 0], [0, 0]])).toThrow(RangeError);
    expect(() => runGerchbergSaxton([[1, NaN], [0, 0]])).toThrow(RangeError);
    expect(() => runGerchbergSaxton([[1, 0], [0, 0]], 0)).toThrow(RangeError);
    const input = [[-Math.PI, 0], [Math.PI, 4 * Math.PI]];
    opticsStore.getState().setCghPhaseMask(input);
    const stored = opticsStore.getState().cghPhaseMask;
    expect(stored).toEqual([[Math.PI, 0], [Math.PI, 0]]);
    input[0][0] = 0;
    expect(stored?.[0][0]).toBe(Math.PI);
    opticsStore.getState().setCghPhaseMask(input);
    expect(opticsStore.getState().cghPhaseMask).not.toBe(stored);
  });

  it('samples every independent hologram cell rather than undersampling with 160 points', () => {
    const mask = runGerchbergSaxton(generateTargetBitmap('mu'), 10).phaseMask;
    const samples = hologramPupilSamples(mask, 30);
    expect(samples).toHaveLength(812);
    for (const sample of samples) {
      expect(sampleHologramPhase(mask, sample.x, sample.y, 30)).toBe(sample.phase);
    }
  });
  it('notifies every subscriber once with the new target and its complete mask', () => {
    opticsStore.getState().setDeviceType('hologram');
    const crestMask = opticsStore.getState().cghPhaseMask;
    const seen: unknown[] = [];
    const unsubscribe = opticsStore.subscribe((state) => seen.push([state.hologramTarget, state.cghPhaseMask]));
    try {
      opticsStore.getState().setHologramTarget('smiley');
      const mask = opticsStore.getState().cghPhaseMask;
      expect(mask).not.toBe(crestMask);
      expect(mask).not.toEqual(crestMask);
      expect(seen).toEqual([['smiley', mask]]);
    } finally { unsubscribe(); }
  });

  it('rebuilds for iterations, preserves the mask for unrelated controls, and reuses a deterministic target', () => {
    const store = opticsStore.getState();
    store.setDeviceType('hologram');
    const first = opticsStore.getState().cghPhaseMask;
    store.setProbeZ(30);
    expect(opticsStore.getState().cghPhaseMask).toBe(first);
    store.setHologramIterations(30);
    expect(opticsStore.getState().cghPhaseMask).not.toEqual(first);
    store.setHologramIterations(15);
    expect(opticsStore.getState().cghPhaseMask).toEqual(first);
  });

  it('allows iteration counts above the previous limit and clamps to the new limit', () => {
    const store = opticsStore.getState();
    store.setDeviceType('hologram');
    store.setHologramIterations(60);
    expect(opticsStore.getState().hologramIterations).toBe(60);
    expect(opticsStore.getState().cghPhaseMask).toEqual(
      runGerchbergSaxton(generateTargetBitmap(opticsStore.getState().hologramTarget), 60).phaseMask);
    store.setDeviceType('metalens');
    store.setHologramIterations(1000);
    expect(opticsStore.getState().hologramIterations).toBe(500);
  });

  it('invalidates targets changed while holography is off and generates them when enabled', () => {
    opticsStore.getState().setDeviceType('hologram');
    opticsStore.getState().setDeviceType('metalens');
    opticsStore.getState().setHologramTarget('mu');
    expect(opticsStore.getState().cghPhaseMask).toBeNull();
    opticsStore.getState().toggleGradient('hologram');
    expect(opticsStore.getState().cghPhaseMask).toEqual(
      runGerchbergSaxton(generateTargetBitmap('mu'), 15).phaseMask);
  });

  it('samples mask rows by y and columns by x, including clamped aperture edges', () => {
    const mask = [[1, 2, 3], [4, 5, 6]];
    expect(sampleHologramPhase(mask, -5, 5, 10)).toBe(4);
    expect(sampleHologramPhase(mask, 5, -5, 10)).toBe(3);
    expect(sampleHologramPhase(mask, 0, 0, 10)).toBe(5);
    expect(aperturePhase({ hologram: true, cghPhaseMask: mask, diameter: 10,
      designWavelength: 0.532 } as FarFieldInput, -5, 5)).toBe(4);
  });

  for (const target of ['crest', 'smiley', 'mu'] as const) {
    it(`reconstructs ${target} upright through the actual circular-aperture far-field renderer`, () => {
      const bitmap = generateTargetBitmap(target);
      const result = runGerchbergSaxton(bitmap, 20);
      const wavelength = 0.2;
      const diameter = 6.4; // 32 aperture samples, matching the synthesis grid.
      const field = computeFarField({ wavelength, diameter, designWavelength: wavelength,
        focalLength: 25, deflectionAngle: 0, topologicalCharge: 1,
        lens: false, deflect: false, vortex: false, hologram: true,
        cghPhaseMask: result.phaseMask, idealPitch: 0.2 }, 33, 16.5 * wavelength / diameter);
      let onTarget = 0;
      let total = 0;
      for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
        const intensity = field.intensity[row * 33 + col];
        expect(intensity).toBeCloseTo(result.reconstructed[row][col], 5);
        total += intensity;
        onTarget += intensity * bitmap[row][col];
      }
      expect(onTarget / total).toBeGreaterThan(0.7);
    });
  }
});
