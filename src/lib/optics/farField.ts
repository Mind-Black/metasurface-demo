/**
 * Far-field (Fraunhofer) diffraction pattern of a metasurface aperture,
 * computed as the 2D Fourier transform of the transmitted aperture field.
 *
 * Output axes are direction sines (sin θx, sin θy) = λ·(fx, fy).
 */

import { sampleHologramPhase } from './gerchbergSaxton';
import { phaseResponse, TABLE_PITCH_UM } from './rcwaLut';

export interface FarFieldInput {
  wavelength: number;        // operating wavelength [µm]
  designWavelength: number;  // fabrication design wavelength [µm]
  focalLength: number;       // [µm]
  diameter: number;          // aperture diameter [µm]
  deflectionAngle: number;   // [rad]
  topologicalCharge: number;
  lens: boolean;
  deflect: boolean;
  vortex: boolean;
  hologram: boolean;
  cghPhaseMask?: number[][] | null;
  /** Bypass the pillars: unit-amplitude ideal phase at point samples of this pitch [µm]. */
  idealPitch?: number;
}

export interface FarFieldResult {
  size: number;          // output grid is size x size, covering sinθ ∈ [-sinMax, sinMax]
  sinMax: number;
  real: Float32Array;      // complex field normalized by peak amplitude
  imaginary: Float32Array;
  intensity: Float32Array; // row-major, normalized so max = 1, row 0 = sinθy = +sinMax (top)
}

/** Transmitted aperture phase at (x, y) µm, matching the XZ/XY wavefield models. */
export function aperturePhase(p: FarFieldInput, x: number, y: number): number {
  const kDesign = (2 * Math.PI) / Math.max(0.2, p.designWavelength);
  let phase = 0;
  if (p.lens) {
    phase += -kDesign * (Math.sqrt(x * x + y * y + p.focalLength * p.focalLength) - p.focalLength);
  }
  if (p.deflect) phase += kDesign * Math.sin(p.deflectionAngle) * x;
  if (p.vortex) phase += p.topologicalCharge * Math.atan2(y, x);
  if (p.hologram && p.cghPhaseMask && p.cghPhaseMask.length > 0) {
    phase += sampleHologramPhase(p.cghPhaseMask, x, y, p.diameter);
  }
  return phase;
}

/**
 * Far-field = 2D Fourier transform of the pillar lattice field, evaluated directly
 * on a window sinθ ∈ [-sinMax, sinMax]² (matrix Fourier transform). Because the
 * transform kernel is separable this costs O(M·N² + M²·N) and gives exact angular
 * resolution at any zoom, with no FFT zero-padding limits.
 */
