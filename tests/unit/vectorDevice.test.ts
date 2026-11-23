import { describe, expect, it } from 'vitest';
import { computeFarField, type FarFieldInput } from '@/lib/optics/farField';
import {
  applyJones, defaultHybridDesign, defaultOrthogonalDesign, designBasis, profilePhase,
  projectJones, targetJones, type JonesVector,
} from '@/lib/optics/metasurface';
import { vectorDeviceKey, vectorSampler } from '@/lib/optics/vectorDevice';
import { opticsStore } from '@/lib/store/useOpticsStore';
import { jonesFromStokes } from '@/lib/optics/polarization';
import { computeXY } from '@/lib/optics/propagation';

const base = (): FarFieldInput => ({
  wavelength: 0.532, designWavelength: 0.532, focalLength: 25, diameter: 4,
  deflectionAngle: 0, topologicalCharge: 1, lens: false, deflect: false, vortex: false, hologram: false,
  design: defaultOrthogonalDesign(),
});
const intensity = (v: { re: number; im: number }) => v.re * v.re + v.im * v.im;
const cx = (re: number, im = 0) => ({ re, im });

describe('vector metasurface propagation', () => {
  it('keeps the two orthogonal profiles independent: one focuses and the other steers', () => {
    const p = base();
    p.stokes = [1, 1, 0, 0]; // H selects the first default channel.
    p.analyzer = 'channel1';
    const focus = computeFarField(p, 40, 0.8);
    p.stokes = [1, -1, 0, 0]; // V selects the second default channel.
    p.analyzer = 'channel2';
    const steer = computeFarField(p, 40, 0.8);
    const peakIndex = (a: Float32Array) => {
      let max = -1, index = -1;
      for (let i = 0; i < a.length; i++) if (a[i] > max) { max = a[i]; index = i; }
      return index;
    };
    const fi = peakIndex(focus.intensity), si = peakIndex(steer.intensity);
    const fx = fi % focus.size, sx = si % steer.size;
    expect(Math.abs(fx - 19.5)).toBeLessThan(3);
    expect(sx).toBeGreaterThan(fx + 5);
  });

  it('applies shared dynamic phase while the hybrid geometric phase changes sign by circular channel', () => {
    const d = defaultHybridDesign();
    const lambda = 0.532, diameter = 12, x = 1.1, y = 0.7;
    const j = targetJones(d, x, y, lambda, diameter);
    const [rcp, lcp] = [jonesFromStokes([1, 0, 0, 1]), jonesFromStokes([1, 0, 0, -1])];
    const r = applyJones(j, rcp), l = applyJones(j, lcp);
    const dynamic = profilePhase(d.profiles[0], x, y, lambda, diameter);
    const pb = profilePhase(d.profiles[1], x, y, lambda, diameter);
    const expectedR = { re: Math.cos(dynamic + pb + Math.PI / 2), im: Math.sin(dynamic + pb + Math.PI / 2) };
    const expectedL = { re: Math.cos(dynamic - pb + Math.PI / 2), im: Math.sin(dynamic - pb + Math.PI / 2) };
    const closeComplex = (a: { re: number; im: number }, b: { re: number; im: number }) => {
      expect(a.re).toBeCloseTo(b.re, 10); expect(a.im).toBeCloseTo(b.im, 10);
    };
    closeComplex(projectJones(r, lcp), expectedR);
    closeComplex(projectJones(l, rcp), expectedL);
  });

  it('projects linear analyzer fields coherently and conserves power across an orthogonal analyzer pair', () => {
    const d = defaultOrthogonalDesign();
    d.profiles[0] = { ...d.profiles[0], lens: true, focalLength: 0.25 };
    d.profiles[1] = { ...d.profiles[1], lens: false, deflect: true, deflectionAngle: 0.3 };
    const x = 0.25, y = 0, lambda = 0.532;
    const matrix = targetJones(d, x, y, lambda, 4);
    const plus45: JonesVector = jonesFromStokes([1, 0, 1, 0]);
    const out = applyJones(matrix, plus45);
    const [b1, b2] = designBasis(d);
    const c1 = projectJones(out, b1), c2 = projectJones(out, b2);
    expect(intensity(c1) + intensity(c2)).toBeCloseTo(intensity(out.ex) + intensity(out.ey), 10);
    const analyzed = projectJones(out, plus45);
    const phi1 = profilePhase(d.profiles[0], x, y, lambda, 4);
    const phi2 = profilePhase(d.profiles[1], x, y, lambda, 4);
    expect(intensity(analyzed)).toBeCloseTo((1 + Math.cos(phi1 - phi2)) / 2, 10);
    expect(Math.abs(intensity(analyzed) - 0.5)).toBeGreaterThan(0.05);
  });

  it('includes either channel profile and every hologram mask sample in the field cache key', () => {
    const p = base();
    const initial = vectorDeviceKey(p);
    const design = p.design as Extract<NonNullable<FarFieldInput['design']>, { kind: 'orthogonal' }>;
    design.profiles[0].focalLength += 1;
    expect(vectorDeviceKey(p)).not.toBe(initial);
    const afterProfile = vectorDeviceKey(p);
    design.profiles[1].cghPhaseMask = [[0, 1], [2, 3]];
    expect(vectorDeviceKey(p)).not.toBe(afterProfile);
    const afterMask = vectorDeviceKey(p);
    design.profiles[1].cghPhaseMask![1][1] = 4;
    expect(vectorDeviceKey(p)).not.toBe(afterMask);
  });

  it('wraps accumulated profile phase into [0, 2π)', () => {
    const profile = { ...defaultOrthogonalDesign().profiles[0], vortex: true, topologicalCharge: 97 };
    for (const [x, y] of [[1, 2], [-3, 1], [0.5, -2]]) {
      const value = profilePhase(profile, x, y, 0.532, 8);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 * Math.PI);
    }
  });

  it('samples output polarization as Jones amplitude', () => {
    const p = base(); p.stokes = [1, 1, 0, 0];
    const sample = vectorSampler(p), out = new Float64Array(2);
    sample(0, 0, 0, out);
    expect(out[0]).toBeCloseTo(1, 10);
    expect(out[1]).toBeCloseTo(0, 10);
  });

  it('preserves independent design profiles and channel masks while switching architectures', () => {
    const store = opticsStore.getState();
    store.setDesignKind('orthogonal');
    store.setProfile(0, { focalLength: 33, cghPhaseMask: [[7, 8], [9, 10]], hologram: true });
    store.setProfile(1, { cghPhaseMask: [[0, 1], [2, 3]], hologram: true });
    store.setDesignKind('hybrid');
    store.setProfile(1, { topologicalCharge: 4 });
    store.setDesignKind('orthogonal');
    const orthogonal = opticsStore.getState().design;
    expect(orthogonal.kind).toBe('orthogonal');
    if (orthogonal.kind === 'orthogonal') {
      expect(orthogonal.profiles[0].focalLength).toBe(33);
      expect(orthogonal.profiles[0].cghPhaseMask).toEqual([[7, 8], [9, 10]].map(row => row.map(v => v % (2 * Math.PI))));
      expect(orthogonal.profiles[1].cghPhaseMask).toEqual([[0, 1], [2, 3]]);
      expect(orthogonal.profiles[0].cghPhaseMask).not.toEqual(orthogonal.profiles[1].cghPhaseMask);
      expect(orthogonal.profiles[1].hologram).toBe(true);
    }
    store.setDesignKind('hybrid');
    const hybrid = opticsStore.getState().design;
    expect(hybrid.kind).toBe('hybrid');
    if (hybrid.kind === 'hybrid') expect(hybrid.profiles[1].topologicalCharge).toBe(4);
    store.setDesignKind('legacy');
  });

  it('keeps each response selection while new configurations initially use the ideal target', () => {
    const initial = opticsStore.getState();
    try {
      opticsStore.update({ savedOrthogonalResponseModel: 'ideal', savedHybridResponseModel: 'ideal' });
      initial.setDesignKind('orthogonal');
      initial.setResponseModel('library');
      initial.setDesignKind('hybrid');
      expect(opticsStore.getState().responseModel).toBe('ideal');
      initial.setDesignKind('orthogonal');
      expect(opticsStore.getState().responseModel).toBe('library');
    } finally { opticsStore.update(initial); }
  });

  it('propagates both transverse components and sums orthogonal analyzer intensities', () => {
    const p = base();
    p.stokes = [1, 0, 0, 1];
    const total = computeXY(p, 5, 4, 4, 24, 24);
    const a = computeXY({ ...p, analyzer: 'channel1' }, 5, 4, 4, 24, 24);
    const b = computeXY({ ...p, analyzer: 'channel2' }, 5, 4, 4, 24, 24);
    expect(total.dataB).toBeDefined();
    let totalPower = 0, analyzedPower = 0;
    for (let i = 0; i < total.data.length; i++) {
      totalPower += total.data[i] ** 2 + total.dataB![i] ** 2;
      analyzedPower += a.data[i] ** 2 + b.data[i] ** 2;
    }
    expect(totalPower).toBeGreaterThan(0);
    expect(totalPower / analyzedPower).toBeCloseTo(1, 5);
  });

  it('propagates orthogonal axicon channel independently and validates axiconNA in store profiles', () => {
    const d = defaultOrthogonalDesign();
    d.profiles[0] = { ...d.profiles[0], lens: false, axicon: true, axiconNA: 0.35 };
    const p = { ...base(), diameter: 16, design: d };
    const keyBefore = vectorDeviceKey(p);
    d.profiles[0].axiconNA = 0.45;
    expect(vectorDeviceKey(p)).not.toBe(keyBefore);
    d.profiles[0].axiconNA = 0.35;

    p.stokes = [1, 1, 0, 0];
    p.analyzer = 'channel1';
    const axFar = computeFarField(p, 65, 0.6);
    let maxIdx = 0;
    for (let i = 1; i < axFar.intensity.length; i++) if (axFar.intensity[i] > axFar.intensity[maxIdx]) maxIdx = i;
    const sx = -0.6 + ((maxIdx % 65 + 0.5) / 65) * 1.2;
    const sy = 0.6 - ((Math.floor(maxIdx / 65) + 0.5) / 65) * 1.2;
    expect(Math.hypot(sx, sy)).toBeCloseTo(0.35, 1);
    expect(axFar.intensity[32 * 65 + 32]).toBeLessThan(0.5);

    const store = opticsStore.getState();
    store.setDesignKind('orthogonal');
    store.setProfile(0, { axicon: true, axiconNA: 0.45 });
    expect(() => store.setProfile(0, { axiconNA: 1.0 })).toThrow(RangeError);
    expect(() => store.setProfile(0, { axiconNA: -1.2 })).toThrow(RangeError);
    expect(() => store.setProfile(0, { axiconNA: Number.NaN })).toThrow(RangeError);
    store.setDesignKind('hybrid');
    store.setProfile(0, { axicon: true, axiconNA: 0.5 });
    store.setProfile(1, { axicon: true, axiconNA: -0.25 });
    store.setDesignKind('orthogonal');
    const orthState = opticsStore.getState().design;
    expect(orthState.kind).toBe('orthogonal');
    if (orthState.kind === 'orthogonal') {
      expect(orthState.profiles[0].axicon).toBe(true);
      expect(orthState.profiles[0].axiconNA).toBe(0.45);
    }
    store.setDesignKind('hybrid');
    const hybState = opticsStore.getState().design;
    expect(hybState.kind).toBe('hybrid');
    if (hybState.kind === 'hybrid') {
      expect(hybState.profiles[0].axicon).toBe(true);
      expect(hybState.profiles[0].axiconNA).toBe(0.5);
      expect(hybState.profiles[1].axicon).toBe(true);
      expect(hybState.profiles[1].axiconNA).toBe(-0.25);
    }
    store.setDesignKind('legacy');
  });
});
