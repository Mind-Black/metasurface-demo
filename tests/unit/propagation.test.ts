import { describe, expect, it } from 'vitest';
import { aperturePhase, FarFieldInput } from '@/lib/optics/farField';
import { computeXY, computeXZ, deviceKey, fft } from '@/lib/optics/propagation';
import { phaseResponse, TABLE_PITCH_UM } from '@/lib/optics/rcwaLut';

const TAU = 2 * Math.PI;
const base: FarFieldInput = {
  wavelength: 0.532, designWavelength: 0.532, focalLength: 25, diameter: 30, deflectionAngle: 0.35,
  topologicalCharge: 1, lens: false, deflect: false, vortex: false, hologram: false,
};
const lens = { ...base, lens: true };

const intensity = (w: { data: Float32Array }, i: number) => w.data[2 * i] ** 2 + w.data[2 * i + 1] ** 2;
const transmission = (p: FarFieldInput, x: number, y: number) => {
  const response = phaseResponse(p.designWavelength, p.wavelength);
  const size = response.re.length;
  const bin = Math.floor((((aperturePhase(p, x, y) / TAU) % 1) + 1) % 1 * size) % size;
  return [response.re[bin], response.im[bin]];
};

const sinc = (x: number) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Independent reference: brute-force Rayleigh-Sommerfeld sum over the same pillars. */
function rayleighSommerfeld(p: FarFieldInput, px: number, py: number, pz: number): number {
  const pitch = TABLE_PITCH_UM;
  const radius = p.diameter / 2;
  const limit = Math.floor(radius / pitch);
  const k = TAU / p.wavelength;
  let re = 0;
  let im = 0;
  for (let j = -limit; j <= limit; j++) for (let i = -limit; i <= limit; i++) {
    const x = i * pitch;
    const y = j * pitch;
    if (x * x + y * y > radius * radius) continue;
    const r = Math.hypot(px - x, py - y, pz);
    const [tr, ti] = transmission(p, x, y);
    const c = Math.cos(k * r);
    const s = Math.sin(k * r);
    // (z / r)(1 / (iλ r)) exp(ikr) t(x, y) pitch², with the far-field pattern of one square cell
    const cell = sinc((pitch * (px - x)) / (p.wavelength * r)) * sinc((pitch * (py - y)) / (p.wavelength * r));
    const a = (pz / r) * (1 / (p.wavelength * r)) * pitch * pitch * cell;
    const fr = tr * c - ti * s;
    const fi = tr * s + ti * c;
    re += a * fi;
    im += -a * fr;
  }
  return re * re + im * im;
}

function fwhm(values: number[], step: number): number {
  const peak = values.indexOf(Math.max(...values));
  const half = values[peak] / 2;
  let left = peak;
  while (left > 0 && values[left] > half) left--;
  let right = peak;
  while (right < values.length - 1 && values[right] > half) right++;
  const l = left + (half - values[left]) / (values[left + 1] - values[left]);
  const r = right - 1 + (values[right - 1] - half) / (values[right - 1] - values[right]);
  return (r - l) * step;
}

/** Power into the intended order, averaged over target phase, for the pillars designed at 532 nm. */
function orderEfficiency(wavelength: number): number {
  const { re, im } = phaseResponse(0.532, wavelength);
  let sr = 0;
  let si = 0;
  for (let b = 0; b < re.length; b++) {
    const phase = ((b + 0.5) / re.length) * TAU;
    sr += re[b] * Math.cos(phase) + im[b] * Math.sin(phase);
    si += im[b] * Math.cos(phase) - re[b] * Math.sin(phase);
  }
  return (sr ** 2 + si ** 2) / re.length ** 2;
}

describe('FFT', () => {
  it('matches a direct DFT', () => {
    const n = 16;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.3));
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.7));
    const copyRe = re.slice();
    const copyIm = im.slice();
    fft(re, im, n);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let i = 0; i < n; i++) {
        const a = (-TAU * i * k) / n;
        sr += copyRe[i] * Math.cos(a) - copyIm[i] * Math.sin(a);
        si += copyRe[i] * Math.sin(a) + copyIm[i] * Math.cos(a);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
  });
});

