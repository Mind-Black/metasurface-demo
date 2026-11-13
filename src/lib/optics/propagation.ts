/**
 * Scalar angular-spectrum propagation of the field leaving the pillar lattice.
 * Each pillar contributes its RCWA transmission t(d, λ) over one unit cell, so sampling,
 * efficiency and zero-order leakage follow from the device instead of being added by hand.
 * Assumes each pillar responds like one in a periodic array (locally periodic approximation),
 * unit-amplitude normal illumination, and no evanescent field at z > 0.
 */
import { aperturePhase, cellField, deviceChannels, FarFieldInput } from './farField';
import { fft } from './fft';
import { ChannelMix, mixKey } from './polarization';
import { phaseResponse, TABLE_PITCH_UM } from './rcwaLut';

export { fft };

const N = 1024;
const TAU = 2 * Math.PI;
/** Bins with amplitude below this fraction of the strongest bin are skipped. */
const CULL = 1e-3;

export interface FieldWindow {
  data: Float32Array;  // displayed component A: interleaved re, im; row-major
  /** Orthogonal component B (analyzer 'none'), so |A|² + |B|² is the total intensity. */
  dataB?: Float32Array;
  nx: number;
  ny: number;
  peak: number;        // max |A|² + |B|²
  peakX: number;       // x of the peak [µm]
  peakV: number;       // y (XY) or z (XZ) of the peak [µm]
}

interface Spectrum {
  key: string;
  wavelength: number;
  fx0: number;       // frequency of column 0 [1/µm]
  fy0: number;       // frequency of row 0 [1/µm]
  df: number;
  cols: number;      // bounding box of significant bins
  rows: number;
  ix: Int32Array;    // bin column
  iy: Int32Array;    // bin row
  re: Float64Array;
  im: Float64Array;
  kz: Float64Array;  // axial wavenumber [rad/µm]
}

/**
 * Chirp-z transform: y[j] = Σ a[k] exp(2πi (f0 + k df)(x0 + j dx)) for arbitrary output spacing,
 * so each panel samples the exact field on its own pixels at any zoom.
 */
class Czt {
  private size: number;
  private chirpRe: Float64Array;
  private chirpIm: Float64Array;
  private preRe: Float64Array;
  private preIm: Float64Array;
  private postRe: Float64Array;
  private postIm: Float64Array;
  private kerRe: Float64Array;
  private kerIm: Float64Array;
  private workRe: Float64Array;
  private workIm: Float64Array;

  constructor(private inLen: number, private outLen: number, f0: number, df: number, x0: number, dx: number) {
    this.size = 1;
    while (this.size < inLen + outLen) this.size <<= 1;
    const beta = df * dx;
    const big = Math.max(inLen, outLen);
    this.chirpRe = new Float64Array(big);
    this.chirpIm = new Float64Array(big);
    for (let i = 0; i < big; i++) {
      const a = Math.PI * beta * i * i;
      this.chirpRe[i] = Math.cos(a);
      this.chirpIm[i] = Math.sin(a);
    }
    this.preRe = new Float64Array(inLen);
    this.preIm = new Float64Array(inLen);
    for (let k = 0; k < inLen; k++) {
      const a = TAU * k * df * x0;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.preRe[k] = this.chirpRe[k] * c - this.chirpIm[k] * s;
      this.preIm[k] = this.chirpRe[k] * s + this.chirpIm[k] * c;
    }
    this.postRe = new Float64Array(outLen);
    this.postIm = new Float64Array(outLen);
    for (let j = 0; j < outLen; j++) {
      const a = TAU * f0 * (x0 + j * dx);
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.postRe[j] = this.chirpRe[j] * c - this.chirpIm[j] * s;
      this.postIm[j] = this.chirpRe[j] * s + this.chirpIm[j] * c;
    }
    this.kerRe = new Float64Array(this.size);
    this.kerIm = new Float64Array(this.size);
    for (let n = 0; n < big; n++) {
      if (n < outLen) { this.kerRe[n] = this.chirpRe[n]; this.kerIm[n] = -this.chirpIm[n]; }
      if (n > 0 && n < inLen) { this.kerRe[this.size - n] = this.chirpRe[n]; this.kerIm[this.size - n] = -this.chirpIm[n]; }
    }
    fft(this.kerRe, this.kerIm, this.size);
    this.workRe = new Float64Array(this.size);
    this.workIm = new Float64Array(this.size);
  }

