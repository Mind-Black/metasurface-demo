// FROZEN COPY of src/lib/optics/gerchbergSaxton.ts at 32233e7. Do not edit: it is the numerical oracle for the performance work.
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
const dftKernels = new Map<number, { cos: Float64Array; sin: Float64Array }>();

export function dft2d(
  reIn: number[][],
  imIn: number[][],
  inverse: boolean = false
): { re: number[][]; im: number[][] } {
  const N = reIn.length;
  const reOut = Array.from({ length: N }, () => new Float64Array(N));
  const imOut = Array.from({ length: N }, () => new Float64Array(N));

  const sign = inverse ? 1 : -1;
  let kernel = dftKernels.get(N);
  if (!kernel) {
    kernel = { cos: new Float64Array(N * N), sin: new Float64Array(N * N) };
    for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) {
      const angle = 2 * Math.PI * k * n / N;
      kernel.cos[k * N + n] = Math.cos(angle);
      kernel.sin[k * N + n] = Math.sin(angle);
    }
    dftKernels.set(N, kernel);
  }

  // 1D DFT along rows
  const tempRe = Array.from({ length: N }, () => new Float64Array(N));
  const tempIm = Array.from({ length: N }, () => new Float64Array(N));

  for (let r = 0; r < N; r++) {
    for (let k = 0; k < N; k++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < N; n++) {
        const cosA = kernel.cos[k * N + n];
        const sinA = sign * kernel.sin[k * N + n];
        sumRe += reIn[r][n] * cosA - imIn[r][n] * sinA;
        sumIm += reIn[r][n] * sinA + imIn[r][n] * cosA;
      }
      tempRe[r][k] = sumRe;
      tempIm[r][k] = sumIm;
    }
  }

  // 1D DFT along columns
  for (let c = 0; c < N; c++) {
    for (let k = 0; k < N; k++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < N; n++) {
        const cosA = kernel.cos[k * N + n];
        const sinA = sign * kernel.sin[k * N + n];
        sumRe += tempRe[n][c] * cosA - tempIm[n][c] * sinA;
        sumIm += tempRe[n][c] * sinA + tempIm[n][c] * cosA;
      }
      const norm = inverse ? 1 / (N * N) : 1;
      reOut[k][c] = sumRe * norm;
      imOut[k][c] = sumIm * norm;
    }
  }

  return {
    re: reOut.map((row) => Array.from(row)),
    im: imOut.map((row) => Array.from(row))
  };
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

  // 1. Initial metasurface field: circular pupil with reproducible random phase
  let metaRe = Array.from({ length: N }, () => new Float64Array(N));
  let metaIm = Array.from({ length: N }, () => new Float64Array(N));
  const aperture = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => Math.hypot(r + 0.5 - N / 2, c + 0.5 - N / 2) <= N / 2 ? 1 : 0));
  // A fixed initialization makes target/iteration comparisons reproducible.
  let seed = 42;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const randPhase = (seed / 4294967296) * 2 * Math.PI;
      metaRe[r][c] = aperture[r][c] * Math.cos(randPhase);
      metaIm[r][c] = aperture[r][c] * Math.sin(randPhase);
    }
  }

  // Image center = floor(N/2); image up is +y. Map explicitly into
  // unshifted Fourier indices, including odd grids (fftshift != ifftshift).
  const half = Math.floor(N / 2);
  const shiftedTarget = Array.from({ length: N }, (_, ky) =>
    Array.from({ length: N }, (_, kx) => targetAmplitude[(half - ky + N) % N][(kx + half) % N]));

  for (let iter = 0; iter < iterations; iter++) {
    // Forward propagation to far-field (Fourier Transform)
    const farField = dft2d(
      metaRe.map((row) => Array.from(row)),
      metaIm.map((row) => Array.from(row)),
      false
    );

    // Apply target amplitude constraint in far-field while retaining computed phase
    const farConstrainedRe = Array.from({ length: N }, () => new Float64Array(N));
    const farConstrainedIm = Array.from({ length: N }, () => new Float64Array(N));

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const re = farField.re[r][c];
        const im = farField.im[r][c];
        const mag = Math.sqrt(re * re + im * im) || 1e-9;
        const targetA = shiftedTarget[r][c];
        farConstrainedRe[r][c] = (re / mag) * targetA;
        farConstrainedIm[r][c] = (im / mag) * targetA;
      }
    }

    // Inverse propagation back to metasurface plane
    const metaBack = dft2d(
      farConstrainedRe.map((row) => Array.from(row)),
      farConstrainedIm.map((row) => Array.from(row)),
      true
    );

    // Apply metasurface phase-only constraint: unit amplitude A0 = 1
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const re = metaBack.re[r][c];
        const im = metaBack.im[r][c];
        const phase = Math.atan2(im, re);
        metaRe[r][c] = aperture[r][c] * Math.cos(phase);
        metaIm[r][c] = aperture[r][c] * Math.sin(phase);
      }
    }
  }

  // Final forward propagation to evaluate reconstruction
  const finalFar = dft2d(
    metaRe.map((row) => Array.from(row)),
    metaIm.map((row) => Array.from(row)),
    false
  );

  const phaseMask: number[][] = Array.from({ length: N }, () => new Array(N));
  const rawRecon: number[][] = Array.from({ length: N }, () => new Array(N));
  let maxI = 0;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const p = Math.atan2(metaIm[r][c], metaRe[r][c]);
      phaseMask[r][c] = ((p % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      const fRe = finalFar.re[r][c];
      const fIm = finalFar.im[r][c];
      const intensity = fRe * fRe + fIm * fIm;
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
