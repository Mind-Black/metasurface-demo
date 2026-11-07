import { OpticsState } from '@/lib/store/useOpticsStore';
import { deviceFromState, FieldRequest } from '@/lib/optics/fieldClient';
import { FIELD_GLSL, FieldCanvas } from './FieldCanvas';

const FS_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uXyZoom;           // 1.0 = +/-25 um, 2.0 = +/-12.5 um, 5.0 = +/-5.0 um
uniform int   uRenderMode;       // 0: Re{E}, 1: |E|², 2: arg(E)
uniform int   uLogIntensity;
uniform float uIntensityMax;
uniform int   uShowGrid;
uniform vec2  uFieldWindow;      // halfX, halfY of the solved field [µm]
${FIELD_GLSL}

void main() {
  float aspect = uResolution.x / max(1.0, uResolution.y);
  float halfSpan = 25.0 / max(0.2, uXyZoom);
  float x = (vUv.x - 0.5) * 2.0 * halfSpan * (aspect >= 1.0 ? aspect : 1.0);
  float y = (vUv.y - 0.5) * 2.0 * halfSpan * (aspect < 1.0 ? (1.0 / aspect) : 1.0);

  vec2 envelope = sampleField(vec2(x, y) / (2.0 * uFieldWindow) + 0.5);
  float phase = -4.0 * PI * uTime;
  vec2 rotor = vec2(cos(phase), sin(phase));
  vec2 field = vec2(envelope.x * rotor.x - envelope.y * rotor.y, envelope.x * rotor.y + envelope.y * rotor.x);

  vec3 baseColor = fieldColor(field, uRenderMode, uLogIntensity, uIntensityMax);

  if (uShowGrid == 1) {
    float lineWidth = 0.15 / max(0.5, uXyZoom);
    if (min(abs(x), abs(y)) < lineWidth) baseColor = mix(baseColor, vec3(1.0), 0.25);
    float rCoord = length(vec2(x, y));
    float minRing = min(abs(rCoord - 5.0), min(abs(rCoord - 10.0), abs(rCoord - 20.0)));
    if (minRing < lineWidth) baseColor = mix(baseColor, vec3(0.35, 0.75, 1.0), 0.3);
  }

  fragColor = vec4(baseColor, 1.0);
}
`;

const FIELD_ROWS = 384;

/** Field on the transverse plane z = probeZ. */
/** Solve window for a panel of the given pixel size; null while the panel has no area (hidden tab). */
export function xyFieldRequest(state: OpticsState, width: number, height: number): FieldRequest | null {
  if (!(width > 0) || !(height > 0)) return null;
  const aspect = width / height;
  const span = 25 / Math.max(0.2, state.xyZoom || 1);
  const wide = aspect >= 1 ? aspect : 1 / aspect;
  const nLong = Math.min(900, Math.round(FIELD_ROWS * wide));
  return {
    kind: 'xy',
    device: deviceFromState(state),
    z: Math.max(0.02, state.probeZ ?? 25),
    halfX: aspect >= 1 ? span * aspect : span,
    halfV: aspect >= 1 ? span : span / aspect,
    nx: aspect >= 1 ? nLong : FIELD_ROWS,
    nv: aspect >= 1 ? FIELD_ROWS : nLong,
  };
}

export class XYProfileRenderer extends FieldCanvas {
  private showGrid = true;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas, FS_SOURCE, ['uXyZoom', 'uShowGrid', 'uFieldWindow']);
  }

  protected fieldRequest(state: OpticsState): FieldRequest | null {
    return xyFieldRequest(state, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  protected setUniforms(gl: WebGL2RenderingContext, state: OpticsState): void {
    const u = this.uniformLocations;
    gl.uniform1f(u.uXyZoom, state.xyZoom ?? 1);
    gl.uniform1i(u.uShowGrid, this.showGrid ? 1 : 0);
    gl.uniform2f(u.uFieldWindow, this.shown?.halfX ?? 1, this.shown?.halfV ?? 1);
  }

  public toggleGrid(): boolean {
    this.showGrid = !this.showGrid;
    this.requestRender();
    return this.showGrid;
  }
}
