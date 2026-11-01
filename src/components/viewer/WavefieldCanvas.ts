import { opticsStore, OpticsState, RenderMode, DeviceType } from '@/lib/store/useOpticsStore';

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

uniform vec2  uResolution;       // viewport canvas dimensions (width, height)
uniform float uTime;
uniform float uWavelength;       // operational illumination wavelength in micrometers
uniform float uDesignWavelength; // fabrication design wavelength in micrometers
uniform float uFocalLength;      // design focal length in micrometers
uniform float uDiameter;         // aperture diameter in micrometers
uniform float uDeflectionAngle;  // in radians
uniform int   uDeviceType;       // 0: Metalens, 1: Deflector, 2: Vortex, 3: Hologram
uniform int   uEnableLens;       // Multi-gradient: 1 = active, 0 = inactive
uniform int   uEnableDeflect;    // Multi-gradient: 1 = active, 0 = inactive
uniform int   uEnableVortex;     // Multi-gradient: 1 = active, 0 = inactive
uniform int   uEnableHologram;   // Multi-gradient: 1 = active, 0 = inactive
uniform float uProbeZ;           // Selected Z slice coordinate in micrometers
uniform int   uShowProbe;        // 1 = show probe line, 0 = hide
uniform float uTopologicalCharge;
uniform float uToleranceJitter;   // manufacturing noise [0, 0.15]
uniform int   uRenderMode;       // 0: Re{E(x,z,t)}, 1: Intensity |E|^2, 2: Phase arg(E)
uniform float uIntensityMax;     // Max intensity displayed on colormap
uniform int   uShowRays;         // 0: no, 1: yes
uniform float uHologramPhase[128];

