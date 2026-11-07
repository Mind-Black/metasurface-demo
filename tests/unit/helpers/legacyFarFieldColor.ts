// FROZEN COPY of the per-pixel colour loop and inferno() from FarFieldCanvas.ts at 32233e7. Do not edit.
import type { FarFieldResult } from '@/lib/optics/farField';
import type { RenderMode } from '@/lib/store/useOpticsStore';

function inferno(t: number): [number, number, number] {
  const c0 = [0.0002149, 0.001394, 0.00586];
  const c1 = [0.258078, -0.008487, 0.505679];
  const c2 = [0.781807, 0.252771, -0.651531];
  const c3 = [0.710764, 0.958563, -0.130058];
  const c4 = [-0.731634, -0.203976, 0.279767];
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const v = c0[i] + t * (c1[i] + t * (c2[i] + t * (c3[i] + t * c4[i])));
    out.push(Math.round(Math.min(1, Math.max(0, v)) * 255));
  }
  return [out[0], out[1], out[2]];
}

export function legacyColorize(res: FarFieldResult, mode: RenderMode, animationTime: number,
  intensityMax: number, logScale: boolean, dynamicRangeDb: number, data: Uint8ClampedArray): void {
  const n = res.size;
  for (let i = 0; i < n * n; i++) {
    const v = res.intensity[i];
    let r: number, g: number, b: number;
    if (mode === 'field') {
      const value = Math.max(-1, Math.min(1, res.real[i] * Math.cos(4 * Math.PI * animationTime) + res.imaginary[i] * Math.sin(4 * Math.PI * animationTime)));
      const base = [10, 13, 23];
      const target = value >= 0 ? [31, 217, 255] : [255, 51, 115];
      const amount = Math.abs(value);
      [r, g, b] = base.map((c, channel) => Math.round(c + (target[channel] - c) * amount));
    } else if (mode === 'phase') {
      if (v < 1e-8) {
        [r, g, b] = [10, 13, 23];
      } else {
        const hue = ((Math.atan2(res.imaginary[i], res.real[i]) - 4 * Math.PI * animationTime) / (2 * Math.PI) % 1 + 1) % 1;
        const channel = (offset: number): number => {
          const k = (offset + hue * 6) % 6;
          return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
        };
        [r, g, b] = [channel(5), channel(3), channel(1)];
      }
    } else {
      const normalized = Math.min(1, v / intensityMax);
      const t = logScale ? (normalized > 0 ? 1 + (10 * Math.log10(normalized)) / dynamicRangeDb : 0) : normalized;
      [r, g, b] = inferno(Math.min(1, Math.max(0, t)));
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
}
