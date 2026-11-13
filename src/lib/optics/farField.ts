/**
 * Far-field (Fraunhofer) diffraction pattern of a metasurface aperture,
 * computed as the 2D Fourier transform of the transmitted aperture field.
 *
 * Output axes are direction sines (sin θx, sin θy) = λ·(fx, fy).
 */

import { pbResponse } from './finLut';
import { sampleHologramPhase } from './gerchbergSaxton';
import { Analyzer, ChannelMix, channelMixes, PhaseMechanism, Stokes } from './polarization';
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
  /** Dynamic-phase pillars (default) or rotated Pancharatnam-Berry nanofins. */
  mechanism?: PhaseMechanism;
  /** Input polarization. Without it the device is solved as a scalar (polarization-blind) field. */
  stokes?: Stokes;
  analyzer?: Analyzer;
}

/**
 * Displayed channels of a device (see channelMixes), or null for the scalar model. The dynamic-phase mixes
 * only scale one scalar field, which callers solve once.
 */
export function deviceChannels(p: FarFieldInput): ChannelMix[] | null {
  if (!p.stokes) return null;
  const mechanism = p.mechanism ?? 'dynamic';
  const pb = mechanism === 'pb' ? pbResponse(p.designWavelength, p.wavelength) : null;
  return channelMixes(mechanism, p.stokes, p.analyzer ?? 'none', pb);
}

/**
 * Transmitted field of the unit cell whose target phase is `phase`, written to out[0], out[1].
 * mix null: the dynamic pillar t(φ) from `response`. Otherwise the channel's dynamic scale, or for
 * PB fins k0 + k₊e^{iφ} + k₋e^{−iφ}.
 */
export function cellField(phase: number, response: { re: Float64Array; im: Float64Array },
  mix: ChannelMix | null, pb: boolean, out: Float64Array): void {
  if (pb && mix) {
    const co = Math.cos(phase);
    const si = Math.sin(phase);
    out[0] = mix.k0.re + (mix.kPlus.re + mix.kMinus.re) * co - (mix.kPlus.im - mix.kMinus.im) * si;
    out[1] = mix.k0.im + (mix.kPlus.im + mix.kMinus.im) * co + (mix.kPlus.re - mix.kMinus.re) * si;
    return;
  }
  const size = response.re.length;
  const bin = Math.floor((((phase / (2 * Math.PI)) % 1) + 1) % 1 * size) % size;
  out[0] = response.re[bin];
  out[1] = response.im[bin];
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
  const response = phaseResponse(p.designWavelength, p.wavelength);
  const mixes = ideal ? null : deviceChannels(p);
  const pb = (p.mechanism ?? 'dynamic') === 'pb' && mixes !== null;

  // Aperture sample coordinates
  const coord = new Float64Array(nAp);
  for (let i = 0; i < nAp; i++) coord[i] = ideal ? -radius + (i + 0.5) * step : (i - (nAp - 1) / 2) * step;
  const phases = new Float64Array(nAp * nAp); // [iy * nAp + ix]
  const inside = new Uint8Array(nAp * nAp);
  for (let iy = 0; iy < nAp; iy++) {
    for (let ix = 0; ix < nAp; ix++) {
      const x = coord[ix];
      const y = coord[iy];
      if (x * x + y * y > radius * radius) continue;
      inside[iy * nAp + ix] = 1;
      phases[iy * nAp + ix] = aperturePhase(p, x, y);
    }
  }
  const cell = new Float64Array(2);
  const aperture = (mix: ChannelMix | null) => {
    const eRe = new Float64Array(nAp * nAp);
    const eIm = new Float64Array(nAp * nAp);
    for (let i = 0; i < eRe.length; i++) {
      if (!inside[i]) continue;
      if (ideal) {
        eRe[i] = Math.cos(phases[i]);
        eIm[i] = Math.sin(phases[i]);
      } else {
        cellField(phases[i], response, mix, pb, cell);
        eRe[i] = cell[0];
        eIm[i] = cell[1];
      }
    }
    return { eRe, eIm };
  };

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

  const transform = ({ eRe, eIm }: { eRe: Float64Array; eIm: Float64Array }) => {
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
    const real = new Float64Array(outSize * outSize);
    const imaginary = new Float64Array(real.length);
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
        real[oy * outSize + ox] = sr;
        imaginary[oy * outSize + ox] = si;
      }
    }
    return { real, imaginary };
  };

  // Every dynamic-phase channel is a multiple of one scalar field, so only PB needs one transform each.
  let channels: { real: Float64Array; imaginary: Float64Array }[];
  if (!mixes) {
    channels = [transform(aperture(null))];
  } else if (!pb) {
    const base = transform(aperture(null));
    channels = mixes.map(({ scale }) => {
      const real = new Float64Array(base.real.length);
      const imaginary = new Float64Array(base.real.length);
      for (let i = 0; i < real.length; i++) {
        real[i] = base.real[i] * scale.re - base.imaginary[i] * scale.im;
        imaginary[i] = base.real[i] * scale.im + base.imaginary[i] * scale.re;
      }
      return { real, imaginary };
    });
  } else {
    channels = mixes.map((mix) => transform(aperture(mix)));
  }
  const out = new Float32Array(outSize * outSize);
  const real = new Float32Array(out.length);
  const imaginary = new Float32Array(out.length);
  let maxI = 0;
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (const ch of channels) v += ch.real[i] * ch.real[i] + ch.imaginary[i] * ch.imaginary[i];
    out[i] = v;
    real[i] = channels[0].real[i];
    imaginary[i] = channels[0].imaginary[i];
    if (v > maxI) maxI = v;
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