const float PI = 3.14159265358979323846;
const int NUM_ELEMENTS = 128;

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
  // Constant spatial scale regardless of metaoptics parameters:
  // Fixed physical height = 60.0 um, isotropic aspect-corrected width
  float aspect = uResolution.x / max(1.0, uResolution.y);
  float zMax = 60.0;
  float xMax = max(30.0, 30.0 * aspect);

  float x = (vUv.x - 0.5) * 2.0 * xMax;
  float z = vUv.y * zMax;

  // Design wavevector at fabrication vs operational wavevector during illumination
  float kDesign = 2.0 * PI / max(0.2, uDesignWavelength);
  float k = 2.0 * PI / max(0.2, uWavelength);
  float omega = 2.0 * PI * 2.0;

  vec2 eFieldTotal = vec2(0.0);
  float elementSpacing = uDiameter / float(NUM_ELEMENTS);
  float radius = uDiameter * 0.5;

  for (int i = 0; i < NUM_ELEMENTS; i++) {
    float xPos = -radius + (float(i) + 0.5) * elementSpacing;

    // Physical phase profile imparted by fabricated metasurface nanostructures.
    // Multi-gradient superposition: combines all active phase gradients linearly.
    float targetPhase = 0.0;
    if (uEnableLens == 1) {
      // Hyperbolic metalens phase profile fabricated at uDesignWavelength
      targetPhase += -kDesign * (sqrt(xPos * xPos + uFocalLength * uFocalLength) - uFocalLength);
    }
    if (uEnableDeflect == 1) {
      // Linear phase gradient fabricated at uDesignWavelength: dphi/dx = kDesign * sin(theta)
      targetPhase += kDesign * sin(uDeflectionAngle) * xPos;
    }
    if (uEnableVortex == 1) {
      // Vortex spiral phase profile
      float normPos = xPos / max(0.001, radius);
      targetPhase += uTopologicalCharge * (normPos >= 0.0 ? 0.0 : PI);
    }
    if (uEnableHologram == 1) {
      // Gerchberg-Saxton synthesized hologram phase mask
      targetPhase += uHologramPhase[i];
    }

    // Manufacturing jitter noise
    float hash = fract(sin(float(i) * 12.9898) * 43758.5453);
    targetPhase += (hash - 0.5) * uToleranceJitter * 2.0 * PI;

    float dx = x - xPos;
    float dist = sqrt(dx * dx + z * z);
    if (dist < 0.001) dist = 0.001;

    // Obliquity factor K(theta) = (1 + cos(theta)) / 2 = (1 + z/dist) / 2
    float obliquity = 0.5 * (1.0 + z / dist);
    float amp = obliquity / sqrt(dist);

    if (uEnableVortex == 1 && abs(uTopologicalCharge) > 0.01) {
      amp *= (0.2 + 0.8 * abs(xPos / radius));
    }

    // Free space phase propagation with operational wavelength k
    float totalPhase = targetPhase + k * dist - omega * uTime;
    eFieldTotal.x += amp * cos(totalPhase);
    eFieldTotal.y += amp * sin(totalPhase);
  }

  eFieldTotal /= sqrt(float(NUM_ELEMENTS));

  // For vortex beams, enforce topological phase singularity null at beam axis
  if (uEnableVortex == 1 && abs(uTopologicalCharge) > 0.01) {
    float xCenter = 0.0;
    if (uEnableDeflect == 1) {
      float sinDeflect = (uWavelength / uDesignWavelength) * sin(uDeflectionAngle);
      if (abs(sinDeflect) <= 1.0) {
        xCenter = z * tan(asin(sinDeflect));
      }
    }
    float coreRadius = (0.4 + 0.3 * abs(uTopologicalCharge)) * (uWavelength / 0.532) * (1.0 + 0.4 * (z / max(0.1, uFocalLength)));
    float vortexCore = clamp(abs(x - xCenter) / coreRadius, 0.0, 1.0);
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
    // Phase Angle arg(E)
    baseColor = phaseColormap(phaseAngle);
  }

  // Live ray/caustic overlay with true physical dispersion and multi-gradient superposition
  if (uShowRays == 1) {
    for (int r = -4; r <= 4; r++) {
      float rayX0 = float(r) * (radius / 4.5);
      float rayLineDist = 999.0;
      float actualFocal = uFocalLength * (uDesignWavelength / uWavelength);
      float sinDeflect = (uWavelength / uDesignWavelength) * sin(uDeflectionAngle);
      float thetaTrans = (abs(sinDeflect) <= 1.0) ? asin(sinDeflect) : uDeflectionAngle;

      if (uEnableLens == 1 && uEnableDeflect == 1) {
        // Off-axis metalens: rays converge toward shifted focal point (actualFocal * tan(thetaTrans), actualFocal)
        float focalX = actualFocal * tan(thetaTrans);
        vec2 p0 = vec2(rayX0, 0.0);
        vec2 p1 = vec2(focalX, actualFocal);
        vec2 v = p1 - p0;
        vec2 w = vec2(x, z) - p0;
        float c1 = dot(w, v);
        float c2 = dot(v, v);
        float b = clamp(c1 / c2, 0.0, 1.3);
        vec2 pb = p0 + b * v;
        rayLineDist = length(vec2(x, z) - pb);
      } else if (uEnableLens == 1) {
        // On-axis metalens: chromatic focal shift
        vec2 p0 = vec2(rayX0, 0.0);
        vec2 p1 = vec2(0.0, actualFocal);
        vec2 v = p1 - p0;
        vec2 w = vec2(x, z) - p0;
        float c1 = dot(w, v);
        float c2 = dot(v, v);
        float b = clamp(c1 / c2, 0.0, 1.3);
        vec2 pb = p0 + b * v;
        rayLineDist = length(vec2(x, z) - pb);
      } else if (uEnableDeflect == 1) {
        // Generalized Snell's law dispersion: sin(theta_t) = (lambda / lambda0) * sin(theta0)
        if (abs(sinDeflect) <= 1.0) {
          vec2 dir = vec2(sin(thetaTrans), cos(thetaTrans));
          vec2 p0 = vec2(rayX0, 0.0);
          vec2 w = vec2(x, z) - p0;
          float proj = dot(w, dir);
          if (proj >= 0.0) {
            vec2 pb = p0 + proj * dir;
            rayLineDist = length(vec2(x, z) - pb);
          }
        }
      }
      if (rayLineDist < 0.25) {
        baseColor = mix(baseColor, vec3(1.0, 0.9, 0.2), 0.55);
      }
    }
  }

  // Transverse XY Profile Probe Line Indicator at z = uProbeZ
  if (uShowProbe == 1) {
    float distToProbe = abs(z - uProbeZ);
    if (distToProbe < 0.28) {
      // High-contrast dashed probe line: 1.5 um cycle (65% dash, 35% gap)
      float dash = fract(x / 1.5);
      if (dash < 0.65) {
        vec3 probeColor = vec3(0.0, 0.92, 1.0); // Bright electric cyan
        baseColor = mix(baseColor, probeColor, 0.92);
      }
    }
  }

  // Draw metasurface substrate boundary indicator at z = 0 (bottom border)
  if (vUv.y < 0.02 && abs(x) <= radius) {
    baseColor = mix(baseColor, vec3(0.9, 0.95, 1.0), 0.85);
  }

  fragColor = vec4(baseColor, 1.0);
}
`;

export class WavefieldRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private animFrameId: number | null = null;
  private startTime: number = performance.now();
  private currentTime: number = 0;
  private showRays: boolean = false;
  private hologramPhaseArray = new Float32Array(128);

  private uniformLocations: Record<string, WebGLUniformLocation | null> = {};

  private isDraggingProbe: boolean = false;
  private pointerDownHandler: ((e: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((e: PointerEvent) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.style.cursor = 'crosshair';
    this.initWebGL();
    this.setupProbeInteraction();
  }

  private initWebGL(): void {
    const gl = this.canvas.getContext('webgl2', {
      antialias: true,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      console.error('WebGL2 not supported on this device.');
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
      console.error('Program link error:', gl.getProgramInfoLog(program));
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

    // Uniform locations cache
    const uniforms = [
      'uResolution', 'uTime', 'uWavelength', 'uDesignWavelength', 'uFocalLength', 'uDiameter',
      'uDeflectionAngle', 'uDeviceType', 'uTopologicalCharge',
      'uEnableLens', 'uEnableDeflect', 'uEnableVortex', 'uEnableHologram', 'uProbeZ', 'uShowProbe',
      'uToleranceJitter', 'uRenderMode', 'uIntensityMax', 'uShowRays', 'uHologramPhase'
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
      console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
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

  public toggleRays(): boolean {
    this.showRays = !this.showRays;
    return this.showRays;
  }

  public getShowRays(): boolean {
    return this.showRays;
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

    let devTypeInt = 0;
    if (state.deviceType === 'deflector') devTypeInt = 1;
    else if (state.deviceType === 'vortex') devTypeInt = 2;
    else if (state.deviceType === 'hologram') devTypeInt = 3;
    gl.uniform1i(this.uniformLocations.uDeviceType, devTypeInt);

    // Multi-gradient superposition uniforms
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
    gl.uniform1i(this.uniformLocations.uShowProbe, 1);

    gl.uniform1f(this.uniformLocations.uTopologicalCharge, state.topologicalCharge);
    gl.uniform1f(this.uniformLocations.uToleranceJitter, state.toleranceJitter);

    let renderModeInt = 0;
    if (state.renderMode === 'intensity') renderModeInt = 1;
    else if (state.renderMode === 'phase') renderModeInt = 2;
    gl.uniform1i(this.uniformLocations.uRenderMode, renderModeInt);
    gl.uniform1f(this.uniformLocations.uIntensityMax, state.intensityMax ?? 6.0);
    gl.uniform1i(this.uniformLocations.uShowRays, this.showRays ? 1 : 0);

    // Update hologram phase array
    if (state.deviceType === 'hologram' && state.cghPhaseMask) {
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

  private setupProbeInteraction(): void {
    const updateProbeFromEvent = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.height <= 0) return;
      const normY = (e.clientY - rect.top) / rect.height; // 0 at top, 1 at bottom
      // In shader: vUv.y = 0 at bottom (substrate z = 0), 1 at top (z = 60 um)
      const zMax = 60.0;
      const clampedZ = Math.max(0.0, Math.min(60.0, (1.0 - normY) * zMax));
      const roundedZ = Math.round(clampedZ * 10) / 10;
      opticsStore.getState().setProbeZ(roundedZ);
    };

    this.pointerDownHandler = (e: PointerEvent) => {
      this.isDraggingProbe = true;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      updateProbeFromEvent(e);
    };

    this.pointerMoveHandler = (e: PointerEvent) => {
      if (this.isDraggingProbe) {
        updateProbeFromEvent(e);
      }
    };

    this.pointerUpHandler = (e: PointerEvent) => {
      if (this.isDraggingProbe) {
        this.isDraggingProbe = false;
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };

    this.canvas.addEventListener('pointerdown', this.pointerDownHandler);
    this.canvas.addEventListener('pointermove', this.pointerMoveHandler);
    this.canvas.addEventListener('pointerup', this.pointerUpHandler);
    this.canvas.addEventListener('pointercancel', this.pointerUpHandler);
  }

  public destroy(): void {
    this.stop();
    if (this.pointerDownHandler) {
      this.canvas.removeEventListener('pointerdown', this.pointerDownHandler);
      this.pointerDownHandler = null;
    }
    if (this.pointerMoveHandler) {
      this.canvas.removeEventListener('pointermove', this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.pointerUpHandler) {
      this.canvas.removeEventListener('pointerup', this.pointerUpHandler);
      this.canvas.removeEventListener('pointercancel', this.pointerUpHandler);
      this.pointerUpHandler = null;
    }
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
  }
}
