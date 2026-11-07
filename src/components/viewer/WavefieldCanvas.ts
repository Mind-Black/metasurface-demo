import { opticsStore, OpticsState } from '@/lib/store/useOpticsStore';
import { deviceFromState, FieldRequest } from '@/lib/optics/fieldClient';
import { FIELD_GLSL, FieldCanvas } from './FieldCanvas';

const FS_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uZoom;
uniform float uWavelength;       // illumination wavelength [µm]
uniform float uDesignWavelength; // fabrication design wavelength [µm]
uniform float uFocalLength;      // design focal length [µm]
uniform float uDiameter;         // aperture diameter [µm]
uniform float uDeflectionAngle;  // design deflection [rad]
uniform int   uEnableLens;
uniform int   uEnableDeflect;
uniform float uProbeZ;           // selected z slice [µm]
uniform int   uRenderMode;       // 0: Re{E}, 1: |E|², 2: arg(E)
uniform int   uLogIntensity;
uniform float uIntensityMax;
uniform int   uShowRays;
uniform vec2  uFieldWindow;      // halfX, zMax of the solved field [µm]
${FIELD_GLSL}

void main() {
  float aspect = uResolution.x / max(1.0, uResolution.y);
  float zMax = 60.0 / uZoom;
  float xMax = max(30.0, 30.0 * aspect) / uZoom;
  float x = (vUv.x - 0.5) * 2.0 * xMax;
  float z = vUv.y * zMax;

  // The texture stores the envelope E·exp(-ikz); restore the carrier and time dependence here.
  vec2 envelope = sampleField(vec2(x / (2.0 * uFieldWindow.x) + 0.5, z / uFieldWindow.y));
  float phase = 2.0 * PI / uWavelength * z - 4.0 * PI * uTime;
  vec2 rotor = vec2(cos(phase), sin(phase));
  vec2 field = vec2(envelope.x * rotor.x - envelope.y * rotor.y, envelope.x * rotor.y + envelope.y * rotor.x);

  vec3 baseColor = fieldColor(field, uRenderMode, uLogIntensity, uIntensityMax);
  float radius = uDiameter * 0.5;

  // Each ray leaves with the local grating direction sinθ = (λ/λ0)(sinθ_deflect - r/√(r²+f²));
  // rays that would need sinθ > 1 are evanescent and are not drawn.
  if (uShowRays == 1 && (uEnableLens == 1 || uEnableDeflect == 1)) {
    for (int r = -4; r <= 4; r++) {
      float rayX0 = float(r) * (radius / 4.5);
      float s = 0.0;
      if (uEnableLens == 1) s -= rayX0 / sqrt(rayX0 * rayX0 + uFocalLength * uFocalLength);
      if (uEnableDeflect == 1) s += sin(uDeflectionAngle);
      s *= uWavelength / uDesignWavelength;
      if (abs(s) >= 1.0) continue;
      vec2 dir = vec2(s, sqrt(1.0 - s * s));
      vec2 w = vec2(x - rayX0, z);
      float along = dot(w, dir);
      if (along >= 0.0 && length(w - along * dir) < 0.25 / uZoom) {
        baseColor = mix(baseColor, vec3(1.0, 0.9, 0.2), 0.55);
      }
    }
  }

  // Dashed line at the XY probe plane
  if (abs(z - uProbeZ) < 0.28 / uZoom && fract(x / 1.5) < 0.65) {
    baseColor = mix(baseColor, vec3(0.0, 0.92, 1.0), 0.92);
  }

  // Metasurface at z = 0
  if (vUv.y < 0.02 && abs(x) <= radius) {
    baseColor = mix(baseColor, vec3(0.9, 0.95, 1.0), 0.85);
  }

  fragColor = vec4(baseColor, 1.0);
}
`;

const FIELD_ROWS = 256;
const PIXELS_PER_ROW = 1.5;

/** y = 0 slice of the 3D field. */
/** Solve window for a panel of the given pixel size; null while the panel has no area (hidden tab). */
export function xzFieldRequest(state: OpticsState, width: number, height: number): FieldRequest | null {
  if (!(width > 0) || !(height > 0)) return null;
  const zoom = state.wavefieldZoom || 1;
  const aspect = width / height;
  return {
    kind: 'xz',
    device: deviceFromState(state),
    halfX: Math.max(30, 30 * aspect) / zoom,
    halfV: 60 / zoom,
    nx: Math.min(900, Math.round(FIELD_ROWS * PIXELS_PER_ROW * Math.max(1, aspect))),
    nv: FIELD_ROWS,
  };
}

export class WavefieldRenderer extends FieldCanvas {
  private showRays = false;
  private isDraggingProbe = false;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas, FS_SOURCE, ['uZoom', 'uWavelength', 'uDesignWavelength', 'uFocalLength', 'uDiameter',
      'uDeflectionAngle', 'uEnableLens', 'uEnableDeflect', 'uProbeZ', 'uShowRays', 'uFieldWindow']);
    this.canvas.style.cursor = 'crosshair';
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  protected fieldRequest(state: OpticsState): FieldRequest | null {
    return xzFieldRequest(state, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  protected setUniforms(gl: WebGL2RenderingContext, state: OpticsState): void {
    const u = this.uniformLocations;
    gl.uniform1f(u.uZoom, state.wavefieldZoom || 1);
    gl.uniform1f(u.uWavelength, this.shown?.device.wavelength ?? state.wavelength);
    gl.uniform1f(u.uDesignWavelength, state.designWavelength);
    gl.uniform1f(u.uFocalLength, state.focalLength);
    gl.uniform1f(u.uDiameter, state.diameter);
    gl.uniform1f(u.uDeflectionAngle, state.deflectionAngle);
    gl.uniform1i(u.uEnableLens, state.activeGradients.lens ? 1 : 0);
    gl.uniform1i(u.uEnableDeflect, state.activeGradients.deflect ? 1 : 0);
    gl.uniform1f(u.uProbeZ, state.probeZ ?? 25);
    gl.uniform1i(u.uShowRays, this.showRays ? 1 : 0);
    gl.uniform2f(u.uFieldWindow, this.shown?.halfX ?? 1, this.shown?.halfV ?? 1);
  }

  public toggleRays(): boolean {
    this.showRays = !this.showRays;
    return this.showRays;
  }

  public getShowRays(): boolean {
    return this.showRays;
  }

  private updateProbe(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.height <= 0) return;
    const zMax = 60 / (opticsStore.getState().wavefieldZoom || 1);
    const z = Math.max(0, Math.min(60, (1 - (e.clientY - rect.top) / rect.height) * zMax));
    opticsStore.getState().setProbeZ(Math.round(z * 10) / 10);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.isDraggingProbe = true;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    this.updateProbe(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.isDraggingProbe) this.updateProbe(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isDraggingProbe) return;
    this.isDraggingProbe = false;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  public destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    super.destroy();
  }
}
