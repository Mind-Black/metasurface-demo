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

describe('field windows match the frozen legacy implementation exactly', () => {
  for (const [name, over] of Object.entries(variants)) {
    it(`${name}: XZ and XY`, () => {
      const p = device(over, 30, 0.532);
      for (const [now, before] of [
        [computeXZ(p, 40, 60, 160, 64), legacy.computeXZ(p, 40, 60, 160, 64)],
        [computeXY(p, 25, 25, 17, 120, 96), legacy.computeXY(p, 25, 25, 17, 120, 96)],
      ]) {
        sameArray(now.data, before.data, 'data');
        for (const field of ['nx', 'ny', 'peak', 'peakX', 'peakV'] as const) expect(now[field], field).toBe(before[field]);
      }
    }, 120000);
  }
});
