import { describe, expect, it } from 'vitest';
import type { FarFieldInput } from '@/lib/optics/farField';
import { computeXY, computeXZ, deviceSpectrum } from '@/lib/optics/propagation';
import { generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import * as legacy from './helpers/legacyPropagation';

/** Exact (===) comparison; `toEqual` would call +0 and -0 different. */
function sameArray(a: ArrayLike<number>, b: ArrayLike<number>, label: string) {
  expect(a.length, `${label} length`).toBe(b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) {
    throw new Error(`${label}[${i}]: ${a[i]} !== ${b[i]}`);
  }
}

const mask = runGerchbergSaxton(generateTargetBitmap('crest'), 5).phaseMask;
const variants: Record<string, Partial<FarFieldInput>> = {
  lens: { lens: true },
  deflect: { deflect: true },
  'vortex+lens': { vortex: true, lens: true },
  hologram: { hologram: true, cghPhaseMask: mask },
};

const device = (over: Partial<FarFieldInput>, diameter: number, wavelength: number): FarFieldInput => ({
  wavelength, designWavelength: wavelength, focalLength: 25, diameter, deflectionAngle: 0.35,
  topologicalCharge: 1, lens: false, deflect: false, vortex: false, hologram: false, ...over,
});

describe('deviceSpectrum matches the frozen legacy implementation exactly', () => {
  for (const [name, over] of Object.entries(variants)) {
    for (const diameter of [15, 30]) {
      for (const wavelength of [0.4, 0.532, 1.55]) {
        it(`${name}, D=${diameter} µm, ${wavelength * 1000} nm`, () => {
          const p = device(over, diameter, wavelength);
          const now = deviceSpectrum(p);
          const before = legacy.deviceSpectrum(p);
          for (const field of ['wavelength', 'df', 'fx0', 'fy0', 'cols', 'rows'] as const) {
            expect(now[field], field).toBe(before[field]);
          }
          for (const field of ['ix', 'iy', 're', 'im', 'kz'] as const) sameArray(now[field], before[field], field);
        }, 120000);
      }
    }
  }
});

describe('XZ windows match the frozen legacy implementation exactly', () => {
  for (const [name, over] of Object.entries(variants)) {
    it(name, () => {
      const p = device(over, 30, 0.532);
      const now = computeXZ(p, 40, 60, 160, 64);
      const before = legacy.computeXZ(p, 40, 60, 160, 64);
      sameArray(now.data, before.data, 'data');
      for (const field of ['nx', 'ny', 'peak', 'peakX', 'peakV'] as const) expect(now[field], field).toBe(before[field]);
    }, 120000);
  }
});

describe('XY windows track the frozen legacy implementation', () => {
  // XY transforms the shorter output axis second, which reorders the separable sums; results agree
  // to rounding error rather than bit for bit. Windows cover both orders (wide, tall, square).
  const shapes: Array<[string, number, number, number, number]> = [
    ['wide', 25, 17, 120, 96], ['tall', 17, 25, 96, 120], ['square', 20, 20, 100, 100], ['strongly wide', 40, 10, 160, 40],
  ];
  for (const [name, over] of Object.entries(variants)) {
    for (const [shape, halfX, halfY, nx, ny] of shapes) {
      it(`${name}, ${shape}`, () => {
        const p = device(over, 30, 0.532);
        const now = computeXY(p, 25, halfX, halfY, nx, ny);
        const before = legacy.computeXY(p, 25, halfX, halfY, nx, ny);
        expect(now.nx).toBe(before.nx);
        expect(now.ny).toBe(before.ny);
        let largest = 0;
        for (let i = 0; i < before.data.length; i++) largest = Math.max(largest, Math.abs(before.data[i]));
        let worst = 0;
        for (let i = 0; i < before.data.length; i++) worst = Math.max(worst, Math.abs(now.data[i] - before.data[i]));
        expect(worst).toBeLessThan(1e-5 * largest);
        expect(now.peak).toBeCloseTo(before.peak, 4);
      }, 120000);
    }
  }
});
