import { describe, it } from 'vitest';
import type { FarFieldInput } from '@/lib/optics/farField';
import { computeFarField } from '@/lib/optics/farField';
import { computeXY, computeXZ, deviceSpectrum } from '@/lib/optics/propagation';
import { generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import { measure, reportAtEnd } from './harness';

const mk = (over: Partial<FarFieldInput>): FarFieldInput => ({
  wavelength: 0.532, designWavelength: 0.532, focalLength: 25, diameter: 30, deflectionAngle: 0.35,
  topologicalCharge: 1, lens: true, deflect: false, vortex: false, hologram: false, ...over,
});

const cases: Record<string, FarFieldInput> = {
  'D30/532 lens': mk({}),
  'D50/400 lens': mk({ diameter: 50, wavelength: 0.4, designWavelength: 0.4 }),
  'D30 vortex+deflect': mk({ lens: false, deflect: true, vortex: true }),
};

let salt = 0;
// Varying deflectionAngle by ~1e-9 changes the cache key without changing the physics when deflect is off.
const cold = (p: FarFieldInput): FarFieldInput => ({ ...p, deflectionAngle: p.deflectionAngle + 1e-9 * ++salt });

reportAtEnd();

for (const [name, device] of Object.entries(cases)) {
  describe(name, () => {
    it('solvers', () => {
      measure(`${name} | cold spectrum`, () => { deviceSpectrum(cold(device)); });
      deviceSpectrum(device);
      measure(`${name} | XZ 900x256`, () => { computeXZ(device, 45, 60, 900, 256); });
      measure(`${name} | XY 900x384`, () => { computeXY(device, 25, 25, 17, 900, 384); });
      measure(`${name} | overview 256x128`, () => { computeXZ(device, 45, 60, 256, 128); });
      measure(`${name} | far field 256^2`, () => { computeFarField(device, 256, 1); });
    });
  });
}

describe('hologram D30', () => {
  it('solvers', () => {
    const mask = runGerchbergSaxton(generateTargetBitmap('crest'), 15).phaseMask;
    const holo = mk({ lens: false, hologram: true, cghPhaseMask: mask });
    measure('hologram D30 | cold spectrum', () => { deviceSpectrum(cold(holo)); });
    // A fresh clone per call mimics postMessage structured cloning.
    measure('hologram D30 | XY 384x384 cloned mask', () => { computeXY(structuredClone(holo), 25, 25, 25, 384, 384); });
  });
});

describe('Gerchberg-Saxton', () => {
  it('iterations', () => {
    const target = generateTargetBitmap('smiley');
    measure('GS | 15 iterations', () => { runGerchbergSaxton(target, 15); });
    measure('GS | 500 iterations', () => { runGerchbergSaxton(target, 500); }, 3);
  });
});
