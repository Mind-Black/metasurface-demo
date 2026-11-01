import { opticsStore, OpticsState, RenderMode } from '@/lib/store/useOpticsStore';

const VS_SOURCE = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;       // canvas dimensions (width, height)
uniform float uTime;
uniform float uWavelength;       // operational illumination wavelength in micrometers
uniform float uDesignWavelength; // fabrication design wavelength in micrometers
uniform float uFocalLength;      // design focal length in micrometers
uniform float uDiameter;         // aperture diameter in micrometers
uniform float uDeflectionAngle;  // in radians
uniform float uTopologicalCharge;
uniform float uToleranceJitter;  // manufacturing noise [0, 0.15]
uniform int   uRenderMode;       // 0: Re{E(x,y,t)}, 1: Intensity |E|^2, 2: Phase arg(E)
uniform float uIntensityMax;     // Max intensity displayed on colormap
uniform int   uEnableLens;       // 1 = active, 0 = inactive
uniform int   uEnableDeflect;    // 1 = active, 0 = inactive
uniform int   uEnableVortex;     // 1 = active, 0 = inactive
uniform int   uEnableHologram;   // 1 = active, 0 = inactive
uniform float uProbeZ;           // Transverse slice Z coordinate in micrometers
uniform float uXyZoom;           // 1.0 = +/-25 um, 2.0 = +/-12.5 um, 5.0 = +/-5.0 um
uniform int   uShowGrid;         // 1 = show coordinate crosshairs & rings, 0 = hide
uniform float uHologramPhase[128];

const float PI = 3.14159265358979323846;
const int NUM_VOGEL = 160;
const float GOLDEN_ANGLE = 2.399963229728653; // radians ~ 137.50776 degrees

vec3 inferno(float t) {
  const vec3 c0 = vec3(0.0002149, 0.001394, 0.005860);
  const vec3 c1 = vec3(0.258078, -0.008487, 0.505679);
  const vec3 c2 = vec3(0.781807, 0.252771, -0.651531);
  const vec3 c3 = vec3(0.710764, 0.958563, -0.130058);
  const vec3 c4 = vec3(-0.731634, -0.203976, 0.279767);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * c4))), 0.0, 1.0);
}

vec3 phaseColormap(float phase) {
  float norm = (phase + PI) / (2.0 * PI);
  return 0.5 + 0.5 * cos(2.0 * PI * norm + vec3(0.0, 2.0, 4.0) * PI / 3.0);
}