  /** Reads inLen samples from src at srcOffset + k * srcStride, writes outLen to dst likewise. */
  run(srcRe: Float64Array, srcIm: Float64Array, srcOffset: number, srcStride: number,
    dstRe: Float64Array, dstIm: Float64Array, dstOffset: number, dstStride: number): void {
    const { size, workRe, workIm, kerRe, kerIm } = this;
    workRe.fill(0);
    workIm.fill(0);
    for (let k = 0; k < this.inLen; k++) {
      const r = srcRe[srcOffset + k * srcStride];
      const i = srcIm[srcOffset + k * srcStride];
      workRe[k] = r * this.preRe[k] - i * this.preIm[k];
      workIm[k] = r * this.preIm[k] + i * this.preRe[k];
    }
    fft(workRe, workIm, size);
    for (let n = 0; n < size; n++) {
      const r = workRe[n] * kerRe[n] - workIm[n] * kerIm[n];
      const i = workRe[n] * kerIm[n] + workIm[n] * kerRe[n];
      // Conjugate so the forward FFT below acts as an inverse.
      workRe[n] = r;
      workIm[n] = -i;
    }
    fft(workRe, workIm, size);
    for (let j = 0; j < this.outLen; j++) {
      const r = workRe[j] / size;
      const i = -workIm[j] / size;
      dstRe[dstOffset + j * dstStride] = r * this.postRe[j] - i * this.postIm[j];
      dstIm[dstOffset + j * dstStride] = r * this.postIm[j] + i * this.postRe[j];
    }
  }
}

const maskKeys = new WeakMap<number[][], string>();

/**
 * Content hash of a hologram phase mask. Masks cross the worker boundary by structured clone, so
 * object identity cannot be used: every request would otherwise look like a new device.
 */
