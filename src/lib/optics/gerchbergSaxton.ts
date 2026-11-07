import { fft } from './fft';
/**
 * Modified Gerchberg-Saxton (GS) Phase Retrieval for Phase-Only Computer-Generated Holography (CGH)
 */

export interface HologramResult {
  phaseMask: number[][];       // Phase mask in [0, 2pi) across N x N metasurface
  reconstructed: number[][];   // Reconstructed target intensity |E|^2 in far-field
  rmse: number;                // Root mean square reconstruction error
}

/** Mask rows follow physical +y; the Fourier output is displayed top to bottom. */
export function sampleHologramPhase(mask: number[][], x: number, y: number, diameter: number): number {
  const row = Math.min(mask.length - 1, Math.max(0, Math.floor((y / diameter + 0.5) * mask.length)));
  const col = Math.min(mask[row].length - 1, Math.max(0, Math.floor((x / diameter + 0.5) * mask[row].length)));
  return mask[row][col];
}

/** One source per phase cell, using the same circular pupil as phase retrieval. */
export function hologramPupilSamples(mask: number[][], diameter: number): Array<{ x: number; y: number; phase: number }> {
  const samples: Array<{ x: number; y: number; phase: number }> = [];
  for (let row = 0; row < mask.length; row++) for (let col = 0; col < mask[row].length; col++) {
    const x = ((col + 0.5) / mask[row].length - 0.5) * diameter;
    const y = ((row + 0.5) / mask.length - 0.5) * diameter;
    if (x * x + y * y <= diameter * diameter / 4) samples.push({ x, y, phase: mask[row][col] });
  }
  return samples;
}

/**
 * 2D Discrete Fourier Transform (and inverse) on N x N complex arrays.
 * For N = 32, 2D DFT runs in ~2ms.
 */
const dftKernels = new Map<number, { cos: Float64Array; sin: Float64Array; negSin: Float64Array }>();

function dftKernel(N: number) {
  let kernel = dftKernels.get(N);
  if (!kernel) {
    kernel = { cos: new Float64Array(N * N), sin: new Float64Array(N * N), negSin: new Float64Array(N * N) };
    for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) {
      const angle = 2 * Math.PI * k * n / N;
      kernel.cos[k * N + n] = Math.cos(angle);
      kernel.sin[k * N + n] = Math.sin(angle);
      kernel.negSin[k * N + n] = -Math.sin(angle);
    }
    dftKernels.set(N, kernel);
  }
  return kernel;
}

/** Radix-2 version of dftFlat for power-of-two N; the inverse is conj(DFT(conj(x))) / N². */
function dftFlatFft(
  reIn: Float64Array, imIn: Float64Array, N: number, inverse: boolean,
  outRe: Float64Array, outIm: Float64Array
): void {
  outRe.set(reIn);
  if (inverse) for (let i = 0; i < N * N; i++) outIm[i] = -imIn[i];
  else outIm.set(imIn);
  for (let r = 0; r < N; r++) fft(outRe, outIm, N, r * N, 1);
  for (let c = 0; c < N; c++) fft(outRe, outIm, N, c, N);
  if (inverse) {
    const norm = 1 / (N * N);
    for (let i = 0; i < N * N; i++) {
      outRe[i] *= norm;
      outIm[i] = -outIm[i] * norm;
    }
  }
}

/**
 * 2D DFT on flat row-major N x N arrays, written into outRe/outIm. The sums run in the same order
 * as the nested-array version, so results are identical; only the allocation and copying are gone.
 * `tempRe`/`tempIm` are N x N scratch.
 */
