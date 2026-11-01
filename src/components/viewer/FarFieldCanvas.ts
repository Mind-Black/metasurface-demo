import { opticsStore } from '@/lib/store/useOpticsStore';
import { computeFarField, FarFieldInput, FarFieldResult } from '@/lib/optics/farField';

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

/** Renders the Fourier-transform far-field (angular spectrum) of the aperture field. */
export class FarFieldRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private result: FarFieldResult | null = null;
  private sinMax = 1.0;
  private lastKey = '';
  private logScale = true;
  private readonly dynamicRangeDb = 40;
  private off: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
  }

  public setLogScale(log: boolean): void {
    this.logScale = log;
    this.draw();
  }

  /** Set the displayed half-range in sin θ (1 = full propagating range). */
  public setSinMax(v: number): void {
    this.sinMax = v;
    this.lastKey = '';
    this.update();
  }

  public isLogScale(): boolean {
    return this.logScale;
  }

  /** Recompute (only if parameters changed) and redraw. */
  public update(): void {
    const s = opticsStore.getState();
    const ag = s.activeGradients || {
      lens: s.deviceType === 'metalens',
      deflect: s.deviceType === 'deflector',
      vortex: s.deviceType === 'vortex',
      hologram: s.deviceType === 'hologram',
    };
    const input: FarFieldInput = {
      wavelength: s.wavelength,
      designWavelength: s.designWavelength || 0.532,
      focalLength: s.focalLength,
      diameter: s.diameter,
      deflectionAngle: s.deflectionAngle,
      topologicalCharge: s.topologicalCharge,
      lens: Boolean(ag.lens),
      deflect: Boolean(ag.deflect),
      vortex: Boolean(ag.vortex),
      hologram: Boolean(ag.hologram),
      cghPhaseMask: s.cghPhaseMask,
    };
    const key = JSON.stringify([
      this.sinMax,
      input.wavelength, input.designWavelength, input.focalLength, input.diameter,
      input.deflectionAngle, input.topologicalCharge, input.lens, input.deflect,
      input.vortex, input.hologram, input.hologram ? s.hologramTarget : '',
      input.hologram && input.cghPhaseMask ? input.cghPhaseMask[0]?.[0] : '',
    ]);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.result = computeFarField(input, 256, this.sinMax);
    }
    this.draw();
  }

  public resize(): void {
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const res = this.result;
    if (!ctx || !res) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (w <= 0 || h <= 0) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const n = res.size;
    this.off.width = n;
    this.off.height = n;
    const octx = this.off.getContext('2d');
    if (!octx) return;
    const img = octx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = res.intensity[i];
      let t: number;
      if (this.logScale) {
        t = v > 0 ? 1 + (10 * Math.log10(v)) / this.dynamicRangeDb : 0;
      } else {
        t = Math.sqrt(v); // mild gamma for visibility
      }
      t = Math.min(1, Math.max(0, t));
      const [r, g, b] = inferno(t);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    ctx.fillStyle = '#03050a';
    ctx.fillRect(0, 0, w, h);
    const side = Math.min(w, h);
    const ox = (w - side) / 2;
    const oy = (h - side) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, ox, oy, side, side);

    // Overlays: axes and sinθ = 1 (propagating-wave) limit
    const cx = ox + side / 2;
    const cy = oy + side / 2;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(ox, cy); ctx.lineTo(ox + side, cy);
    ctx.moveTo(cx, oy); ctx.lineTo(cx, oy + side);
    ctx.stroke();
    if (res.sinMax >= 1.0) {
      ctx.strokeStyle = 'rgba(89,190,255,0.55)';
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.beginPath();
      ctx.arc(cx, cy, side / 2 - dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(220,230,245,0.85)';
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('sin θx →', cx, oy + side - 6 * dpr);
    ctx.textAlign = 'left';
    ctx.fillText('↑ sin θy', ox + 6 * dpr, oy + 14 * dpr + 18 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText(`±${res.sinMax}`, ox + side - 6 * dpr, cy - 5 * dpr);
  }

  public destroy(): void {
    this.result = null;
  }
}

