import { describe, it, expect } from 'vitest';
import { computeFarField, FarFieldInput } from '@/lib/optics/farField';

const base: FarFieldInput = {
  wavelength: 0.532,
  designWavelength: 0.532,
  focalLength: 25,
  diameter: 30,
  deflectionAngle: 0,
  topologicalCharge: 1,
  lens: false,
  deflect: false,
  vortex: false,
  hologram: false,
};

function peakIndex(a: Float32Array): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

describe('computeFarField', () => {
  it('preserves the normalized complex field underlying the intensity', () => {
    const result = computeFarField({ ...base, vortex: true }, 33, 0.25);
    for (let i = 0; i < result.intensity.length; i++) {
      expect(result.real[i] ** 2 + result.imaginary[i] ** 2).toBeCloseTo(result.intensity[i], 6);
    }
    expect(result.imaginary.some((value) => Math.abs(value) > 0.01)).toBe(true);
  });

  it('flat aperture peaks at the centre of the pattern', () => {
    const r = computeFarField(base, 64, 0.25);
    const idx = peakIndex(r.intensity);
    const row = Math.floor(idx / 64);
    const col = idx % 64;
    expect(Math.abs(row - 32)).toBeLessThanOrEqual(1);
    expect(Math.abs(col - 32)).toBeLessThanOrEqual(1);
  });

  it('deflector peak sits at sin(theta) on the +x axis', () => {
    const theta = (20 * Math.PI) / 180;
    const r = computeFarField({ ...base, deflect: true, deflectionAngle: theta }, 128, 0.5);
    const idx = peakIndex(r.intensity);
    const col = idx % 128;
    const sx = -0.5 + ((col + 0.5) / 128) * 1.0;
    expect(sx).toBeCloseTo(Math.sin(theta), 1);
  });

  it('vortex has a dark centre', () => {
    const r = computeFarField({ ...base, vortex: true }, 65, 0.0625);
    expect(r.intensity[32 * 65 + 32]).toBeLessThan(0.02);
  });

  it('axicon forms a far-field annular ring at sin(theta) ≈ NA with a suppressed centre', () => {
    const na = 0.35;
    const size = 129;
    const sinMax = 0.6;
    const r = computeFarField({ ...base, axicon: true, axiconNA: na }, size, sinMax);
    const mid = (size - 1) / 2;
    // Finite-aperture + pillar zero-order leakage leaves a weak centre (< 15% of ring peak).
    expect(r.intensity[mid * size + mid]).toBeLessThan(0.15);
    const idx = peakIndex(r.intensity);
    const row = Math.floor(idx / size);
    const col = idx % size;
    const sx = -sinMax + ((col + 0.5) / size) * 2 * sinMax;
    const sy = sinMax - ((row + 0.5) / size) * 2 * sinMax;
    expect(Math.hypot(sx, sy)).toBeCloseTo(na, 1);
    const ringOffset = Math.round((na / sinMax) * (size / 2));
    for (const [dr, dc] of [[0, ringOffset], [0, -ringOffset], [ringOffset, 0], [-ringOffset, 0]]) {
      expect(r.intensity[(mid + dr) * size + (mid + dc)]).toBeGreaterThan(0.5);
    }
  });
});
