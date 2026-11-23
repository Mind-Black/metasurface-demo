import { describe, expect, it } from 'vitest';
import { FIN_CELL_TABLE as TABLE } from '@/lib/optics/finCellTable';
import { finJones, type Complex } from '@/lib/optics/polarization';
import { applyJones, conjVector, defaultHybridDesign, defaultOrthogonalDesign, designBasis, designCell, designKey, finMatrix, librarySupport, profilePhase, projectJones, selectFin, targetJones, type JonesMatrix, type JonesVector } from '@/lib/optics/metasurface';
import { getAxiconTargetPhase } from '@/lib/optics/phaseProfiles';

const c = (re: number, im = 0): Complex => ({ re, im });
const near = (a: Complex, b: Complex, eps = 1e-9) => expect(Math.hypot(a.re - b.re, a.im - b.im)).toBeLessThan(eps);
const inner = (a: JonesVector, b: JonesVector) => ({ re: a.ex.re * b.ex.re + a.ex.im * b.ex.im + a.ey.re * b.ey.re + a.ey.im * b.ey.im, im: a.ex.re * b.ex.im - a.ex.im * b.ex.re + a.ey.re * b.ey.im - a.ey.im * b.ey.re });
const identityError = (j: JonesMatrix) => {
  let error = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    let re = 0, im = 0;
    for (let r = 0; r < 2; r++) { re += j[r][a].re * j[r][b].re + j[r][a].im * j[r][b].im; im += j[r][a].re * j[r][b].im - j[r][a].im * j[r][b].re; }
    error = Math.max(error, Math.hypot(re - (a === b ? 1 : 0), im));
  }
  return error;
};