function dftFlat(
  reIn: Float64Array, imIn: Float64Array, N: number, inverse: boolean,
  outRe: Float64Array, outIm: Float64Array, tempRe: Float64Array, tempIm: Float64Array
): void {
  if (N >= 2 && (N & (N - 1)) === 0) {
    dftFlatFft(reIn, imIn, N, inverse, outRe, outIm);
    return;
  }
  const kernel = dftKernel(N);
  const cos = kernel.cos;
  const sin = inverse ? kernel.sin : kernel.negSin;
  const norm = inverse ? 1 / (N * N) : 1;

  // 1D DFT along rows
  for (let r = 0; r < N; r++) {
    const rowBase = r * N;
    for (let k = 0; k < N; k++) {
      const kBase = k * N;
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < N; n++) {
        const cosA = cos[kBase + n];
        const sinA = sin[kBase + n];
        const re = reIn[rowBase + n];
        const im = imIn[rowBase + n];
        sumRe += re * cosA - im * sinA;
        sumIm += re * sinA + im * cosA;
      }
      tempRe[rowBase + k] = sumRe;
      tempIm[rowBase + k] = sumIm;
    }
  }

  // 1D DFT along columns
  for (let c = 0; c < N; c++) {
    for (let k = 0; k < N; k++) {
      const kBase = k * N;
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < N; n++) {
        const cosA = cos[kBase + n];
        const sinA = sin[kBase + n];
        const re = tempRe[n * N + c];
        const im = tempIm[n * N + c];
        sumRe += re * cosA - im * sinA;
        sumIm += re * sinA + im * cosA;
      }
      outRe[k * N + c] = sumRe * norm;
      outIm[k * N + c] = sumIm * norm;
    }
  }
}

export function dft2d(
  reIn: number[][],
  imIn: number[][],
  inverse: boolean = false
): { re: number[][]; im: number[][] } {
  const N = reIn.length;
  const flatRe = new Float64Array(N * N);
  const flatIm = new Float64Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    flatRe[r * N + c] = reIn[r][c];
    flatIm[r * N + c] = imIn[r][c];
  }
  const outRe = new Float64Array(N * N);
  const outIm = new Float64Array(N * N);
  dftFlat(flatRe, flatIm, N, inverse, outRe, outIm, new Float64Array(N * N), new Float64Array(N * N));
  const rows = (flat: Float64Array) => Array.from({ length: N }, (_, r) => Array.from(flat.subarray(r * N, (r + 1) * N)));
  return { re: rows(outRe), im: rows(outIm) };
}

/**
 * FFT-shift utility: swaps quadrants so DC is at the center (N/2, N/2).
 */
export function fftShift2D(matrix: number[][]): number[][] {
  const N = matrix.length;
  const half = Math.floor(N / 2);
  const shifted: number[][] = Array.from({ length: N }, () => new Array(N));

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const newR = (r + half) % N;
      const newC = (c + half) % N;
      shifted[newR][newC] = matrix[r][c];
    }
  }
  return shifted;
}

/**
 * Generates synthetic target bitmaps (32x32) for CGH demonstration:
 * 'crest', 'smiley', or 'mu'.
 */
export function generateTargetBitmap(target: 'crest' | 'smiley' | 'mu', size: number = 32): number[][] {
  const grid: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const center = size / 2;

  if (target === 'smiley') {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const dx = c - center;
        const dy = r - center;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Face ring
        if (Math.abs(dist - 11) < 1.5) grid[r][c] = 1;
        // Eyes
        if (Math.sqrt((c - (center - 4)) ** 2 + (r - (center - 4)) ** 2) < 2) grid[r][c] = 1;
        if (Math.sqrt((c - (center + 4)) ** 2 + (r - (center - 4)) ** 2) < 2) grid[r][c] = 1;
        // Smile
        if (dist > 5 && dist < 8 && dy > 1) grid[r][c] = 1;
      }
    }
  } else if (target === 'mu') {
    // Greek letter mu
    for (let r = 6; r <= 24; r++) {
      grid[r][10] = 1; // Left descender
      if (r >= 12 && r <= 20) grid[r][16] = 1; // Middle stem
      if (r >= 12 && r <= 20) grid[r][22] = 1; // Right stem
      if (r === 20) {
        for (let c = 10; c <= 22; c++) grid[r][c] = 1; // Baseline
      }
    }
  } else {
    // University / Optics Crest: Diamond with an optical focal star
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const dx = Math.abs(c - center);
        const dy = Math.abs(r - center);
        if (Math.abs(dx + dy - 11) < 1.4) grid[r][c] = 1;
        // Crosshair / star
        if ((dx === 0 && dy < 7) || (dy === 0 && dx < 7)) grid[r][c] = 1;
        if (dx === dy && dx < 5) grid[r][c] = 1;
      }
    }
  }

  return grid;
}

/**
 * Runs the Gerchberg-Saxton iterative phase retrieval algorithm.
 */
