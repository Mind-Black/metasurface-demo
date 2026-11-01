/**
 * Modified Gerchberg-Saxton (GS) Phase Retrieval for Phase-Only Computer-Generated Holography (CGH)
 */

export interface HologramResult {
  phaseMask: number[][];       // Phase mask in [0, 2pi) across N x N metasurface
  reconstructed: number[][];   // Reconstructed target intensity |E|^2 in far-field
  rmse: number;                // Root mean square reconstruction error
}

/**
 * 2D Discrete Fourier Transform (and inverse) on N x N complex arrays.
 * For N = 32, 2D DFT runs in ~2ms.
 */
function dft2d(
  reIn: number[][],
  imIn: number[][],
  inverse: boolean = false
): { re: number[][]; im: number[][] } {
  const N = reIn.length;
  const reOut = Array.from({ length: N }, () => new Float64Array(N));
  const imOut = Array.from({ length: N }, () => new Float64Array(N));

  const sign = inverse ? 1 : -1;
  const factor = (sign * 2 * Math.PI) / N;

  // 1D DFT along rows
  const tempRe = Array.from({ length: N }, () => new Float64Array(N));
  const tempIm = Array.from({ length: N }, () => new Float64Array(N));

  for (let r = 0; r < N; r++) {
    for (let k = 0; k < N; k++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < N; n++) {
        const angle = factor * k * n;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
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
        const angle = factor * k * n;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        sumRe += tempRe[n][c] * cosA - tempIm[n][c] * sinA;
        sumIm += tempRe[n][c] * sinA + tempIm[n][c] * cosA;
      }
      const norm = inverse ? 1 / N : 1;
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

  // 1. Initial metasurface field: uniform amplitude, random phase
  let metaRe = Array.from({ length: N }, () => new Float64Array(N));
  let metaIm = Array.from({ length: N }, () => new Float64Array(N));

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const randPhase = Math.random() * 2 * Math.PI;
      metaRe[r][c] = Math.cos(randPhase);
      metaIm[r][c] = Math.sin(randPhase);
    }
  }

  // Pre-shift target amplitude so target appears centered in far-field
  const shiftedTarget = fftShift2D(targetAmplitude);

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
        const mag = Math.sqrt(re * re + im * im) || 1e-9;
        metaRe[r][c] = re / mag;
        metaIm[r][c] = im / mag;
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
  const centeredRecon = fftShift2D(rawRecon);
  const normRecon = centeredRecon.map((row) =>
    row.map((val) => (maxI > 0 ? val / maxI : 0))
  );

  // Compute RMSE against target amplitude
  let errorSum = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const diff = Math.sqrt(normRecon[r][c]) - targetAmplitude[r][c];
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
