import { describe, expect, it } from 'vitest';
import { dft2d, generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import * as legacy from './helpers/legacyGerchbergSaxton';

function sameMatrix(a: number[][], b: number[][], label: string) {
  expect(a.length, `${label} rows`).toBe(b.length);
  for (let r = 0; r < a.length; r++) {
    expect(a[r].length, `${label} row ${r} length`).toBe(b[r].length);
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) throw new Error(`${label}[${r}][${c}]: ${a[r][c]} !== ${b[r][c]}`);
    }
  }
}

describe('Gerchberg-Saxton matches the frozen legacy implementation exactly', () => {
  for (const target of ['crest', 'smiley', 'mu'] as const) {
    for (const iterations of [1, 15, 60, 500]) {
      it(`${target}, ${iterations} iterations`, () => {
        const bitmap = generateTargetBitmap(target);
        const now = runGerchbergSaxton(bitmap, iterations);
        const before = legacy.runGerchbergSaxton(bitmap, iterations);
        sameMatrix(now.phaseMask, before.phaseMask, 'phaseMask');
        sameMatrix(now.reconstructed, before.reconstructed, 'reconstructed');
        expect(now.rmse).toBe(before.rmse);
      }, 60000);
    }
  }

  it('handles odd grid sizes like the legacy version', () => {
    const bitmap = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ((r * 3 + c * 5) % 7 === 0 ? 1 : 0.1)));
    const now = runGerchbergSaxton(bitmap, 12);
    const before = legacy.runGerchbergSaxton(bitmap, 12);
    sameMatrix(now.phaseMask, before.phaseMask, 'phaseMask');
    expect(now.rmse).toBe(before.rmse);
  });
});

describe('dft2d matches the frozen legacy implementation exactly', () => {
  for (const N of [7, 9, 32]) {
    for (const inverse of [false, true]) {
      it(`N=${N}${inverse ? ', inverse' : ''}`, () => {
        const re = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => Math.sin(r * 1.7 + c * 0.3)));
        const im = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => Math.cos(r * 0.4 - c * 2.1)));
        const now = dft2d(re, im, inverse);
        const before = legacy.dft2d(re, im, inverse);
        sameMatrix(now.re, before.re, 're');
        sameMatrix(now.im, before.im, 'im');
      });
    }
  }
});