function maskKey(mask: number[][]): string {
  let key = maskKeys.get(mask);
  if (key === undefined) {
    const value = new Float64Array(1);
    const words = new Uint32Array(value.buffer);
    let h1 = 0x811c9dc5;
    let h2 = 0x9747b28c;
    for (const row of mask) {
      h1 = Math.imul(h1 ^ row.length, 16777619);
      h2 = Math.imul(h2 ^ row.length, 0x85ebca6b);
      for (let i = 0; i < row.length; i++) {
        value[0] = row[i];
        h1 = Math.imul(Math.imul(h1 ^ words[0], 16777619) ^ words[1], 16777619);
        h2 = Math.imul(h2 ^ words[0], 0x85ebca6b);
        h2 = Math.imul(h2 ^ (h2 >>> 13) ^ words[1], 0xc2b2ae35);
      }
    }
    key = `${mask.length}x${mask[0]?.length ?? 0}:${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
    maskKeys.set(mask, key);
  }
  return key;
}

/** Identifies the scalar device: everything that changes the dynamic-phase lattice field. */
function scalarKey(p: FarFieldInput): string {
  const mask = p.hologram && p.cghPhaseMask ? maskKey(p.cghPhaseMask) : '0';
  return [p.wavelength, p.designWavelength, p.focalLength, p.diameter, p.deflectionAngle,
    p.topologicalCharge, p.lens, p.deflect, p.vortex, p.hologram, mask].join('|');
}

/** Identifies everything that changes the displayed field, polarization included. */
export function deviceKey(p: FarFieldInput): string {
  const scalar = scalarKey(p);
  return p.stokes ? [scalar, p.mechanism ?? 'dynamic', ...p.stokes, p.analyzer ?? 'none'].join('|') : scalar;
}

const wrapIndex = (i: number) => ((i % N) + N) % N;
const sinc = (x: number) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Most recently used first. Two slots let a drag that alternates between two devices keep hitting. */
const spectrumCache: Spectrum[] = [];
const SPECTRUM_SLOTS = 4;

/** Scratch for the 1024² transform, reused across calls so a cold spectrum allocates only its result. */
const scratchRe = new Float64Array(N * N);
const scratchIm = new Float64Array(N * N);
const columnRe = new Float64Array(N);
const columnIm = new Float64Array(N);
const rowHasData = new Uint8Array(N);
const columnNeeded = new Uint8Array(N);

const cell = new Float64Array(2);

/**
 * Angular spectrum of the lattice field, including every order that propagates in air. `mix` selects
 * a PB output channel; without it the cells carry the dynamic pillar response t(φ).
 */
export function deviceSpectrum(p: FarFieldInput, mix: ChannelMix | null = null): Spectrum {
  const pb = mix !== null && p.mechanism === 'pb';
  // Dynamic-phase spectra do not depend on polarization, which only scales them afterwards.
  const key = pb ? `${scalarKey(p)}#pb#${mixKey(mix)}` : scalarKey(p);
  const hit = spectrumCache.findIndex((entry) => entry.key === key);
  if (hit === 0) return spectrumCache[0];
  if (hit > 0) {
    const [entry] = spectrumCache.splice(hit, 1);
    spectrumCache.unshift(entry);
    return entry;
  }
  const pitch = TABLE_PITCH_UM;
  const response = phaseResponse(p.designWavelength, p.wavelength);
  const re = scratchRe;
  const im = scratchIm;
  re.fill(0);
  im.fill(0);
  rowHasData.fill(0);
  const radius = p.diameter / 2;
  const limit = Math.floor(radius / pitch);
  for (let j = -limit; j <= limit; j++) {
    for (let i = -limit; i <= limit; i++) {
      const x = i * pitch;
      const y = j * pitch;
      if (x * x + y * y > radius * radius) continue;
      cellField(aperturePhase(p, x, y), response, mix, pb, cell);
      re[wrapIndex(j) * N + wrapIndex(i)] = cell[0];
      im[wrapIndex(j) * N + wrapIndex(i)] = cell[1];
      rowHasData[wrapIndex(j)] = 1;
    }
  }

  const df = 1 / (N * pitch);
  const fMax = 1 / p.wavelength;
  const span = Math.floor(fMax / df);
  const width = 2 * span + 1;

  // A row of zeros transforms to zeros, so only the rows holding aperture samples need the pass.
  for (let row = 0; row < N; row++) if (rowHasData[row]) fft(re, im, N, row * N, 1);
  // Only columns that are read below need the second pass. Gathering each into a contiguous buffer
  // keeps the butterflies out of the 8 kB-stride access pattern; the arithmetic is unchanged.
  columnNeeded.fill(0);
  for (let kx = -span; kx <= span; kx++) columnNeeded[wrapIndex(kx)] = 1;
  for (let col = 0; col < N; col++) {
    if (!columnNeeded[col]) continue;
    for (let row = 0, at = col; row < N; row++, at += N) {
      columnRe[row] = re[at];
      columnIm[row] = im[at];
    }
    fft(columnRe, columnIm, N);
    for (let row = 0, at = col; row < N; row++, at += N) {
      re[at] = columnRe[row];
      im[at] = columnIm[row];
    }
  }

  // The sinc envelope is separable, so tabulate it once per axis.
  const scale = 1 / (N * N);
  const sincAxis = new Float64Array(width);
  for (let k = 0; k < width; k++) sincAxis[k] = sinc((k - span) * df * pitch);

  let strongest = 0;
  for (let ky = -span; ky <= span; ky++) {
    const fy = ky * df;
    const sy = sincAxis[ky + span];
    const rowBase = wrapIndex(ky) * N;
    for (let kx = -span; kx <= span; kx++) {
      const fx = kx * df;
      if (fMax * fMax - fx * fx - fy * fy <= 0) continue;
      const envelope = sincAxis[kx + span] * sy * scale;
      const a = rowBase + wrapIndex(kx);
      const ar = re[a] * envelope;
      const ai = im[a] * envelope;
      const power = ar * ar + ai * ai;
      if (power > strongest) strongest = power;
    }
  }
  const cut = strongest * CULL * CULL;

  let count = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let ky = -span; ky <= span; ky++) {
    const fy = ky * df;
    const sy = sincAxis[ky + span];
    const rowBase = wrapIndex(ky) * N;
    for (let kx = -span; kx <= span; kx++) {
      const fx = kx * df;
      if (fMax * fMax - fx * fx - fy * fy <= 0) continue;
      const envelope = sincAxis[kx + span] * sy * scale;
      const a = rowBase + wrapIndex(kx);
      const ar = re[a] * envelope;
      const ai = im[a] * envelope;
      if (ar * ar + ai * ai === 0 || ar ** 2 + ai ** 2 < cut) continue;
      count++;
      if (kx < minX) minX = kx;
      if (kx > maxX) maxX = kx;
      if (ky < minY) minY = ky;
      if (ky > maxY) maxY = ky;
    }
  }

  const spectrum: Spectrum = {
    key, wavelength: p.wavelength, df,
    fx0: minX * df,
    fy0: minY * df,
    cols: count ? maxX - minX + 1 : 1,
    rows: count ? maxY - minY + 1 : 1,
    ix: new Int32Array(count), iy: new Int32Array(count),
    re: new Float64Array(count), im: new Float64Array(count), kz: new Float64Array(count),
  };
  let n = 0;
  for (let ky = -span; ky <= span; ky++) {
    const fy = ky * df;
    const sy = sincAxis[ky + span];
    const rowBase = wrapIndex(ky) * N;
    for (let kx = -span; kx <= span; kx++) {
      const fx = kx * df;
      const free = fMax * fMax - fx * fx - fy * fy;
      if (free <= 0) continue;
      const envelope = sincAxis[kx + span] * sy * scale;
      const a = rowBase + wrapIndex(kx);
      const ar = re[a] * envelope;
      const ai = im[a] * envelope;
      if (ar * ar + ai * ai === 0 || ar ** 2 + ai ** 2 < cut) continue;
      spectrum.ix[n] = kx - minX;
      spectrum.iy[n] = ky - minY;
      spectrum.re[n] = ar;
      spectrum.im[n] = ai;
      spectrum.kz[n++] = TAU * Math.sqrt(free);
    }
  }
  spectrumCache.unshift(spectrum);
  spectrumCache.length = Math.min(spectrumCache.length, SPECTRUM_SLOTS);
  return spectrum;
}

