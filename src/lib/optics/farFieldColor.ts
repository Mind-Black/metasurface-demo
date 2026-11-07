import type { RenderMode } from '@/lib/store/useOpticsStore';
import type { FarFieldResult } from './farField';

export interface FarFieldColorOptions {
  mode: RenderMode;
  /** Animation clock [s]; the field and phase views rotate the carrier at 2 cycles per second. */
  time: number;
  intensityMax: number;
  logScale: boolean;
  dynamicRangeDb: number;
}

/** Phase of each bin never changes for a given result, so atan2 runs once per result. */
const phaseCache = new WeakMap<FarFieldResult, Float64Array>();

function phaseOf(res: FarFieldResult): Float64Array {
  let phase = phaseCache.get(res);
  if (!phase) {
    phase = new Float64Array(res.size * res.size);
    for (let i = 0; i < phase.length; i++) phase[i] = Math.atan2(res.imaginary[i], res.real[i]);
    phaseCache.set(res, phase);
  }
  return phase;
}

/** Inferno colour map as a degree-4 polynomial per channel (sRGB bytes). */
function inferno(t: number, out: Uint8ClampedArray, at: number): void {
  const r = 0.0002149 + t * (0.258078 + t * (0.781807 + t * (0.710764 + t * -0.731634)));
  const g = 0.001394 + t * (-0.008487 + t * (0.252771 + t * (0.958563 + t * -0.203976)));
  const b = 0.00586 + t * (0.505679 + t * (-0.651531 + t * (-0.130058 + t * 0.279767)));
  out[at] = Math.round(Math.min(1, Math.max(0, r)) * 255);
  out[at + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
  out[at + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
}

function hueChannel(offset: number, hue: number): number {
  const k = (offset + hue * 6) % 6;
  return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
}

/** Writes RGBA bytes for every bin of the far-field result into `out` (length size² × 4). Allocates nothing. */
export function colorizeFarField(res: FarFieldResult, options: FarFieldColorOptions, out: Uint8ClampedArray): void {
  const count = res.size * res.size;
  const { mode, time, intensityMax, logScale, dynamicRangeDb } = options;
  if (mode === 'field') {
    const cos = Math.cos(4 * Math.PI * time);
    const sin = Math.sin(4 * Math.PI * time);
    for (let i = 0, at = 0; i < count; i++, at += 4) {
      const value = Math.max(-1, Math.min(1, res.real[i] * cos + res.imaginary[i] * sin));
      const amount = Math.abs(value);
      const positive = value >= 0;
      out[at] = Math.round(10 + ((positive ? 31 : 255) - 10) * amount);
      out[at + 1] = Math.round(13 + ((positive ? 217 : 51) - 13) * amount);
      out[at + 2] = Math.round(23 + ((positive ? 255 : 115) - 23) * amount);
      out[at + 3] = 255;
    }
  } else if (mode === 'phase') {
    const phase = phaseOf(res);
    const shift = 4 * Math.PI * time;
    for (let i = 0, at = 0; i < count; i++, at += 4) {
      if (res.intensity[i] < 1e-8) {
        out[at] = 10;
        out[at + 1] = 13;
        out[at + 2] = 23;
      } else {
        const hue = ((phase[i] - shift) / (2 * Math.PI) % 1 + 1) % 1;
        out[at] = hueChannel(5, hue);
        out[at + 1] = hueChannel(3, hue);
        out[at + 2] = hueChannel(1, hue);
      }
      out[at + 3] = 255;
    }
  } else {
    for (let i = 0, at = 0; i < count; i++, at += 4) {
      const normalized = Math.min(1, res.intensity[i] / intensityMax);
      const t = logScale ? (normalized > 0 ? 1 + (10 * Math.log10(normalized)) / dynamicRangeDb : 0) : normalized;
      inferno(Math.min(1, Math.max(0, t)), out, at);
      out[at + 3] = 255;
    }
  }
}
