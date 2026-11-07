import { describe, expect, it } from 'vitest';
import { fft } from '@/lib/optics/fft';
import { fft as legacyFft } from './helpers/legacyPropagation';

function random(length: number, seed: number): Float64Array {
  const out = new Float64Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    out[i] = s / 4294967296 * 2 - 1;
  }
  return out;
}

describe('fft', () => {
  for (const n of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]) {
    it(`is bit-identical to the legacy kernel for n=${n}, contiguous`, () => {
      const re = random(n, n), im = random(n, n + 1);
      const re2 = re.slice(), im2 = im.slice();
      fft(re, im, n);
      legacyFft(re2, im2, n);
      for (let i = 0; i < n; i++) {
        if (re[i] !== re2[i] || im[i] !== im2[i]) throw new Error(`n=${n} bin ${i}: ${re[i]},${im[i]} vs ${re2[i]},${im2[i]}`);
      }
    });
  }

  it('is bit-identical for an offset, strided column and leaves other samples untouched', () => {
    const n = 64, offset = 5, stride = 7;
    const length = offset + n * stride + 3;
    const re = random(length, 1), im = random(length, 2);
    const re2 = re.slice(), im2 = im.slice();
    fft(re, im, n, offset, stride);
    legacyFft(re2, im2, n, offset, stride);
    for (let i = 0; i < length; i++) {
      if (re[i] !== re2[i] || im[i] !== im2[i]) throw new Error(`sample ${i} differs`);
    }
  });

  it('matches a direct DFT', () => {
    const n = 32;
    const re = random(n, 9), im = random(n, 10);
    const dr = new Float64Array(n), di = new Float64Array(n);
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) {
      const a = -2 * Math.PI * k * j / n;
      dr[k] += re[j] * Math.cos(a) - im[j] * Math.sin(a);
      di[k] += re[j] * Math.sin(a) + im[j] * Math.cos(a);
    }
    fft(re, im, n);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(dr[k], 10);
      expect(im[k]).toBeCloseTo(di[k], 10);
    }
  });
});