const cztCache = new Map<string, Czt>();
const CZT_SLOTS = 4;

/**
 * Chirp tables depend only on the sizes and sampling, which repeat across solves while the probe
 * moves. A run() is never interleaved with another, so sharing one instance is safe.
 */
function cztFor(inLen: number, outLen: number, f0: number, df: number, x0: number, dx: number): Czt {
  const key = [inLen, outLen, f0, df, x0, dx].join('|');
  let czt = cztCache.get(key);
  if (czt) {
    cztCache.delete(key);
  } else {
    czt = new Czt(inLen, outLen, f0, df, x0, dx);
    if (cztCache.size >= CZT_SLOTS) cztCache.delete(cztCache.keys().next().value!);
  }
  cztCache.set(key, czt);
  return czt;
}

interface Plane { re: Float64Array; im: Float64Array }

/**
 * Solves each displayed channel. Dynamic-phase channels are multiples of the one scalar field, so it is
 * solved once and scaled; PB channels each need their own spectrum.
 */
function solveChannels(p: FarFieldInput, solve: (mix: ChannelMix | null) => Plane): Plane[] {
  const mixes = deviceChannels(p);
  if (!mixes) return [solve(null)];
  if (p.mechanism === 'pb') return mixes.map((mix) => solve(mix));
  const base = solve(null);
  return mixes.map(({ scale }) => {
    const re = new Float64Array(base.re.length);
    const im = new Float64Array(base.re.length);
    for (let i = 0; i < re.length; i++) {
      re[i] = base.re[i] * scale.re - base.im[i] * scale.im;
      im[i] = base.re[i] * scale.im + base.im[i] * scale.re;
    }
    return { re, im };
  });
}

/** Complex field on the plane z over x ∈ ±halfX, y ∈ ±halfY, sampled at pixel centres. */
export function computeXY(p: FarFieldInput, z: number, halfX: number, halfY: number, nx: number, ny: number): FieldWindow {
  const dx = (2 * halfX) / nx;
  const dy = (2 * halfY) / ny;
  const x0 = -halfX + dx / 2;
  const y0 = -halfY + dy / 2;
  const planes = solveChannels(p, (mix) => xyPlane(deviceSpectrum(p, mix), p, z, nx, ny, x0, dx, y0, dy));
  return packField(planes, nx, ny, x0, dx, y0, dy);
}

