import { describe, expect, it } from 'vitest';
import { computeFarField, FarFieldInput } from '@/lib/optics/farField';
import { FIN_CELL_TABLE } from '@/lib/optics/finCellTable';
import { pbResponse } from '@/lib/optics/finLut';
import { cabs2, Stokes, stokesFromEllipse } from '@/lib/optics/polarization';
import { computeXY, computeXZ, FieldWindow } from '@/lib/optics/propagation';

const RCP: Stokes = [1, 0, 0, 1];
const LCP: Stokes = [1, 0, 0, -1];
const H = stokesFromEllipse(0, 0);

const lens: FarFieldInput = {
  wavelength: 0.532, designWavelength: 0.532, focalLength: 25, diameter: 30, deflectionAngle: 0.35,
  topologicalCharge: 1, lens: true, deflect: false, vortex: false, hologram: false,
};
const pb = (stokes: Stokes, analyzer: FarFieldInput['analyzer'] = 'none'): FarFieldInput =>
  ({ ...lens, mechanism: 'pb', stokes, analyzer });

const power = (w: FieldWindow) => {
  let sum = 0;
  for (let i = 0; i < w.data.length; i++) sum += w.data[i] ** 2 + (w.dataB ? w.dataB[i] ** 2 : 0);
  return sum;
};
const overview = (p: FarFieldInput) => computeXZ(p, 30, 60, 256, 128);

describe('Nanofin RCWA table', () => {
  it('is passive and has negligible cross-coupling built in (|c|² + |d|² ≤ 1)', () => {
    const n = FIN_CELL_TABLE.longRe.length;
    for (let i = 0; i < n; i++) {
      const tL = FIN_CELL_TABLE.longRe[i] ** 2 + FIN_CELL_TABLE.longIm[i] ** 2;
      const tS = FIN_CELL_TABLE.shortRe[i] ** 2 + FIN_CELL_TABLE.shortIm[i] ** 2;
      // |c|² + |d|² = (|tL|² + |tS|²) / 2
      expect((tL + tS) / 2).toBeLessThanOrEqual(1.001);
    }
  });

  it('chooses an efficient half-wave fin at 532 nm whose conversion falls off with wavelength', () => {
    const atDesign = pbResponse(0.532, 0.532);
    expect(cabs2(atDesign.d)).toBeGreaterThan(0.6);
    expect(cabs2(pbResponse(0.532, 1.0).d)).toBeLessThan(cabs2(atDesign.d));
  });
});

describe('Pancharatnam-Berry metalens', () => {
  it('focuses RCP input into the LCP channel near the design focus', () => {
    const field = overview(pb(RCP, 'lcp'));
    expect(field.peakV).toBeGreaterThan(20);
    expect(field.peakV).toBeLessThan(30);
  });

  it('diverges LCP input: no focus, far lower peak than with RCP', () => {
    const rcp = overview(pb(RCP));
    const lcp = overview(pb(LCP));
    expect(lcp.peak).toBeLessThan(0.1 * rcp.peak);
  });

  it('splits linear input evenly between the two helicities', () => {
    const plus = power(computeXY(pb(H, 'rcp'), 2, 20, 20, 128, 128));
    const minus = power(computeXY(pb(H, 'lcp'), 2, 20, 20, 128, 128));
    expect(plus / minus).toBeGreaterThan(0.8);
    expect(plus / minus).toBeLessThan(1.25);
  });

  it('total intensity with no analyzer is the sum of the RCP and LCP analyzer intensities', () => {
    const p = pb(stokesFromEllipse(0.3, 0.2));
    const total = computeXY(p, 25, 10, 10, 64, 64);
    const a = computeXY({ ...p, analyzer: 'rcp' }, 25, 10, 10, 64, 64);
    const b = computeXY({ ...p, analyzer: 'lcp' }, 25, 10, 10, 64, 64);
    expect(total.peak).toBeGreaterThan(0);
    expect(power(total) / (power(a) + power(b))).toBeCloseTo(1, 4);
  });

  it('flips the vortex charge with the input helicity in the far field', () => {
    const vortex: FarFieldInput = { ...lens, lens: false, vortex: true, topologicalCharge: 1 };
    const winding = (stokes: Stokes, analyzer: 'lcp' | 'rcp') => {
      const far = computeFarField({ ...vortex, mechanism: 'pb', stokes, analyzer }, 64, 0.2);
      // Circulation of the phase on a ring around the centre.
      let total = 0;
      let last = NaN;
      for (let k = 0; k <= 64; k++) {
        const a = (k / 64) * 2 * Math.PI;
        const ox = Math.round(31.5 + 12 * Math.cos(a));
        const oy = Math.round(31.5 - 12 * Math.sin(a));
        const phase = Math.atan2(far.imaginary[oy * 64 + ox], far.real[oy * 64 + ox]);
        if (!Number.isNaN(last)) total += Math.atan2(Math.sin(phase - last), Math.cos(phase - last));
        last = phase;
      }
      return Math.round(total / (2 * Math.PI));
    };
    expect(Math.abs(winding(RCP, 'lcp'))).toBe(1);
    expect(winding(LCP, 'rcp')).toBe(-winding(RCP, 'lcp'));
  });
});

describe('Dynamic phase with polarization', () => {
  it('total intensity does not depend on the input polarization', () => {
    const dyn = (stokes: Stokes): FarFieldInput => ({ ...lens, mechanism: 'dynamic', stokes, analyzer: 'none' });
    const a = computeXY(dyn(RCP), 25, 10, 10, 64, 64);
    const b = computeXY(dyn(H), 25, 10, 10, 64, 64);
    const scalar = computeXY(lens, 25, 10, 10, 64, 64);
    expect(a.peak).toBeCloseTo(scalar.peak, 10);
    expect(b.peak).toBeCloseTo(scalar.peak, 10);
  });
});
