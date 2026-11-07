import { describe, expect, it } from 'vitest';
import { dft2d, generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import * as legacy from './helpers/legacyGerchbergSaxton';

const TAU = 2 * Math.PI;

function sameMatrix(a: number[][], b: number[][], label: string) {
  expect(a.length, `${label} rows`).toBe(b.length);
  for (let r = 0; r < a.length; r++) {
    expect(a[r].length, `${label} row ${r} length`).toBe(b[r].length);
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) throw new Error(`${label}[${r}][${c}]: ${a[r][c]} !== ${b[r][c]}`);
    }
  }
}

/** Largest element difference, optionally measured around the circle (phases that wrap at 2π). */
function maxDifference(a: number[][], b: number[][], circular = false): number {
  let worst = 0;
  for (let r = 0; r < a.length; r++) for (let c = 0; c < a[r].length; c++) {
    let d = Math.abs(a[r][c] - b[r][c]);
    if (circular) d = Math.min(d, TAU - d);
    if (d > worst) worst = d;
  }
  return worst;
}

describe('Gerchberg-Saxton on power-of-two grids (FFT path) tracks the frozen legacy implementation', () => {
  // The FFT sums in a different order than the direct DFT, so results agree to rounding error, not
  // bit for bit. Measured drift over 500 iterations is ~1e-10 rad; the bound leaves headroom.
  for (const target of ['crest', 'smiley', 'mu'] as const) {
    for (const iterations of [1, 15, 60, 500]) {
      it(`${target}, ${iterations} iterations`, () => {
        const bitmap = generateTargetBitmap(target);
        const now = runGerchbergSaxton(bitmap, iterations);
        const before = legacy.runGerchbergSaxton(bitmap, iterations);
        expect(maxDifference(now.phaseMask, before.phaseMask, true)).toBeLessThan(1e-8);
        expect(maxDifference(now.reconstructed, before.reconstructed)).toBeLessThan(1e-8);
        expect(Math.abs(now.rmse - before.rmse)).toBeLessThan(1e-8);
      }, 60000);
    }
  }
});

describe('Gerchberg-Saxton on other grid sizes matches the legacy implementation exactly', () => {
  it('handles odd grid sizes bit for bit', () => {
    const bitmap = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ((r * 3 + c * 5) % 7 === 0 ? 1 : 0.1)));
    const now = runGerchbergSaxton(bitmap, 12);
    const before = legacy.runGerchbergSaxton(bitmap, 12);
    sameMatrix(now.phaseMask, before.phaseMask, 'phaseMask');
    expect(now.rmse).toBe(before.rmse);
  });
});

describe('dft2d', () => {
  const input = (N: number) => ({
    re: Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => Math.sin(r * 1.7 + c * 0.3))),
    im: Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => Math.cos(r * 0.4 - c * 2.1))),
  });

  for (const N of [7, 9]) {
    for (const inverse of [false, true]) {
      it(`is bit-identical to the legacy version for N=${N}${inverse ? ', inverse' : ''}`, () => {
        const { re, im } = input(N);
        const now = dft2d(re, im, inverse);
        const before = legacy.dft2d(re, im, inverse);
        sameMatrix(now.re, before.re, 're');
        sameMatrix(now.im, before.im, 'im');
      });
    }
  }

  for (const N of [8, 32]) {
    for (const inverse of [false, true]) {
      it(`agrees with the legacy version to rounding error for N=${N}${inverse ? ', inverse' : ''}`, () => {
        const { re, im } = input(N);
        const now = dft2d(re, im, inverse);
        const before = legacy.dft2d(re, im, inverse);
        expect(maxDifference(now.re, before.re)).toBeLessThan(1e-10);
        expect(maxDifference(now.im, before.im)).toBeLessThan(1e-10);
      });
    }
  }

  it('inverts itself', () => {
    const { re, im } = input(32);
    const spectrum = dft2d(re, im);
    const restored = dft2d(spectrum.re, spectrum.im, true);
    expect(maxDifference(restored.re, re)).toBeLessThan(1e-12);
    expect(maxDifference(restored.im, im)).toBeLessThan(1e-12);
  });
});
