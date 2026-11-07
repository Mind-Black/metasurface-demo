import { opticsStore, RenderMode } from '@/lib/store/useOpticsStore';
import { FarFieldInput, FarFieldResult } from '@/lib/optics/farField';
import { fieldClient } from '@/lib/optics/fieldClient';
import { colorizeFarField } from '@/lib/optics/farFieldColor';

/** Renders the Fourier-transform far-field (angular spectrum) of the pillar lattice field. */
export class FarFieldRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private result: FarFieldResult | null = null;
  private sinMax = 1.0;
  private lastKey = '';
  private lastMask: number[][] | null | undefined;
  private logScale = false;
  private intensityMax = 1;
  private mode: RenderMode = 'field';
  private animationId: number | null = null;
  private animationTime = 0;
  private previousFrame = 0;
  private readonly dynamicRangeDb = 40;
  private off: HTMLCanvasElement;
  private offContext: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
  }

  public setMode(mode: RenderMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.syncAnimation();
    this.draw();
  }

  private syncAnimation(): void {
    const shouldAnimate = this.mode !== 'intensity' && opticsStore.getState().isPlaying;
    if (!shouldAnimate && this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
      this.previousFrame = 0;
    } else if (shouldAnimate && this.animationId === null) {
      const animate = (timestamp: number): void => {
        if (this.previousFrame && timestamp - this.previousFrame < 50) {
          this.animationId = requestAnimationFrame(animate);
          return;
        }
        if (this.previousFrame) this.animationTime += (timestamp - this.previousFrame) / 1000;
        this.previousFrame = timestamp;
        this.draw();
        this.animationId = requestAnimationFrame(animate);
      };
      this.animationId = requestAnimationFrame(animate);
    }
  }

  public setIntensityMax(value: number): void {
    this.intensityMax = Math.max(0.01, Math.min(1, value));
    this.draw();
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
    ]);
    if (key !== this.lastKey || (input.hologram && input.cghPhaseMask !== this.lastMask)) {
      this.lastKey = key;
      this.lastMask = input.cghPhaseMask;
      fieldClient.request({ kind: 'far', device: input, halfX: this.sinMax, halfV: 0, nx: 256, nv: 256 }, ({ far }) => {
        if (!far) return;
        this.result = far;
        this.draw();
      });
    }
    this.syncAnimation();
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
    // Resizing a canvas reallocates its bitmap, so only do it when the result size changes.
    if (this.off.width !== n || this.off.height !== n) {
      this.off.width = n;
      this.off.height = n;
      this.offContext = null;
      this.image = null;
    }
    const octx = this.offContext ?? (this.offContext = this.off.getContext('2d'));
    if (!octx) return;
    if (!this.image) this.image = octx.createImageData(n, n);
    colorizeFarField(res, {
      mode: this.mode,
      time: this.animationTime,
      intensityMax: this.intensityMax,
      logScale: this.logScale,
      dynamicRangeDb: this.dynamicRangeDb,
    }, this.image.data);
    octx.putImageData(this.image, 0, 0);

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
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.animationId = null;
    this.result = null;
  }
}

