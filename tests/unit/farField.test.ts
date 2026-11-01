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
});