export function runGerchbergSaxton(
  targetAmplitude: number[][],
  iterations: number = 20
): HologramResult {
  const N = targetAmplitude.length;
  if (N < 2 || targetAmplitude.some((row) => row.length !== N || row.some((value) => !Number.isFinite(value) || value < 0)) ||
    !targetAmplitude.some((row) => row.some((value) => value > 0))) {
    throw new RangeError('The target must be a finite, nonnegative square amplitude array with nonzero energy.');
  }
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('Iterations must be a positive integer.');

  // Everything runs on flat row-major arrays: no per-iteration allocation or copying.
  const metaRe = new Float64Array(N * N);
  const metaIm = new Float64Array(N * N);
  const aperture = new Float64Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      aperture[r * N + c] = Math.hypot(r + 0.5 - N / 2, c + 0.5 - N / 2) <= N / 2 ? 1 : 0;
    }
  }
  // A fixed initialization makes target/iteration comparisons reproducible.
  let seed = 42;
  // 1. Initial metasurface field: circular pupil with reproducible random phase
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const randPhase = (seed / 4294967296) * 2 * Math.PI;
      metaRe[r * N + c] = aperture[r * N + c] * Math.cos(randPhase);
      metaIm[r * N + c] = aperture[r * N + c] * Math.sin(randPhase);
    }
  }

  // Image center = floor(N/2); image up is +y. Map explicitly into
  // unshifted Fourier indices, including odd grids (fftshift != ifftshift).
  const half = Math.floor(N / 2);
  const shiftedTarget = new Float64Array(N * N);
  for (let ky = 0; ky < N; ky++) {
    for (let kx = 0; kx < N; kx++) shiftedTarget[ky * N + kx] = targetAmplitude[(half - ky + N) % N][(kx + half) % N];
  }

  const farRe = new Float64Array(N * N);
  const farIm = new Float64Array(N * N);
  const constrainedRe = new Float64Array(N * N);
  const constrainedIm = new Float64Array(N * N);
  const backRe = new Float64Array(N * N);
  const backIm = new Float64Array(N * N);
  const tempRe = new Float64Array(N * N);
  const tempIm = new Float64Array(N * N);

  for (let iter = 0; iter < iterations; iter++) {
    // Forward propagation to far-field (Fourier Transform)
    dftFlat(metaRe, metaIm, N, false, farRe, farIm, tempRe, tempIm);

    // Apply target amplitude constraint in far-field while retaining computed phase
    for (let i = 0; i < N * N; i++) {
      const re = farRe[i];
      const im = farIm[i];
      const mag = Math.sqrt(re * re + im * im) || 1e-9;
      const targetA = shiftedTarget[i];
      constrainedRe[i] = (re / mag) * targetA;
      constrainedIm[i] = (im / mag) * targetA;
    }

    // Inverse propagation back to metasurface plane
    dftFlat(constrainedRe, constrainedIm, N, true, backRe, backIm, tempRe, tempIm);

    // Apply metasurface phase-only constraint: unit amplitude A0 = 1
    for (let i = 0; i < N * N; i++) {
      const phase = Math.atan2(backIm[i], backRe[i]);
      metaRe[i] = aperture[i] * Math.cos(phase);
      metaIm[i] = aperture[i] * Math.sin(phase);
    }
  }

  // Final forward propagation to evaluate reconstruction
  dftFlat(metaRe, metaIm, N, false, farRe, farIm, tempRe, tempIm);

  const phaseMask: number[][] = Array.from({ length: N }, () => new Array(N));
  const rawRecon: number[][] = Array.from({ length: N }, () => new Array(N));
  let maxI = 0;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const p = Math.atan2(metaIm[i], metaRe[i]);
      phaseMask[r][c] = ((p % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      const intensity = farRe[i] * farRe[i] + farIm[i] * farIm[i];
      rawRecon[r][c] = intensity;
      if (intensity > maxI) maxI = intensity;
    }
  }

  // Shift far-field so target center aligns with center of view
  const centeredRecon = Array.from({ length: N }, (_, row) =>
    Array.from({ length: N }, (_, col) => rawRecon[(half - row + N) % N][(col - half + N) % N]));
  const normRecon = centeredRecon.map((row) =>
    row.map((val) => (maxI > 0 ? val / maxI : 0))
  );

  // Compute RMSE against target amplitude
  let errorSum = 0;
  const maxTarget = Math.max(...targetAmplitude.flat());
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const diff = Math.sqrt(normRecon[r][c]) - targetAmplitude[r][c] / maxTarget;
      errorSum += diff * diff;
    }
  }
  const rmse = Math.sqrt(errorSum / (N * N));

  return {
    phaseMask,
    reconstructed: normRecon,
    rmse
  };
}