function xyPlane(s: Spectrum, p: FarFieldInput, z: number, nx: number, ny: number,
  x0: number, dx: number, y0: number, dy: number): Plane {
  const { rows, cols, df } = s;
  const gridRe = new Float64Array(rows * cols);
  const gridIm = new Float64Array(rows * cols);
  // Matsushima band limit: beyond this angle the transfer function is undersampled.
  const limit = 1 / (p.wavelength * Math.sqrt((2 * df * z) ** 2 + 1));
  for (let i = 0; i < s.re.length; i++) {
    const fx = s.fx0 + s.ix[i] * df;
    const fy = s.fy0 + s.iy[i] * df;
    if (Math.abs(fx) > limit || Math.abs(fy) > limit) continue;
    const a = s.kz[i] * z;
    const c = Math.cos(a);
    const d = Math.sin(a);
    const at = s.iy[i] * cols + s.ix[i];
    gridRe[at] = s.re[i] * c - s.im[i] * d;
    gridIm[at] = s.re[i] * d + s.im[i] * c;
  }
  const rowsX = cztFor(cols, nx, s.fx0, df, x0, dx);
  const colsY = cztFor(rows, ny, s.fy0, df, y0, dy);
  const outRe = new Float64Array(ny * nx);
  const outIm = new Float64Array(ny * nx);
  // The two axes are independent, so transform the one that ends up with fewer lines second: a
  // wide panel needs rows + nx chirp-z runs one way and cols + ny the other.
  if (cols + ny < rows + nx) {
    const midRe = new Float64Array(ny * cols);
    const midIm = new Float64Array(ny * cols);
    for (let c = 0; c < cols; c++) colsY.run(gridRe, gridIm, c, cols, midRe, midIm, c, cols);
    for (let j = 0; j < ny; j++) rowsX.run(midRe, midIm, j * cols, 1, outRe, outIm, j * nx, 1);
  } else {
    const midRe = new Float64Array(rows * nx);
    const midIm = new Float64Array(rows * nx);
    for (let r = 0; r < rows; r++) rowsX.run(gridRe, gridIm, r * cols, 1, midRe, midIm, r * nx, 1);
    for (let c = 0; c < nx; c++) colsY.run(midRe, midIm, c, nx, outRe, outIm, c, nx);
  }
  return { re: outRe, im: outIm };
}

/**
 * Complex envelope E·exp(-ikz) on the plane y = 0, x ∈ ±halfX, z ∈ [0, zMax]. Removing the
 * carrier lets the z sampling stay coarse; the shader restores it per pixel.
 * Every second fy row is used, which folds the field at |y| = 128 µm onto y = 0.
 */
/** Starting phasor (2·E·exp(iβdz/2)) and per-step rotation of one spectral bin, written to out[at..at+3]. */
function startPhasor(s: Spectrum, i: number, k: number, dz: number, out: Float64Array, at: number): void {
  const beta = s.kz[i] - k;
  const startA = beta * dz / 2;
  const c0 = Math.cos(startA);
  const s0 = Math.sin(startA);
  out[at] = 2 * (s.re[i] * c0 - s.im[i] * s0);
  out[at + 1] = 2 * (s.re[i] * s0 + s.im[i] * c0);
  out[at + 2] = Math.cos(beta * dz);
  out[at + 3] = Math.sin(beta * dz);
}

const phasors = new Float64Array(16);

export function computeXZ(p: FarFieldInput, halfX: number, zMax: number, nx: number, nz: number): FieldWindow {
  const dx = (2 * halfX) / nx;
  const x0 = -halfX + dx / 2;
  const dz = zMax / nz;
  const planes = solveChannels(p, (mix) => xzPlane(deviceSpectrum(p, mix), p, nx, nz, x0, dx, dz));
  return packField(planes, nx, nz, x0, dx, dz / 2, dz);
}