void main() {
  // Transverse coordinate mapping with isotropic aspect ratio
  float aspect = uResolution.x / max(1.0, uResolution.y);
  float halfSpan = 25.0 / max(0.2, uXyZoom);

  float x = (vUv.x - 0.5) * 2.0 * halfSpan * (aspect >= 1.0 ? aspect : 1.0);
  float y = (vUv.y - 0.5) * 2.0 * halfSpan * (aspect < 1.0 ? (1.0 / aspect) : 1.0);

  float kDesign = 2.0 * PI / max(0.2, uDesignWavelength);
  float k = 2.0 * PI / max(0.2, uWavelength);
  float omega = 2.0 * PI * 2.0;

  float radius = uDiameter * 0.5;
  vec2 eFieldTotal = vec2(0.0);
  float zDist = max(0.02, uProbeZ);

  // Vogel / Fermat Fibonacci spiral aperture discretization
  for (int i = 0; i < NUM_VOGEL; i++) {
    float rNorm = sqrt((float(i) + 0.5) / float(NUM_VOGEL));
    float rAp = rNorm * radius;
    float phiAp = float(i) * GOLDEN_ANGLE;
    float xAp = rAp * cos(phiAp);
    float yAp = rAp * sin(phiAp);

    // Multi-gradient phase superposition
    float targetPhase = 0.0;
    if (uEnableLens == 1) {
      targetPhase += -kDesign * (sqrt(rAp * rAp + uFocalLength * uFocalLength) - uFocalLength);
    }
    if (uEnableDeflect == 1) {
      targetPhase += kDesign * sin(uDeflectionAngle) * xAp;
    }
    if (uEnableVortex == 1) {
      targetPhase += uTopologicalCharge * phiAp;
    }
    if (uEnableHologram == 1) {
      int hIdx = clamp(int((xAp / radius * 0.5 + 0.5) * 127.0), 0, 127);
      targetPhase += uHologramPhase[hIdx];
    }

    // Manufacturing tolerance noise
    float hash = fract(sin(float(i) * 12.9898 + 4.12) * 43758.5453);
    targetPhase += (hash - 0.5) * uToleranceJitter * 2.0 * PI;

    float dx = x - xAp;
    float dy = y - yAp;
    float dist = sqrt(dx * dx + dy * dy + zDist * zDist);
    if (dist < 0.001) dist = 0.001;

    // Huygens-Fresnel obliquity factor K(theta) = (1 + cos(theta)) / 2 = (1 + z/dist) / 2
    float obliquity = 0.5 * (1.0 + zDist / dist);
    // Amplitude calibrated to the same field units as the XZ cross-section (1/sqrt(dist)),
    // so the shared intensity max slider/colormap range applies equally to both views.
    float amp = obliquity / sqrt(dist);

    if (uEnableVortex == 1 && abs(uTopologicalCharge) > 0.01) {
      amp *= (0.2 + 0.8 * rNorm);
    }

    float totalPhase = targetPhase + k * dist - omega * uTime;
    eFieldTotal.x += amp * cos(totalPhase);
    eFieldTotal.y += amp * sin(totalPhase);
  }

  eFieldTotal /= sqrt(float(NUM_VOGEL));

  // Optical vortex core phase singularity enforcement at beam axis
  if (uEnableVortex == 1 && abs(uTopologicalCharge) > 0.01) {
    float xCenter = 0.0;
    if (uEnableDeflect == 1) {
      float sinDeflect = (uWavelength / uDesignWavelength) * sin(uDeflectionAngle);
      if (abs(sinDeflect) <= 1.0) {
        xCenter = zDist * tan(asin(sinDeflect));
      }
    }
    float rCore = (0.4 + 0.3 * abs(uTopologicalCharge)) * (uWavelength / 0.532) * (1.0 + 0.4 * (zDist / max(0.1, uFocalLength)));
    float coreDist = length(vec2(x - xCenter, y));
    float vortexCore = clamp(coreDist / rCore, 0.0, 1.0);
    eFieldTotal *= vortexCore;
  }

  float intensity = (eFieldTotal.x * eFieldTotal.x + eFieldTotal.y * eFieldTotal.y);
  float instantaneousField = eFieldTotal.x;
  float phaseAngle = atan(eFieldTotal.y, eFieldTotal.x);

  vec3 baseColor = vec3(0.0);
  if (uRenderMode == 0) {
    // Instantaneous Real Field
    float val = clamp(instantaneousField * 0.7, -1.0, 1.0);
    baseColor = val > 0.0
      ? mix(vec3(0.04, 0.05, 0.09), vec3(0.12, 0.85, 1.0), val)
      : mix(vec3(0.04, 0.05, 0.09), vec3(1.0, 0.2, 0.45), -val);
  } else if (uRenderMode == 1) {
    // Time-averaged Intensity
    float maxVal = max(0.001, uIntensityMax);
    float normI = clamp(intensity / maxVal, 0.0, 1.0);
    baseColor = inferno(normI);
  } else {
    // Transmitted Phase Angle arg(E)
    baseColor = phaseColormap(phaseAngle);
  }

  // Coordinate axes & concentric rings overlay
  if (uShowGrid == 1) {
    float lineWidth = 0.15 / max(0.5, uXyZoom);
    float axisDist = min(abs(x), abs(y));
    if (axisDist < lineWidth) {
      baseColor = mix(baseColor, vec3(1.0, 1.0, 1.0), 0.25);
    }
    float rCoord = length(vec2(x, y));
    float ring5 = abs(rCoord - 5.0);
    float ring10 = abs(rCoord - 10.0);
    float ring20 = abs(rCoord - 20.0);
    float minRing = min(ring5, min(ring10, ring20));
    if (minRing < lineWidth) {
      baseColor = mix(baseColor, vec3(0.35, 0.75, 1.0), 0.3);
    }
  }

  fragColor = vec4(baseColor, 1.0);
}
`;

export class XYProfileRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private animFrameId: number | null = null;
  private startTime: number = performance.now();
  private currentTime: number = 0;
  private showGrid: boolean = true;
  private hologramPhaseArray = new Float32Array(128);

  private uniformLocations: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initWebGL();
  }

  private initWebGL(): void {
    const gl = this.canvas.getContext('webgl2', {
      antialias: true,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      console.error('WebGL2 not supported for XYProfileCanvas.');
      return;
    }
    this.gl = gl;

    const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('XYProfile program link error:', gl.getProgramInfoLog(program));
      return;
    }
    this.program = program;

    // Full-screen quad
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.vao = vao;

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    const posAttr = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    const uniforms = [
      'uResolution', 'uTime', 'uWavelength', 'uDesignWavelength', 'uFocalLength', 'uDiameter',
      'uDeflectionAngle', 'uTopologicalCharge', 'uToleranceJitter', 'uRenderMode', 'uIntensityMax',
      'uEnableLens', 'uEnableDeflect', 'uEnableVortex', 'uEnableHologram', 'uProbeZ', 'uXyZoom',
      'uShowGrid', 'uHologramPhase'
    ];
    for (const u of uniforms) {
      this.uniformLocations[u] = gl.getUniformLocation(program, u);
    }
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('XYProfile shader compile error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  public resize(): void {
    if (!this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
    const displayHeight = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
      this.gl.viewport(0, 0, displayWidth, displayHeight);
    }
  }

  public toggleGrid(): boolean {
    this.showGrid = !this.showGrid;
    return this.showGrid;
  }

  public start(): void {
    if (this.animFrameId !== null) return;
    const loop = (time: number) => {
      this.render(time);
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  public stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public render(timestamp?: number): void {
    if (!this.gl || !this.program || !this.vao) return;
    const state = opticsStore.getState();

    if (state.isPlaying && timestamp !== undefined) {
      this.currentTime = (timestamp - this.startTime) * 0.001;
    }

    this.resize();

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    if (this.uniformLocations.uResolution) {
      gl.uniform2f(this.uniformLocations.uResolution, this.canvas.width, this.canvas.height);
    }
    gl.uniform1f(this.uniformLocations.uTime, this.currentTime);
    gl.uniform1f(this.uniformLocations.uWavelength, state.wavelength);
    gl.uniform1f(this.uniformLocations.uDesignWavelength, state.designWavelength || 0.532);
    gl.uniform1f(this.uniformLocations.uFocalLength, state.focalLength);
    gl.uniform1f(this.uniformLocations.uDiameter, state.diameter);
    gl.uniform1f(this.uniformLocations.uDeflectionAngle, state.deflectionAngle);
    gl.uniform1f(this.uniformLocations.uTopologicalCharge, state.topologicalCharge);
    gl.uniform1f(this.uniformLocations.uToleranceJitter, state.toleranceJitter);

    // Multi-gradient superposition flags
    const ag = state.activeGradients || {
      lens: state.deviceType === 'metalens',
      deflect: state.deviceType === 'deflector',
      vortex: state.deviceType === 'vortex',
      hologram: state.deviceType === 'hologram'
    };
    gl.uniform1i(this.uniformLocations.uEnableLens, ag.lens ? 1 : 0);
    gl.uniform1i(this.uniformLocations.uEnableDeflect, ag.deflect ? 1 : 0);
    gl.uniform1i(this.uniformLocations.uEnableVortex, ag.vortex ? 1 : 0);
    gl.uniform1i(this.uniformLocations.uEnableHologram, ag.hologram ? 1 : 0);

    gl.uniform1f(this.uniformLocations.uProbeZ, state.probeZ ?? 25.0);
    gl.uniform1f(this.uniformLocations.uXyZoom, state.xyZoom ?? 1.0);
    gl.uniform1i(this.uniformLocations.uShowGrid, this.showGrid ? 1 : 0);

    let renderModeInt = 0;
    if (state.renderMode === 'intensity') renderModeInt = 1;
    else if (state.renderMode === 'phase') renderModeInt = 2;
    gl.uniform1i(this.uniformLocations.uRenderMode, renderModeInt);
    gl.uniform1f(this.uniformLocations.uIntensityMax, state.intensityMax ?? 6.0);

    // Update hologram phase array
    if (ag.hologram && state.cghPhaseMask) {
      const mask = state.cghPhaseMask;
      const maskRows = mask.length;
      const maskCols = mask[0].length;
      const midRow = Math.floor(maskRows / 2);
      for (let i = 0; i < 128; i++) {
        const colIdx = Math.min(maskCols - 1, Math.floor((i / 128) * maskCols));
        this.hologramPhaseArray[i] = mask[midRow][colIdx];
      }
    } else {
      for (let i = 0; i < 128; i++) {
        const norm = i / 128;
        this.hologramPhaseArray[i] = (((Math.sin(norm * 18.8495) * 1.5 + Math.cos(norm * 37.699)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      }
    }
    if (this.uniformLocations.uHologramPhase) {
      gl.uniform1fv(this.uniformLocations.uHologramPhase, this.hologramPhaseArray);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public destroy(): void {
    this.stop();
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
  }
}