describe('polarization-resolved metasurface designs', () => {
  it('uses exact H/V and circular gauges and remains orthonormal for arbitrary ellipses', () => {
    const hv = designBasis(defaultOrthogonalDesign());
    near(hv[0].ex, c(1)); near(hv[0].ey, c(0)); near(hv[1].ex, c(0)); near(hv[1].ey, c(1));
    const circ = defaultOrthogonalDesign(); circ.basis = { psi: 0, chi: Math.PI / 4 };
    const cp = designBasis(circ), s = Math.SQRT1_2;
    near(cp[0].ex, c(s)); near(cp[0].ey, c(0, s)); near(cp[1].ex, c(s)); near(cp[1].ey, c(0, -s));
    for (const basis of [{ psi: 0.31, chi: 0.22 }, { psi: -0.7, chi: -0.3 }]) {
      const pair = designBasis({ ...defaultOrthogonalDesign(), basis });
      near(inner(pair[0], pair[0]), c(1)); near(inner(pair[1], pair[1]), c(1)); near(inner(pair[0], pair[1]), c(0));
    }
  });

  it('maps each arbitrary orthogonal basis vector to its independent profile phase', () => {
    const d = defaultOrthogonalDesign(); d.basis = { psi: 0.27, chi: -0.19 };
    const j = targetJones(d, 1.4, -0.8, 0.532, 12), pair = designBasis(d);
    for (let k = 0; k < 2; k++) {
      const out = applyJones(j, pair[k]);
      const gain = projectJones(out, conjVector(pair[k]));
      expect(Math.hypot(gain.re, gain.im)).toBeCloseTo(1, 10);
      const expected = conjVector(pair[k]);
      const residual = { ex: c(out.ex.re - gain.re * expected.ex.re + gain.im * expected.ex.im, out.ex.im - gain.re * expected.ex.im - gain.im * expected.ex.re), ey: c(out.ey.re - gain.re * expected.ey.re + gain.im * expected.ey.im, out.ey.im - gain.re * expected.ey.im - gain.im * expected.ey.re) };
      expect(Math.hypot(residual.ex.re, residual.ex.im, residual.ey.re, residual.ey.im)).toBeLessThan(1e-9);
    }
    expect(identityError(j)).toBeLessThan(1e-9);
  });

  it('sets hybrid PB handedness and applies a common dynamic phase', () => {
    const d = defaultHybridDesign();
    const neutral = { ...d, profiles: [{ ...d.profiles[0], lens: false }, d.profiles[1]] as [typeof d.profiles[0], typeof d.profiles[1]] };
    const j = targetJones(neutral, 0.8, 0.4, 0.532, 12);
    const pb = neutral.profiles[1].topologicalCharge * Math.atan2(0.4, 0.8);
    const expected = finJones(c(0, 1), c(0, -1), pb / 2);
    for (let r = 0; r < 2; r++) for (let col = 0; col < 2; col++) near(j[r][col], expected[r][col]);
    const shifted = defaultHybridDesign(); shifted.profiles[0] = { ...shifted.profiles[0], lens: false, deflect: true, deflectionAngle: 0.13 };
    d.profiles[0] = { ...d.profiles[0], lens: false };
    const a = targetJones(d, 0, 0, 0.532, 12), b = targetJones(shifted, 1, 0, 0.532, 12);
    const dynamic = Math.cos(2 * Math.PI * Math.sin(0.13) / 0.532);
    expect(b[0][0].re).toBeCloseTo(a[0][0].re * dynamic - a[0][0].im * Math.sin(2 * Math.PI * Math.sin(0.13) / 0.532), 8);
  });

  it('matches hybrid Jones response to circular orthogonal channels up to the common i phase', () => {
    const hybrid = defaultHybridDesign();
    hybrid.profiles[0] = { ...hybrid.profiles[0], lens: false };
    const orth = defaultOrthogonalDesign();
    orth.basis = { psi: 0, chi: Math.PI / 4 };
    orth.profiles = [
      { ...hybrid.profiles[0], vortex: true, topologicalCharge: 1 },
      { ...hybrid.profiles[0], vortex: true, topologicalCharge: -1 },
    ];
    const h = targetJones(hybrid, 0.9, 0.6, 0.532, 12), o = targetJones(orth, 0.9, 0.6, 0.532, 12);
    for (let r = 0; r < 2; r++) for (let col = 0; col < 2; col++) near(h[r][col], c(-o[r][col].im, o[r][col].re));
  });

  it('hashes hologram masks by content and reports library bounds explicitly', () => {
    const a = defaultOrthogonalDesign(), b = structuredClone(a);
    a.profiles[0].cghPhaseMask = [[0, 1], [2, 3]]; b.profiles[0].cghPhaseMask = [[0, 1], [2, 3]];
    expect(designKey(a)).toBe(designKey(b)); b.profiles[0].cghPhaseMask![1][1] += 0.01;
    expect(designKey(a)).not.toBe(designKey(b));
    expect(librarySupport(0.532, 0.532)).toBeNull();
    expect(librarySupport(0.399, 0.532)).toContain('within');
    expect(librarySupport(0.532, 0.532, 'Si')).toContain('TiO2');
  });

  it('matches the best geometry and orientation by full complex Frobenius error', () => {
    const target: JonesMatrix = [[c(0.4, 0.2), c(0.1, -0.05)], [c(0.1, -0.05), c(-0.2, 0.3)]];
    const selected = selectFin(target, 0.532);
    const nW = TABLE.widthsNm.length, nm = 532, u = (nm - 530) / 10;
    let best = Infinity;
    for (let g = 0; g < TABLE.lengthsNm.length * nW; g++) {
      const i = 13 * TABLE.lengthsNm.length * nW + g, j = i + TABLE.lengthsNm.length * nW;
      const mix = (re: readonly number[], im: readonly number[]) => c(re[i] * (1 - u) + re[j] * u, im[i] * (1 - u) + im[j] * u);
      const tL = mix(TABLE.longRe, TABLE.longIm), tS = mix(TABLE.shortRe, TABLE.shortIm);
      for (let k = 0; k < 180; k++) {
        const candidate = finJones(tL, tS, k * Math.PI / 180);
        let err = 0; for (let r = 0; r < 2; r++) for (let col = 0; col < 2; col++) err += (candidate[r][col].re - target[r][col].re) ** 2 + (candidate[r][col].im - target[r][col].im) ** 2;
        best = Math.min(best, err);
      }
    }
    expect(selected.error ** 2).toBeLessThanOrEqual(best + 0.002);
    const locked = { ...selected };
    const response = finMatrix(locked, 0.6);
    expect(response).toBeDefined();
    expect(selectFin(target, 0.532)).toEqual(locked);
  });

  it('keeps tabulated fin responses passive across supported wavelengths', () => {
    const selection = selectFin(targetJones(defaultOrthogonalDesign(), 0.2, 0.1, 0.532, 12), 0.532);
    for (const wavelength of [0.4, 0.532, 1.55]) {
      const j = finMatrix(selection, wavelength);
      for (const input of [{ ex: c(1), ey: c(0) }, { ex: c(0), ey: c(1) }]) {
        const out = applyJones(j, input);
        expect(out.ex.re ** 2 + out.ex.im ** 2 + out.ey.re ** 2 + out.ey.im ** 2).toBeLessThanOrEqual(1.01);
      }
    }
    expect(() => finMatrix(selection, 0.3)).toThrow(RangeError);
    expect(() => finMatrix(selection, Number.NaN)).toThrow(RangeError);
    expect(() => selectFin(targetJones(defaultOrthogonalDesign(), 0, 0, 0.532, 12), 0.399)).toThrow(RangeError);
    expect(designCell(defaultOrthogonalDesign(), 0, 0, 0.532, 12, 0.532, 'ideal').matrix).toBeDefined();
  });

  it('supports axicon profiles in orthogonal and Dynamic+PB hybrid designs and hashes axicon changes', () => {
    const orth = defaultOrthogonalDesign();
    orth.profiles[0] = { ...orth.profiles[0], lens: false, axicon: true, axiconNA: 0.4 };
    const x = 1.8, y = -1.2, lambda = 0.532, d = 12;
    expect(profilePhase(orth.profiles[0], x, y, lambda, d)).toBeCloseTo(getAxiconTargetPhase(x, y, lambda, 0.4), 10);
    const jOrth = targetJones(orth, x, y, lambda, d);
    const outH = applyJones(jOrth, { ex: c(1), ey: c(0) });
    const phiAx = getAxiconTargetPhase(x, y, lambda, 0.4);
    near(outH.ex, c(Math.cos(phiAx), Math.sin(phiAx)));
    near(outH.ey, c(0));

    const k1 = designKey(orth);
    orth.profiles[0].axiconNA = 0.55;
    expect(designKey(orth)).not.toBe(k1);

    // Hybrid Dynamic+PB: PB axicon flips sign between RCP->LCP and LCP->RCP
    const hybrid = defaultHybridDesign();
    hybrid.profiles[0] = { ...hybrid.profiles[0], lens: false, axicon: false };
    hybrid.profiles[1] = { ...hybrid.profiles[1], vortex: false, axicon: true, axiconNA: 0.35 };
    const jHyb = targetJones(hybrid, x, y, lambda, d);
    const s = Math.SQRT1_2;
    const rcp: JonesVector = { ex: c(s), ey: c(0, s) };
    const lcp: JonesVector = { ex: c(s), ey: c(0, -s) };
    const pbPhi = getAxiconTargetPhase(x, y, lambda, 0.35);
    near(projectJones(applyJones(jHyb, rcp), lcp), c(Math.cos(pbPhi + Math.PI / 2), Math.sin(pbPhi + Math.PI / 2)));
    near(projectJones(applyJones(jHyb, lcp), rcp), c(Math.cos(-pbPhi + Math.PI / 2), Math.sin(-pbPhi + Math.PI / 2)));
  });
});