describe('RCWA pillar design', () => {
  it('sends most light into the intended order at the design wavelength', () => {
    expect(orderEfficiency(0.532)).toBeGreaterThan(0.8);
  });

  it('loses efficiency away from the design wavelength, as a real device does', () => {
    expect(orderEfficiency(1.55)).toBeLessThan(0.45);
    expect(orderEfficiency(0.4)).toBeLessThan(orderEfficiency(0.532));
  });

  it('never transmits more power than it receives', () => {
    for (const lam of [0.4, 0.532, 0.65, 1.55]) {
      const { re, im } = phaseResponse(0.532, lam);
      for (let b = 0; b < re.length; b++) expect(re[b] ** 2 + im[b] ** 2).toBeLessThanOrEqual(1.001);
    }
  });
});

describe('angular-spectrum engine vs independent references', () => {
  it('matches a brute-force Rayleigh-Sommerfeld sum over the pillars', () => {
    const p = { ...lens, diameter: 15, focalLength: 12 };
    const plane = computeXY(p, 12, 6, 6, 25, 25);
    for (const [ix, iy] of [[12, 12], [13, 12], [14, 12], [12, 15]]) {
      const x = -6 + (ix + 0.5) * 0.48;
      const y = -6 + (iy + 0.5) * 0.48;
      const reference = rayleighSommerfeld(p, x, y, 12);
      expect(intensity(plane, iy * 25 + ix) / reference).toBeCloseTo(1, 2);
    }
  });

  it('XZ and XY agree at the same point', () => {
    const xz = computeXZ(lens, 20, 60, 201, 240);
    const row = 99;
    const z = (row + 0.5) * 0.25;
    const xy = computeXY(lens, z, 20, 0.05, 201, 1);
    for (const col of [96, 100, 103]) expect(intensity(xz, row * 201 + col) / intensity(xy, col)).toBeCloseTo(1, 2);
  });

  it('focuses a metalens at f with a diffraction-limited Airy spot', () => {
    const xz = computeXZ(lens, 4, 45, 161, 361);
    expect(Math.abs(xz.peakV - 25)).toBeLessThan(0.6);
    expect(Math.abs(xz.peakX)).toBeLessThan(0.1);
    const cut = computeXY(lens, 25, 3, 0.02, 241, 1);
    const values = Array.from({ length: 241 }, (_, i) => intensity(cut, i));
    const na = Math.sin(Math.atan(15 / 25));
    expect(fwhm(values, 6 / 241)).toBeCloseTo((0.514 * 0.532) / na, 1);
  });

  it('forms a clean deflected disc in the XY plane, not speckle', () => {
    const p = { ...base, deflect: true };
    const w = computeXY(p, 25, 25, 25, 161, 161);
    const dx = 50 / 161;
    const center = 25 * Math.tan(0.35);
    let inside = 0;
    let total = 0;
    let moment = 0;
    for (let row = 0; row < 161; row++) for (let col = 0; col < 161; col++) {
      const x = -25 + (col + 0.5) * dx;
      const y = -25 + (row + 0.5) * dx;
      const v = intensity(w, row * 161 + col);
      total += v;
      moment += v * x;
      if (Math.hypot(x - center, y) < 17) inside += v;
    }
    expect(moment / total).toBeCloseTo(center, 0);
    expect(inside / total).toBeGreaterThan(0.9);
  });

  it('gives every vortex charge a null on axis in the XZ slice', () => {
    for (const l of [1, 2, 3]) {
      const p = { ...base, vortex: true, topologicalCharge: l };
      const w = computeXZ(p, 10, 45, 201, 90);
      for (const row of [30, 80]) {
        let max = 0;
        for (let col = 0; col < 201; col++) max = Math.max(max, intensity(w, row * 201 + col));
        expect(intensity(w, row * 201 + 100) / max).toBeLessThan(0.02);
      }
    }
  });

  it('conserves power between planes', () => {
    const p = { ...lens, diameter: 15 };
    const power = (z: number) => {
      const w = computeXY(p, z, 60, 60, 512, 512);
      let sum = 0;
      for (let i = 0; i < 512 * 512; i++) sum += intensity(w, i);
      return sum;
    };
    expect(power(5) / power(40)).toBeCloseTo(1, 1);
  });

  it('keys the device on everything that changes the field', () => {
    expect(deviceKey(lens)).not.toBe(deviceKey({ ...lens, wavelength: 0.65 }));
    expect(deviceKey(lens)).toBe(deviceKey({ ...lens }));
  });
});
