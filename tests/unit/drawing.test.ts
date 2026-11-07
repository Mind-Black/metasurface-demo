import { describe, expect, it } from 'vitest';
import { computeFarField, FarFieldInput, FarFieldResult } from '@/lib/optics/farField';
import { colorizeFarField } from '@/lib/optics/farFieldColor';
import { generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import { phaseColor, phaseMapPixels } from '@/components/viewer/NanostructureLattice';
import { opticsStore } from '@/lib/store/useOpticsStore';
import * as legacyFar from './helpers/legacyFarField';
import { legacyColorize } from './helpers/legacyFarFieldColor';

function sameArray(a: ArrayLike<number>, b: ArrayLike<number>, label: string) {
  expect(a.length, `${label} length`).toBe(b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${label}[${i}]: ${a[i]} !== ${b[i]}`);
}

const mask = runGerchbergSaxton(generateTargetBitmap('mu'), 5).phaseMask;
const base: FarFieldInput = {
  wavelength: 0.532, designWavelength: 0.532, focalLength: 25, diameter: 30, deflectionAngle: 0.35,
  topologicalCharge: 1, lens: false, deflect: false, vortex: false, hologram: false,
};

describe('computeFarField matches the frozen legacy implementation exactly', () => {
  const variants: Record<string, FarFieldInput> = {
    lens: { ...base, lens: true },
    'deflect D=15': { ...base, deflect: true, diameter: 15 },
    'vortex+lens': { ...base, vortex: true, lens: true },
    hologram: { ...base, hologram: true, cghPhaseMask: mask },
    'ideal sampling': { ...base, lens: true, idealPitch: 0.5 },
  };
  for (const [name, p] of Object.entries(variants)) {
    for (const sinMax of [1, 0.5, 0.0625]) {
      it(`${name}, sinMax ${sinMax}`, () => {
        const now = computeFarField(p, 96, sinMax);
        const before = legacyFar.computeFarField(p, 96, sinMax);
        sameArray(now.intensity, before.intensity, 'intensity');
        sameArray(now.real, before.real, 'real');
        sameArray(now.imaginary, before.imaginary, 'imaginary');
      });
    }
  }
});

describe('colorizeFarField matches the frozen per-pixel loop exactly', () => {
  const result = computeFarField({ ...base, lens: true, diameter: 15 }, 64, 1);
  // Include zero-intensity and negative-real bins as well as the propagating disk.
  const times = [0, 0.137, 1.5, 12.3456];
  for (const mode of ['field', 'phase', 'intensity'] as const) {
    for (const logScale of [false, true]) {
      it(`${mode}${mode === 'intensity' ? (logScale ? ' (log)' : ' (linear)') : ''}`, () => {
        if (mode !== 'intensity' && logScale) return;
        for (const time of times) for (const intensityMax of [1, 0.3]) {
          const now = new Uint8ClampedArray(64 * 64 * 4);
          const before = new Uint8ClampedArray(64 * 64 * 4);
          colorizeFarField(result as FarFieldResult, { mode, time, intensityMax, logScale, dynamicRangeDb: 40 }, now);
          legacyColorize(result, mode, time, intensityMax, logScale, 40, before);
          sameArray(now, before, `${mode} t=${time}`);
        }
      });
    }
  }
});

describe('lattice phase map', () => {
  // CSS Color 4 hsl() to rgb, as an independent reference.
  const cssHsl = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  };

  it('agrees with the CSS hsl(h, 85%, 52%) conversion within one level across the hue circle', () => {
    const out = new Uint8ClampedArray(4);
    for (let h = 0; h < 360; h += 0.37) {
      phaseColor(h, out, 0);
      const expected = cssHsl(h, 0.85, 0.52);
      for (let c = 0; c < 3; c++) expect(Math.abs(out[c] - expected[c]), `h=${h} channel ${c}`).toBeLessThanOrEqual(1);
    }
    phaseColor(0, out, 0);
    expect([out[0], out[1], out[2]]).toEqual([237, 29, 29]);
    phaseColor(360, out, 0);
    expect([out[0], out[1], out[2]]).toEqual([237, 29, 29]);
  });

  it('is opaque inside the aperture and transparent outside', () => {
    const state = opticsStore.getState();
    const size = 40;
    const pixels = phaseMapPixels(state, size);
    expect(pixels.length).toBe(size * size * 4);
    const alpha = (row: number, col: number) => pixels[(row * size + col) * 4 + 3];
    expect(alpha(size / 2, size / 2)).toBe(255);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(size - 1, size - 1)).toBe(0);
  });
});