export function computeFarField(p: FarFieldInput, outSize = 256, sinMax = 1.0): FarFieldResult {
  const radius = p.diameter * 0.5;
  const ideal = p.idealPitch !== undefined;
  const nAp = ideal ? Math.ceil(p.diameter / p.idealPitch!) : 2 * Math.floor(radius / TABLE_PITCH_UM) + 1;
  const step = ideal ? p.diameter / nAp : TABLE_PITCH_UM;
  const k = (2 * Math.PI) / Math.max(0.05, p.wavelength);
  const response = ideal ? null : phaseResponse(p.designWavelength, p.wavelength);

  // Aperture sample coordinates and field
  const coord = new Float64Array(nAp);
  for (let i = 0; i < nAp; i++) coord[i] = ideal ? -radius + (i + 0.5) * step : (i - (nAp - 1) / 2) * step;
  const eRe = new Float64Array(nAp * nAp); // [iy * nAp + ix]
  const eIm = new Float64Array(nAp * nAp);
  for (let iy = 0; iy < nAp; iy++) {
    for (let ix = 0; ix < nAp; ix++) {
      const x = coord[ix];
      const y = coord[iy];
      if (x * x + y * y > radius * radius) continue;
      const ph = aperturePhase(p, x, y);
      if (response) {
        const size = response.re.length;
        const bin = Math.floor((((ph / (2 * Math.PI)) % 1) + 1) % 1 * size) % size;
        eRe[iy * nAp + ix] = response.re[bin];
        eIm[iy * nAp + ix] = response.im[bin];
      } else {
        eRe[iy * nAp + ix] = Math.cos(ph);
        eIm[iy * nAp + ix] = Math.sin(ph);
      }
    }
  }

  // Output sinθ axes (index 0 of y axis = +sinMax, i.e. top row)
  const sx = new Float64Array(outSize);
  const sy = new Float64Array(outSize);
  for (let o = 0; o < outSize; o++) {
    sx[o] = -sinMax + ((o + 0.5) / outSize) * 2 * sinMax;
    sy[o] = sinMax - ((o + 0.5) / outSize) * 2 * sinMax;
  }

  // Kernel tables: exp(-i k s c) for every (output, aperture) pair
  const kerRe = (s: Float64Array) => {
    const out = new Float64Array(outSize * nAp);
    for (let o = 0; o < outSize; o++) for (let i = 0; i < nAp; i++) out[o * nAp + i] = Math.cos(k * s[o] * coord[i]);
    return out;
  };
  const kerIm = (s: Float64Array) => {
    const out = new Float64Array(outSize * nAp);
    for (let o = 0; o < outSize; o++) for (let i = 0; i < nAp; i++) out[o * nAp + i] = -Math.sin(k * s[o] * coord[i]);
    return out;
  };
  const xRe = kerRe(sx), xIm = kerIm(sx);
  const yRe = kerRe(sy), yIm = kerIm(sy);

  // Step 1: transform along y for each aperture column: T[oy][ix] = Σ_iy E[iy][ix]·K_y[oy][iy]
  const tRe = new Float64Array(outSize * nAp);
  const tIm = new Float64Array(outSize * nAp);
  // Samples outside the circular aperture are exactly zero, so each row only needs its occupied span.
  const spanLo = new Int32Array(nAp).fill(nAp);
  const spanHi = new Int32Array(nAp).fill(-1);
  for (let iy = 0; iy < nAp; iy++) {
    for (let ix = 0; ix < nAp; ix++) {
      if (coord[ix] * coord[ix] + coord[iy] * coord[iy] > radius * radius) continue;
      if (ix < spanLo[iy]) spanLo[iy] = ix;
      if (ix > spanHi[iy]) spanHi[iy] = ix;
    }
  }
  for (let oy = 0; oy < outSize; oy++) {
    for (let iy = 0; iy < nAp; iy++) {
      const kr = yRe[oy * nAp + iy];
      const ki = yIm[oy * nAp + iy];
      for (let ix = spanLo[iy]; ix <= spanHi[iy]; ix++) {
        const er = eRe[iy * nAp + ix];
        const ei = eIm[iy * nAp + ix];
        tRe[oy * nAp + ix] += er * kr - ei * ki;
        tIm[oy * nAp + ix] += er * ki + ei * kr;
      }
    }
  }

  // Step 2: transform along x: F[oy][ox] = Σ_ix T[oy][ix]·K_x[ox][ix]
  const out = new Float32Array(outSize * outSize);
  const real = new Float32Array(out.length);
  const imaginary = new Float32Array(out.length);
  let maxI = 0;
  for (let oy = 0; oy < outSize; oy++) {
    for (let ox = 0; ox < outSize; ox++) {
      // Directions beyond sinθ = 1 carry no power to the far field.
      if (sx[ox] * sx[ox] + sy[oy] * sy[oy] > 1) continue;
      let sr = 0;
      let si = 0;
      for (let ix = 0; ix < nAp; ix++) {
        const tr = tRe[oy * nAp + ix];
        const ti = tIm[oy * nAp + ix];
        const kr = xRe[ox * nAp + ix];
        const ki = xIm[ox * nAp + ix];
        sr += tr * kr - ti * ki;
        si += tr * ki + ti * kr;
      }
      const v = sr * sr + si * si;
      out[oy * outSize + ox] = v;
      real[oy * outSize + ox] = sr;
      imaginary[oy * outSize + ox] = si;
      if (v > maxI) maxI = v;
    }
  }
  // Normalized to the propagating peak within the displayed window
  if (maxI > 0) {
    const amplitude = Math.sqrt(maxI);
    for (let i = 0; i < out.length; i++) {
      out[i] /= maxI;
      real[i] /= amplitude;
      imaginary[i] /= amplitude;
    }
  }
  return { size: outSize, sinMax, intensity: out, real, imaginary };
}