function xzPlane(s: Spectrum, p: FarFieldInput, nx: number, nz: number, x0: number, dx: number, dz: number): Plane {
  const { cols, df } = s;
  const k = TAU / p.wavelength;
  // Group the used (even-iy) bins by column with a stable counting sort. Each plane cell still
  // receives its contributions in the original bin order, so the sums are unchanged, but a column
  // is now one contiguous run of nz values instead of a stride of `cols` doubles.
  const columnStart = new Int32Array(cols + 1);
  let used = 0;
  for (let i = 0; i < s.re.length; i++) {
    if (s.iy[i] & 1) continue;
    columnStart[s.ix[i] + 1]++;
    used++;
  }
  for (let c = 0; c < cols; c++) columnStart[c + 1] += columnStart[c];
  const order = new Int32Array(used);
  const next = columnStart.slice(0, cols);
  for (let i = 0; i < s.re.length; i++) {
    if (!(s.iy[i] & 1)) order[next[s.ix[i]]++] = i;
  }

  const planeRe = new Float64Array(cols * nz); // [col * nz + z]
  const planeIm = new Float64Array(cols * nz);
  for (let col = 0; col < cols; col++) {
    const base = col * nz;
    let m = columnStart[col];
    const end = columnStart[col + 1];
    // Four bins at a time: their rotations are independent, which hides the multiply latency of
    // each recurrence, and the cell is still summed in bin order (bin 0, then 1, 2, 3).
    for (; m + 4 <= end; m += 4) {
      for (let j = 0; j < 4; j++) startPhasor(s, order[m + j], k, dz, phasors, 4 * j);
      let ar0 = phasors[0], ai0 = phasors[1]; const sr0 = phasors[2], si0 = phasors[3];
      let ar1 = phasors[4], ai1 = phasors[5]; const sr1 = phasors[6], si1 = phasors[7];
      let ar2 = phasors[8], ai2 = phasors[9]; const sr2 = phasors[10], si2 = phasors[11];
      let ar3 = phasors[12], ai3 = phasors[13]; const sr3 = phasors[14], si3 = phasors[15];
      for (let z = 0, at = base; z < nz; z++, at++) {
        let pr = planeRe[at];
        let pi = planeIm[at];
        pr += ar0; pi += ai0;
        pr += ar1; pi += ai1;
        pr += ar2; pi += ai2;
        pr += ar3; pi += ai3;
        planeRe[at] = pr;
        planeIm[at] = pi;
        let t = ar0 * sr0 - ai0 * si0; ai0 = ar0 * si0 + ai0 * sr0; ar0 = t;
        t = ar1 * sr1 - ai1 * si1; ai1 = ar1 * si1 + ai1 * sr1; ar1 = t;
        t = ar2 * sr2 - ai2 * si2; ai2 = ar2 * si2 + ai2 * sr2; ar2 = t;
        t = ar3 * sr3 - ai3 * si3; ai3 = ar3 * si3 + ai3 * sr3; ar3 = t;
      }
    }
    for (; m < end; m++) {
      startPhasor(s, order[m], k, dz, phasors, 0);
      let ar = phasors[0], ai = phasors[1];
      const stepR = phasors[2], stepI = phasors[3];
      for (let z = 0, at = base; z < nz; z++, at++) {
        planeRe[at] += ar;
        planeIm[at] += ai;
        const t = ar * stepR - ai * stepI;
        ai = ar * stepI + ai * stepR;
        ar = t;
      }
    }
  }
  const toX = cztFor(cols, nx, s.fx0, df, x0, dx);
  const outRe = new Float64Array(nz * nx);
  const outIm = new Float64Array(nz * nx);
  for (let z = 0; z < nz; z++) toX.run(planeRe, planeIm, z, nz, outRe, outIm, z * nx, 1);
  return { re: outRe, im: outIm };
}

function packField(planes: Plane[], nx: number, ny: number,
  x0: number, dx: number, v0: number, dv: number): FieldWindow {
  const [a, b] = planes;
  const data = new Float32Array(2 * nx * ny);
  const dataB = b ? new Float32Array(2 * nx * ny) : undefined;
  let peak = 0;
  let at = 0;
  for (let i = 0; i < a.re.length; i++) {
    data[2 * i] = a.re[i];
    data[2 * i + 1] = a.im[i];
    let v = a.re[i] * a.re[i] + a.im[i] * a.im[i];
    if (b) {
      dataB![2 * i] = b.re[i];
      dataB![2 * i + 1] = b.im[i];
      v += b.re[i] * b.re[i] + b.im[i] * b.im[i];
    }
    if (v > peak) { peak = v; at = i; }
  }
  return { data, dataB, nx, ny, peak, peakX: x0 + (at % nx) * dx, peakV: v0 + Math.floor(at / nx) * dv };
}
