import { describe, expect, it } from 'vitest';
import {
  analyzerWeights, cadd, channelMixes, cmul, Complex, ellipseFromStokes, finJones, fromCircular,
  jonesFromStokes, pbFinAngle, stokesFromEllipse, stokesFromJones, toCircular,
} from '@/lib/optics/polarization';

const cx = (re: number, im = 0): Complex => ({ re, im });
const close = (a: Complex, b: Complex, digits = 10) => {
  expect(a.re).toBeCloseTo(b.re, digits);
  expect(a.im).toBeCloseTo(b.im, digits);
};
const expi = (a: number) => cx(Math.cos(a), Math.sin(a));

describe('Polarization conventions', () => {
  it('maps RCP to S3 = +1 and to e+ = (x + iy)/sqrt 2', () => {
    const s = stokesFromEllipse(0, Math.PI / 4);
    expect(s[3]).toBeCloseTo(1, 12);
    const { ex, ey } = jonesFromStokes([1, 0, 0, 1]);
    close(ex, cx(Math.SQRT1_2));
    close(ey, cx(0, Math.SQRT1_2));
    const { plus, minus } = toCircular(ex, ey);
    close(plus, cx(1));
    close(minus, cx(0));
  });

  it('round-trips Stokes, ellipse and Jones', () => {
    for (const [psi, chi] of [[0.3, 0.2], [-1.2, -0.5], [1.5, 0.05], [0, 0], [0.7, -0.7]]) {
      const s = stokesFromEllipse(psi, chi);
      const back = ellipseFromStokes(s);
      expect(back.chi).toBeCloseTo(chi, 10);
      expect(Math.cos(2 * back.psi)).toBeCloseTo(Math.cos(2 * psi), 10);
      expect(Math.sin(2 * back.psi)).toBeCloseTo(Math.sin(2 * psi), 10);
      const { ex, ey } = jonesFromStokes(s);
      const again = stokesFromJones(ex, ey);
      for (let i = 0; i < 4; i++) expect(again[i]).toBeCloseTo(s[i], 10);
      const circ = toCircular(ex, ey);
      const xy = fromCircular(circ.plus, circ.minus);
      close(xy.ex, ex);
      close(xy.ey, ey);
    }
  });

  it('analyzer weights project onto x, y and the circular states', () => {
    const ex = cx(0.3, -0.4);
    const ey = cx(-0.7, 0.2);
    const { plus, minus } = toCircular(ex, ey);
    const project = (a: 'x' | 'y' | 'rcp' | 'lcp') => {
      const u = analyzerWeights(a);
      return cadd(cmul(u.plus, plus), cmul(u.minus, minus));
    };
    close(project('x'), ex);
    close(project('y'), ey);
    close(project('rcp'), plus);
    close(project('lcp'), minus);
  });
});

describe('Rotated nanofin Jones matrix', () => {
  it('matches E+ = c a+ + d e^{-2i theta} a-, E- = c a- + d e^{2i theta} a+', () => {
    const tL = cx(0.8, -0.3);
    const tS = cx(-0.6, 0.5);
    const c = cx((tL.re + tS.re) / 2, (tL.im + tS.im) / 2);
    const d = cx((tL.re - tS.re) / 2, (tL.im - tS.im) / 2);
    for (const theta of [0, 0.4, 1.1, 2.7]) {
      const J = finJones(tL, tS, theta);
      for (const [ex, ey] of [[cx(1), cx(0)], [cx(0.2, 0.5), cx(-0.4, 0.1)]]) {
        const outX = cadd(cmul(J[0][0], ex), cmul(J[0][1], ey));
        const outY = cadd(cmul(J[1][0], ex), cmul(J[1][1], ey));
        const a = toCircular(ex, ey);
        const out = toCircular(outX, outY);
        close(out.plus, cadd(cmul(c, a.plus), cmul(cmul(d, expi(-2 * theta)), a.minus)));
        close(out.minus, cadd(cmul(c, a.minus), cmul(cmul(d, expi(2 * theta)), a.plus)));
      }
    }
  });

  it('an ideal half-wave fin at theta = phi/2 converts RCP fully to LCP with phase +phi', () => {
    const tL = cx(1);
    const tS = cx(-1);
    for (const phi of [0.5, 2, 4.5]) {
      const J = finJones(tL, tS, pbFinAngle(phi));
      const { ex, ey } = jonesFromStokes([1, 0, 0, 1]);
      const out = toCircular(cadd(cmul(J[0][0], ex), cmul(J[0][1], ey)), cadd(cmul(J[1][0], ex), cmul(J[1][1], ey)));
      close(out.plus, cx(0));
      close(out.minus, expi(phi));
    }
  });

  it('channel mixes reproduce the Jones model cell by cell', () => {
    const pb = { c: cx(0.2, 0.1), d: cx(0.7, -0.4) };
    const stokes = stokesFromEllipse(0.4, 0.25);
    const { ex, ey } = jonesFromStokes(stokes);
    const tL = cadd(pb.c, pb.d);
    const tS = cx(pb.c.re - pb.d.re, pb.c.im - pb.d.im);
    const [mx, my] = channelMixes('pb', stokes, 'none', pb);
    for (const phi of [0.3, 1.9, 5.2]) {
      const J = finJones(tL, tS, phi / 2);
      const outX = cadd(cmul(J[0][0], ex), cmul(J[0][1], ey));
      const outY = cadd(cmul(J[1][0], ex), cmul(J[1][1], ey));
      const cell = (m: typeof mx) => cadd(m.k0, cadd(cmul(m.kPlus, expi(phi)), cmul(m.kMinus, expi(-phi))));
      close(cell(mx), outX);
      close(cell(my), outY);
    }
  });

  it('dynamic-phase channels only scale the scalar field by the input Jones vector', () => {
    const stokes = stokesFromEllipse(-0.3, 0.1);
    const { ex, ey } = jonesFromStokes(stokes);
    const [mx, my] = channelMixes('dynamic', stokes, 'none', null);
    close(mx.scale, ex);
    close(my.scale, ey);
  });
});
