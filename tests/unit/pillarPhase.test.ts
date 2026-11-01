import { describe, expect, it } from 'vitest';
import { opticsStore } from '@/lib/store/useOpticsStore';
import { targetPhaseToDiameter, queryUnitCellLUT } from '@/lib/optics/rcwaLut';
import { aperturePhase } from '@/lib/optics/farField';
import { latticeTargetPhase, latticePillarGeometry, latticePhaseMapCoordinates } from '@/components/viewer/NanostructureLattice';
import { generateTargetBitmap, runGerchbergSaxton, sampleHologramPhase } from '@/lib/optics/gerchbergSaxton';

const circularError = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const state = { ...opticsStore.getState(),
  activeGradients: { lens: false, deflect: false, vortex: false, hologram: true },
  cghPhaseMask: runGerchbergSaxton(generateTargetBitmap('mu'), 20).phaseMask };

describe('phase retrieval to pillar geometry and map', () => {
  it('round-trips the entire 2π phase range through the nominal forward pillar model', () => {
    for (let i = 0; i <= 128; i++) {
      const phase = i * 2 * Math.PI / 128;
      const diameter = targetPhaseToDiameter(phase, 532, 600, 400, 'TiO2');
      const response = queryUnitCellLUT(diameter, 532, 600, 400, 'TiO2');
      expect(response.fabFeasible).toBe(true);
      expect(circularError(response.phase, phase)).toBeLessThan(1e-10);
    }
  });

  it('minimizes circular phase error when the geometry cannot cover 2π', () => {
    for (const target of [0, 0.1, 1, 2, 3, 4, 5, 6]) {
      const chosen = targetPhaseToDiameter(target, 1550, 600, 400, 'Si');
      const achieved = queryUnitCellLUT(chosen, 1550, 600, 400, 'Si');
      for (let diameter = 80; diameter <= 340; diameter++) {
        const candidate = queryUnitCellLUT(diameter, 1550, 600, 400, 'Si');
        expect(circularError(achieved.phase, target)).toBeLessThanOrEqual(circularError(candidate.phase, target) + 1e-10);
      }
    }
  });

  it('renders the retrieved phase with consistent x/y coordinates and physical diameter units', () => {
    for (const [x, y] of [[-5, 3], [6, -4], [0, 0]]) {
      const sample = latticePillarGeometry(state, x, y);
      const retrieved = sampleHologramPhase(state.cghPhaseMask, x, y, state.diameter);
      expect(circularError(sample.targetPhase, retrieved)).toBeLessThan(1e-12);
      const forward = queryUnitCellLUT(sample.diameterNm, 532, 600, 400, 'TiO2');
      expect(circularError(forward.phase, retrieved)).toBeLessThan(1e-10);
      expect(sample.diameterNm / 2000).toBeGreaterThan(0.04); // Three uses radius in µm.
      expect(sample.diameterNm / 2000).toBeLessThan(0.171);
    }
    const topLeft = latticePhaseMapCoordinates(0, 0, 128, 30);
    const bottomRight = latticePhaseMapCoordinates(127, 127, 128, 30);
    expect(topLeft[0]).toBeLessThan(0);
    expect(topLeft[1]).toBeGreaterThan(0);
    expect(bottomRight).toEqual([-topLeft[0], -topLeft[1]]);
  });

  it('holds nominal geometry and the design phase fixed when illumination changes', () => {
    const original = latticePillarGeometry(state, 4, 2);
    const shifted = latticePillarGeometry({ ...state, wavelength: 0.65 }, 4, 2);
    expect(shifted.diameterNm).toBe(original.diameterNm);
    expect(shifted.targetPhase).toBe(original.targetPhase);
    expect(shifted).toEqual(original);
  });

  it('uses the same design phase as the far-field model for superimposed gradients', () => {
    const combined = { ...state, wavelength: 0.65,
      activeGradients: { lens: true, deflect: true, vortex: true, hologram: true } };
    for (const [x, y] of [[-5, 3], [6, -4], [0, 0]]) {
      const ideal = aperturePhase({ ...combined, ...combined.activeGradients }, x, y);
      expect(circularError(latticeTargetPhase(combined, x, y), ideal)).toBeLessThan(1e-12);
    }
  });

});
